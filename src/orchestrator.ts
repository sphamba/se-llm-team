import { spawn, execFileSync, execSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	getTask,
	kanbanDir,
	listAll,
	setState,
	setWorktree,
	slugWorktree,
	taskFiles,
	type Task,
	type TaskState,
} from "./kanban.ts";
import { joinHub } from "./hub.ts";
import { loadWebUiConfig } from "./webui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLL_MINUTES = 1;
const DEFAULT_AUTO_SCHEDULE_MINUTES = 5;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const RESPAWN_CAP = 5;
const REVIEWER_RUN_CAP = 3;
// consecutive failed auto-pushes before the daemon logs its once-only warning (a success
// resets the count); the per-failure line is easy to miss, the warning names the consequence
const PUSH_WARN_AFTER = 3;
// the board's home ref: a branch is the only git-native carrier (push and clone transfer
// refs/heads/* only), so the board mirrors there and a fresh clone can bootstrap from it
const KANBAN_REF = "refs/heads/meta/kanban";
// the mirror head this process last materialized into the working tree or wrote with
// update-ref: rescan reconciles whenever the branch head differs from it
let lastMirrorHash: string | null = null;

interface LlmConfig {
	provider?: string;
	model?: string;
	thinking?: string;
}

interface Config {
	agent: string;
	pollMinutes: number;
	autoScheduleMinutes: number;
	llm: LlmConfig;
	roles: Record<string, LlmConfig>;
}

// the provider/model/thinking triple of one config object (global or a roles entry); values
// of the wrong type and unknown thinking levels are dropped with a warning, never fatal
function cleanLlm(root: string, entry: unknown, where = ""): LlmConfig {
	const source = (entry ?? {}) as { provider?: unknown; model?: unknown; thinking?: unknown };
	const clean: LlmConfig = {};
	if (typeof source.provider === "string" && source.provider) clean.provider = source.provider;
	if (typeof source.model === "string" && source.model) clean.model = source.model;
	if (source.thinking === undefined) return clean;
	if (typeof source.thinking === "string" && THINKING_LEVELS.includes(source.thinking)) clean.thinking = source.thinking;
	else log(root, `unknown thinking level ${JSON.stringify(source.thinking)}${where}, ignored (expected ${THINKING_LEVELS.join("|")})`);
	return clean;
}

function loadConfig(root: string): Config {
	let cfg: { agent?: string; pollMinutes?: number; autoScheduleMinutes?: number; provider?: unknown; model?: unknown; thinking?: unknown; roles?: unknown } = {};
	// user-level first, project .kanban/se-llm-team.json overrides it
	for (const path of [join(process.env.HOME ?? "", ".pi", "agent", "se-llm-team.json"), join(root, ".kanban", "se-llm-team.json")]) {
		try {
			cfg = { ...cfg, ...JSON.parse(readFileSync(path, "utf8")) };
		} catch {
			/* optional file */
		}
	}
	const roles: Record<string, LlmConfig> = {};
	if (cfg.roles && typeof cfg.roles === "object" && !Array.isArray(cfg.roles)) {
		for (const [role, entry] of Object.entries(cfg.roles)) roles[role] = cleanLlm(root, entry, ` for role "${role}"`);
	}
	return {
		agent: cfg.agent ?? "pi",
		pollMinutes: cfg.pollMinutes ?? DEFAULT_POLL_MINUTES,
		autoScheduleMinutes: cfg.autoScheduleMinutes ?? DEFAULT_AUTO_SCHEDULE_MINUTES,
		llm: cleanLlm(root, cfg, " (global)"),
		roles,
	};
}

// per-field precedence: the role entry wins over the global default, an unset field adds no
// flag. --provider is only valid together with --model, so a provider alone is ignored.
function llmFlags(root: string, cfg: Config, role: string): string[] {
	const roleCfg = cfg.roles[role] ?? {};
	const provider = roleCfg.provider ?? cfg.llm.provider;
	const model = roleCfg.model ?? cfg.llm.model;
	const thinking = roleCfg.thinking ?? cfg.llm.thinking;
	const flags: string[] = [];
	if (provider && !model) log(root, `provider "${provider}" for role ${role} ignored: --provider requires --model`);
	else if (provider) flags.push("--provider", provider);
	if (model) flags.push("--model", model);
	if (thinking) flags.push("--thinking", thinking);
	return flags;
}

function parseArgs(argv: string[]): { root?: string; rescanSeconds?: number; pollMinutes?: number; noWebui?: boolean } {
	const args: { root?: string; rescanSeconds?: number; pollMinutes?: number; noWebui?: boolean } = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--root") args.root = resolve(argv[++i]);
		else if (argv[i] === "--rescan-seconds") args.rescanSeconds = Number(argv[++i]);
		else if (argv[i] === "--poll-minutes") args.pollMinutes = Number(argv[++i]);
		else if (argv[i] === "--no-webui") args.noWebui = true;
	}
	return args;
}

const logPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.log`);
const pidPath = (root: string, name: string) => join(kanbanDir(root), ".pids", `${name}.pid`);
const counterPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.count`);
// one-shot marker that the last spawn from the to-review path was a reviewer; the value is
// that spawn's pid, so a later developer spawn (pidfile overwrite) or a poll-cleared pidfile
// (died run) reads as a mismatch and never counts as a reviewer success
const armedPath = (root: string, slug: string) => join(kanbanDir(root), ".logs", `${slug}.reviewer-armed`);

function log(root: string, message: string): void {
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	const line = `[${new Date().toISOString()}] ${message}`;
	appendFileSync(logPath(root, "orchestrator"), line + "\n");
	process.stdout.write(line + "\n");
}

function readCounter(root: string, name: string): number {
	try {
		return parseInt(readFileSync(counterPath(root, name), "utf8").trim(), 10) || 0;
	} catch {
		return 0;
	}
}

function bumpCounter(root: string, name: string): number {
	const n = readCounter(root, name) + 1;
	writeFileSync(counterPath(root, name), String(n));
	return n;
}

export function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM"; // exists but not signalable: still alive
	}
}

function writePid(root: string, name: string, pid: number): void {
	mkdirSync(dirname(pidPath(root, name)), { recursive: true });
	writeFileSync(pidPath(root, name), String(pid));
}

function clearPid(root: string, name: string): void {
	try {
		rmSync(pidPath(root, name));
	} catch {
		/* already gone */
	}
}

function agentPid(root: string, slug: string): number {
	try {
		return parseInt(readFileSync(pidPath(root, slug), "utf8").trim(), 10);
	} catch {
		return 0;
	}
}

function renderPrompt(root: string, role: string, task: Task, worktreeDir?: string): string {
	return readFileSync(join(HERE, "..", "agents", `${role}.md`), "utf8")
		.replaceAll("{{ROOT}}", root)
		.replaceAll("{{TASK_FILE}}", join(kanbanDir(root), task.file))
		.replaceAll("{{WORKTREE}}", worktreeDir ?? "")
		.replaceAll("{{WORKTREE_NAME}}", task.worktree)
		.replaceAll("{{NAME}}", task.name)
		.replaceAll("{{PRIORITY}}", task.priority);
}

// next per-run index for a task+role log: 1 + the max existing `<slug>.<role>.<n>.log` index;
// a legacy unsuffixed `<slug>.<role>.log` never counts, so the first indexed run is 0
function nextRunIndex(root: string, slug: string, role: string): number {
	const prefix = `${slug}.${role}.`;
	let max = -1;
	try {
		for (const f of readdirSync(join(kanbanDir(root), ".logs"))) {
			if (!f.startsWith(prefix) || !f.endsWith(".log")) continue;
			const n = f.slice(prefix.length, -4);
			if (/^\d+$/.test(n)) max = Math.max(max, parseInt(n, 10));
		}
	} catch {
		/* no .logs dir yet: first run is 0 */
	}
	return max + 1;
}

function spawnAgent(root: string, cfg: Config, role: string, task: Task, cwd: string, pidName?: string): void {
	const slug = task.file.replace(/\.md$/, "");
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	const out = openSync(logPath(root, `${slug}.${role}.${nextRunIndex(root, slug, role)}`), "a");
	// --approve trusts the project-local files of the worktree, so the headless session never waits for a trust prompt;
	// --mode json streams the full JSONL event log (thinking, tool calls, text) instead of print mode's final text only;
	// the provider/model/thinking flags come from the config, resolved per role
	const child = spawn(cfg.agent, ["--approve", "--mode", "json", ...llmFlags(root, cfg, role), "-p", renderPrompt(root, role, task, cwd === root ? undefined : cwd)], {
		cwd,
		detached: true,
		stdio: ["ignore", out, out],
	});
	child.on("error", (err) => log(root, `agent ${role} for ${task.file} failed to start: ${err.message}`));
	closeSync(out);
	child.unref();
	// a failed spawn (ENOENT) reports no pid; a written 0 reads as the caller's process group
	if (child.pid) {
		writePid(root, pidName ?? slug, child.pid);
		log(root, `spawned ${role} pid=${child.pid} for ${task.file} (cwd=${cwd})`);
	}
}

// consumes the armed marker at the state the armed reviewer wrote itself (back to to-review,
// or forward to to-live-test on approval): a pid match counts one successful reviewer run; a
// mismatch (died run: the poll clears the pidfile first, or a later developer spawn overwrote
// it) only drops the marker
function consumeReviewerRun(root: string, slug: string): void {
	const path = armedPath(root, slug);
	let armed = 0;
	try {
		armed = parseInt(readFileSync(path, "utf8").trim(), 10) || 0;
	} catch {
		return; // no reviewer armed: the arrival came from the developer or the board
	}
	rmSync(path);
	const pid = agentPid(root, slug);
	if (armed > 0 && armed === pid) bumpCounter(root, `${slug}.reviewer-runs`);
}

function git(root: string, args: string[], allowFailure = false): string | null {
	try {
		return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch (err) {
		if (allowFailure) return null;
		log(root, `git ${args.join(" ")} failed: ${err instanceof Error ? err.message : err}`);
		return null;
	}
}

// mirrors board changes onto refs/heads/meta/kanban via plumbing: git hash-object -w for the
// board files, mktree, git commit-tree (parent = current meta/kanban head), git update-ref.
// Never touches the index or working tree, so main history gets no kanban commits. The tree
// is rebuilt from the whole board, so deleted files and disk drift self-heal on the next
// mirror commit.
function commitKanban(root: string, message: string, files: string[]): boolean {
	if (!files.length) return false;
	let tree: string;
	try {
		const blobs = execFileSync("git", ["hash-object", "-w", "--", ...files.map((f) => join(".kanban", f))], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		})
			.trim()
			.split("\n");
		const board = execFileSync("git", ["mktree"], {
			cwd: root,
			input: files.map((f, i) => `100644 blob ${blobs[i]}\t${f}\n`).join(""),
			encoding: "utf8",
		}).trim();
		tree = execFileSync("git", ["mktree"], {
			cwd: root,
			input: `040000 tree ${board}\t.kanban\n`,
			encoding: "utf8",
		}).trim();
	} catch {
		return false;
	}
	const parent = git(root, ["rev-parse", "--verify", KANBAN_REF], true);
	// identical tree = board already mirrored: no commit, no push
	if (parent && git(root, ["rev-parse", "--verify", `${parent}^{tree}`], true) === tree) return true;
	const commit = git(root, parent ? ["commit-tree", tree, "-p", parent, "-m", message] : ["commit-tree", tree, "-m", message]);
	if (!commit || git(root, ["update-ref", KANBAN_REF, commit]) === null) return false;
	lastMirrorHash = commit;
	pushMirror(root);
	return true;
}

// best-effort auto-push of only the board mirror ref; failures are logged, never fatal.
// PUSH_WARN_AFTER consecutive failures log a prominent warning once (a success resets the
// count), so a permanently unreachable origin is visible instead of silently defeating the
// mirror and the fresh-clone bootstrap
function pushMirror(root: string): void {
	if (!git(root, ["remote"], true)) return;
	try {
		execFileSync("git", ["push", "origin", "meta/kanban"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 30000,
		});
		if (readCounter(root, "push-failures") > 0) writeFileSync(counterPath(root, "push-failures"), "0");
	} catch (err) {
		log(root, `push of ${KANBAN_REF} failed (non-fatal): ${err instanceof Error ? err.message : err}`);
		// counter keeps growing while pushes keep failing; log the warning only once per streak
		if (bumpCounter(root, "push-failures") === PUSH_WARN_AFTER) {
			log(root, `WARNING: auto-push of ${KANBAN_REF} to origin failed ${PUSH_WARN_AFTER} times in a row; the board mirror is not reaching origin and fresh-clone bootstrap cannot work. Check SSH access to origin for the daemon user (known_hosts entry, deploy key). This warning is logged once until a push succeeds.`);
		}
	}
}

// board file status relative to the meta/kanban mirror: "??" = not on the mirror yet (new
// task), non-empty = differs from the mirror (changed after its last mirror commit), "" =
// identical; empty when git is missing
function boardStatus(root: string, files: string[]): Map<string, string> {
	const status = new Map<string, string>();
	if (!files.length) return status;
	if (git(root, ["rev-parse", "--git-dir"], true) === null) return status;
	let mirrored = "";
	try {
		mirrored = execFileSync("git", ["ls-tree", "-r", KANBAN_REF, "--", ".kanban"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		/* no mirror branch yet: every board file is new */
	}
	let shas: string[];
	try {
		shas = execFileSync("git", ["hash-object", "--", ...files.map((f) => join(".kanban", f))], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		})
			.trim()
			.split("\n");
	} catch {
		return status;
	}
	const mirror = new Map<string, string>();
	for (const line of mirrored.split("\n")) {
		const m = line.match(/^\S+ blob (\S+)\t(.+)$/);
		if (m) mirror.set(m[2], m[1]);
	}
	files.forEach((f, i) => {
		const path = join(".kanban", f);
		const blob = mirror.get(path);
		status.set(path, blob === undefined ? "??" : blob === shas[i] ? "" : "M");
	});
	return status;
}

// board-feed wait for the extension's orchestrator_wait tool: polls the meta/kanban mirror
// for new kanban: create/done commits. The feed resolves from the git common dir (the main
// checkout's .git even when the session cwd is a task worktree, whose HEAD is pinned at its
// branch tip), so every wait sees the main checkout's board commits from any session cwd.
// Returns the new subjects, or [] on timeout/abort; clamps the timeout to 1-900s.
export async function waitForBoardCommits(cwd: string, timeoutSeconds: number | undefined, signal?: AbortSignal): Promise<string[]> {
	const timeout = Math.min(900, Math.max(1, timeoutSeconds ?? 300)) * 1000;
	const started = Date.now();
	let feedRoot = cwd;
	try {
		const common = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		if (common) feedRoot = dirname(common);
	} catch {
		/* not a git repo: the feed resolution below fails and the wait times out */
	}
	const revParse = () => {
		try {
			return execSync(`git rev-parse ${KANBAN_REF}`, { cwd: feedRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		} catch {
			return "";
		}
	};
	const baseline = revParse();
	while (Date.now() - started < timeout) {
		const head = revParse();
		// no baseline ref at start: the whole mirror appeared during the wait, so all its commits are new
		if (head && head !== baseline) {
			try {
				const subjects = execSync(`git log --format=%s ${baseline ? baseline + ".." : ""}${KANBAN_REF}`, {
					cwd: feedRoot,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				})
					.split("\n")
					.filter((s) => s.startsWith("kanban: done ") || s.startsWith("kanban: create "));
				if (subjects.length) return subjects;
			} catch {
				/* mirror ref vanished, keep waiting */
			}
		}
		const remaining = started + timeout - Date.now();
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, Math.min(2000, remaining));
			signal?.addEventListener("abort", () => {
				clearTimeout(timer);
				resolve();
			}, { once: true });
		});
		if (signal?.aborted) break;
	}
	return [];
}

// the worktree board is a symlink to the shared root board; hide it from the
// worktree's git (skip-worktree on the stale tracked entries, per-worktree
// excludesFile for the symlink itself) so merges never carry board changes
function syncBoard(root: string, wtDir: string): void {
	const wtBoard = join(wtDir, ".kanban");
	const target = kanbanDir(root);
	let linked = false;
	try {
		linked = lstatSync(wtBoard).isSymbolicLink() && readlinkSync(wtBoard) === target;
	} catch {
		/* missing, create it */
	}
	if (!linked) {
		rmSync(wtBoard, { recursive: true, force: true });
		try {
			symlinkSync(target, wtBoard);
		} catch (err) {
			log(root, `could not symlink ${wtBoard} to ${target}: ${err instanceof Error ? err.message : err}`);
			return;
		}
	}
	// idempotent: a partial setup (daemon died between steps) is completed here
	for (const path of (git(wtDir, ["ls-files", ".kanban"], true) ?? "").split("\n").filter(Boolean)) {
		git(wtDir, ["update-index", "--skip-worktree", path], true);
	}
	const gitDir = git(wtDir, ["rev-parse", "--absolute-git-dir"], true);
	if (!gitDir) return;
	const excludes = join(gitDir, "wt-excludes");
	if (!existsSync(excludes)) writeFileSync(excludes, ".kanban\n");
	git(wtDir, ["config", "extensions.worktreeConfig", "true"], true);
	git(wtDir, ["config", "--worktree", "core.excludesFile", excludes], true);
}

// whether the mirror branch's ancestry ever carried the file: a local file the tip lacks
// was deleted on the branch when the ancestry touched it, and is an unmirrored in-flight
// write (never committed) when not
function everOnMirror(root: string, file: string): boolean {
	try {
		return execFileSync("git", ["rev-list", "-n", "1", KANBAN_REF, "--", join(".kanban", file)], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim() !== "";
	} catch {
		return false;
	}
}

// materialize refs/heads/meta/kanban into the working-tree .kanban. Files the working tree
// lacks are written from the tip; local files the tip lacks that the last known mirror tree
// had are deleted (external deletions propagate). A local file that exists wins over the
// tip: agents write state and notes into the working tree while only creates and dones
// reach the mirror, so a differing local file is an in-flight write (the mirror cannot tell
// it from a stale copy). Never touches the index. Trigger: only when the branch head moved
// past the head this process last materialized or wrote; our own commits never re-trigger.
function reconcileBoard(root: string): boolean {
	const head = git(root, ["rev-parse", "--verify", KANBAN_REF], true);
	if (!head || head === lastMirrorHash) return false;
	let out: string;
	try {
		out = execFileSync("git", ["ls-tree", "-r", KANBAN_REF, "--", ".kanban"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		return false;
	}
	// the mirror carries flat .md names only (the taskFiles snapshot), so dot-entries and
	// nested paths are skipped exactly as the mirror path skips them
	const tip = new Map<string, string>();
	for (const line of out.split("\n")) {
		const m = line.match(/^\S+ blob (\S+)\t(.+)$/);
		if (!m) continue;
		const name = m[2].replace(/^\.kanban\//, "");
		if (!name.endsWith(".md") || name.includes("/")) continue;
		tip.set(name, m[1]);
	}
	const files = taskFiles(root);
	const local = new Map<string, string>();
	if (files.length) {
		try {
			const shas = execFileSync("git", ["hash-object", "--", ...files.map((f) => join(".kanban", f))], {
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim().split("\n");
			files.forEach((f, i) => local.set(f, shas[i]));
		} catch {
			return false;
		}
	}
	mkdirSync(kanbanDir(root), { recursive: true });
	let updated = 0;
	let kept = 0;
	for (const [name, blob] of tip) {
		// an existing local file is either equal to the tip or a newer in-flight write:
		// keep it, or a daemon restart reverts the state and notes written since the mirror
		if (local.has(name)) {
			if (local.get(name) !== blob) kept++;
			continue;
		}
		try {
			writeFileSync(
				join(kanbanDir(root), name),
				execFileSync("git", ["cat-file", "blob", blob], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
			);
			updated++;
		} catch {
			/* unreadable entry, skip */
		}
	}
	let deleted = 0;
	let previous: Set<string> | null = null;
	if (lastMirrorHash) {
		try {
			previous = new Set(
				execFileSync("git", ["ls-tree", "-r", lastMirrorHash, "--", ".kanban"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
					.split("\n")
					.map((l) => l.match(/^\S+ blob (\S+)\t(.+)$/))
					.filter((m): m is RegExpMatchArray => !!m)
					.map((m) => m[2].replace(/^\.kanban\//, ""))
					.filter((n) => n.endsWith(".md") && !n.includes("/")),
			);
		} catch {
			previous = null; // force-updated away from the old head: its tree is unreachable
		}
	}
	for (const f of files) {
		if (tip.has(f)) continue;
		if (!(previous?.has(f) || everOnMirror(root, f))) continue;
		try {
			rmSync(join(kanbanDir(root), f));
			deleted++;
		} catch {
			/* undeletable, keep */
		}
	}
	lastMirrorHash = head;
	log(root, `reconciled .kanban to ${head}: ${updated} file(s) updated, ${deleted} deleted${kept ? `, ${kept} in-flight kept` : ""}`);
	return true;
}

// ensures the task's worktree dir exists (creating it with the -b fallback when the branch
// is taken), links the shared board into it and records the worktree on the task;
// null when creation fails
function ensureWorktree(root: string, task: Task): { wt: string; wtDir: string } | null {
	const wt = task.worktree || slugWorktree(task.name, task.file);
	const wtDir = join(root, ".worktrees", wt);
	if (!existsSync(wtDir)) {
		if (git(root, ["worktree", "add", join(".worktrees", wt), "-b", wt], true) === null) {
			git(root, ["worktree", "add", join(".worktrees", wt), wt]);
		}
	}
	if (!existsSync(wtDir)) return null;
	syncBoard(root, wtDir);
	setWorktree(root, task, wt);
	return { wt, wtDir };
}

// a fresh clone has an empty .kanban/, a stale working tree can lack branch content and a
// merge that untracks the board may leave files behind on main: the board lives on
// refs/heads/meta/kanban, so seed the mirror ref when missing and reconcile the working tree
// to its tip (missing files materialize, local files that differ win as in-flight writes;
// runs at every startup, idempotent)
function bootstrapBoard(root: string): void {
	// a fresh non-bare clone carries only the remote-tracking ref, no local branch: seed the
	// mirror branch from it, or the reconcile below returns early (board never materializes)
	// and the first mirror commit is an orphan whose push fails non-fast-forward
	if (git(root, ["rev-parse", "--verify", KANBAN_REF], true) === null) {
		const source = git(root, ["rev-parse", "--verify", "refs/remotes/origin/meta/kanban"], true) !== null
			? "refs/remotes/origin/meta/kanban"
			: git(root, ["for-each-ref", "--format=%(refname)", "refs/remotes/*/meta/kanban"], true)?.split("\n")[0];
		if (source && git(root, ["update-ref", KANBAN_REF, source], true) !== null) {
			log(root, `seeded ${KANBAN_REF} from ${source}`);
		}
	}
	reconcileBoard(root);
}

function startTodo(root: string, cfg: Config, task: Task): void {
	const ensured = ensureWorktree(root, task);
	if (!ensured) return;
	spawnAgent(root, cfg, "developer", { ...task, worktree: ensured.wt }, ensured.wtDir);
	setState(root, task, "doing");
}

// one failed-merge marker per task: written when the sweep spawns a merger, it survives the
// merger requeueing the task and daemon restarts. A to-merge task whose marker exists re-runs
// only after it sat idle in to-merge for the idle interval, and the per-task file keeps the
// cooldown of a failed task intact while another task's merger spawns
const mergerAttemptPath = (root: string, slug: string) => join(kanbanDir(root), ".pids", `${slug}.merge-attempted`);

function clearMergerAttempt(root: string, slug: string): void {
	try {
		rmSync(mergerAttemptPath(root, slug));
	} catch {
		/* already gone */
	}
}

// the to-merge sweep, replacing merge-on-done: a task the live-tester passed sits in to-merge
// until a Merger merges main into the branch worktree and then the branch into main. One
// merger per project (the global pid file, spawned one at a time by the sequential sweep);
// the task's own agent may still be writing its report, so the spawn defers while that pid
// lives. The task moves to merging at spawn; a merger that requeues the task re-runs only
// after the idle cooldown.
function sweepToMerge(root: string, cfg: Config, task: Task): void {
	const slug = task.file.replace(/\.md$/, "");
	// the live-tester may still be committing and writing its report after setting to-merge
	if (pidAlive(agentPid(root, slug))) return;
	// at most one merger at a time, project-wide
	if (pidAlive(agentPid(root, "merger"))) return;
	// an earlier attempt on this task failed and requeued it: retry only after it sat idle in
	// to-merge for the idle interval. Read before any write: ensureWorktree/setWorktree bump the
	// task file's mtime, which is the idle clock, so this check must come first
	if (existsSync(mergerAttemptPath(root, slug)) && Date.now() - statSync(join(kanbanDir(root), task.file)).mtimeMs < cfg.autoScheduleMinutes * 60_000) return;
	const wt = task.worktree;
	if (!wt || (git(root, ["branch", "--list", wt], true) === "" && !existsSync(join(root, ".worktrees", wt)))) {
		// nothing to merge: no worktree and no branch
		setWorktree(root, task, "");
		setState(root, task, "done");
		log(root, `${task.file}: nothing to merge, set done`);
		return;
	}
	const ensured = ensureWorktree(root, task);
	// a failed spawn would strand the task; leave the state for the next rescan to retry
	if (!ensured) {
		log(root, `${task.file}: worktree could not be created, merger not spawned (state unchanged)`);
		return;
	}
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	writeFileSync(mergerAttemptPath(root, slug), "");
	spawnAgent(root, cfg, "merger", { ...task, worktree: ensured.wt }, root, "merger");
	setState(root, task, "merging");
}

// a done task's worktree and branch: the Merger merged the branch into main before setting
// done, so cleanup is all that is left here. -d refuses an unmerged branch, so a manual done
// with unfinished work keeps both branch and worktree for a manual merge.
function doneCleanup(root: string, task: Task): void {
	const wt = task.worktree;
	if (!wt) return;
	const wtDir = join(root, ".worktrees", wt);
	const hasBranch = git(root, ["branch", "--list", wt], true) !== "";
	if (!hasBranch && !existsSync(wtDir)) {
		// stale attribute: nothing left to clean
		setWorktree(root, task, "");
		return;
	}
	if (!hasBranch) {
		// worktree dir without a branch: nothing mergeable, drop the dir and the attribute
		git(root, ["worktree", "remove", wtDir, "--force"], true);
		setWorktree(root, task, "");
		return;
	}
	if (git(root, ["merge-base", "--is-ancestor", wt, "HEAD"], true) === null) return;
	// --force only drops uncommitted worktree debris; the merged branch content is already in main
	if (existsSync(wtDir)) git(root, ["worktree", "remove", wtDir, "--force"], true);
	git(root, ["branch", "-d", wt], true);
	setWorktree(root, task, "");
	log(root, `merged ${wt} for ${task.file}`);
}

function rescan(root: string, cfg: Config): void {
	// root-cause fix ordering: a snapshot commit must never be built from a tree that lacks
	// branch-only files, so an external mirror-head move is materialized before boardStatus
	// reads and before any commitKanban
	reconcileBoard(root);
	// one board snapshot per sweep: a file created after this read must not fold into an
	// in-flight commit's label (whole-board tree) or its own create event never surfaces
	const files = taskFiles(root);
	const status = boardStatus(root, files);
	const tasks = listAll(root);
	// sole commit points: board files not on the mirror yet are new, finished tasks fold in
	// their whole life; everything else stays unmirrored until done. Creates run first:
	// commitKanban rebuilds the tree from the whole board, so a done commit later in the
	// sweep would fold pending creates under its label and the create events would never
	// surface on the mirror
	for (const task of tasks) {
		try {
			if (task.conflicted) continue;
			if (status.get(join(".kanban", task.file)) === "??") commitKanban(root, `kanban: create ${task.file}`, files);
		} catch (err) {
			log(root, `error handling ${task.file} (create): ${err instanceof Error ? err.message : err}`);
		}
	}
	for (const task of tasks) {
		try {
			// a conflicted file parses bogus values (duplicate keys resolve last-wins, the merged-in
			// side wins); rewriting or acting on it would resolve the merge with stale state, so
			// leave it untouched until the merger or the user resolves it
			if (task.conflicted) {
				log(root, `${task.file}: unresolved merge conflict markers, skipping (merger or user resolves)`);
				continue;
			}
			// "??" here means the pass-one create commit failed (git error): retry it; the
			// identical-tree guard keeps an already-mirrored file a no-op
			const code = status.get(join(".kanban", task.file));
			if (code === "??") commitKanban(root, `kanban: create ${task.file}`, files);
			if (task.state === "to-do") startTodo(root, cfg, task);
			else if (task.state === "to-review") {
				const ensured = ensureWorktree(root, task);
				// a failed spawn would bounce or strand the task; leave the state for the next rescan to retry
				if (!ensured) log(root, `${task.file}: worktree could not be created, reviewer not spawned (state unchanged)`);
				else {
					const slug = task.file.replace(/\.md$/, "");
					consumeReviewerRun(root, slug);
					if (readCounter(root, `${slug}.reviewer-runs`) >= REVIEWER_RUN_CAP) {
						// re-read before the forced advance: a state changed underneath (PM or user) wins
						const fresh = getTask(root, task.file);
						if (fresh && fresh.state === "to-review") {
							setState(root, fresh, "to-live-test");
							// clears the count, so a future rework cycle starts fresh
							writeFileSync(counterPath(root, `${slug}.reviewer-runs`), "0");
							log(root, `reviewer succeeded 3+ times, moving ${slug} to to-live-test`);
						}
					} else {
						spawnAgent(root, cfg, "reviewer", task, ensured.wtDir);
						setState(root, task, "reviewing");
						const pid = agentPid(root, slug);
						if (pid) writeFileSync(armedPath(root, slug), String(pid));
					}
				}
			} else if (task.state === "to-live-test") {
				const ensured = ensureWorktree(root, task);
				if (!ensured) log(root, `${task.file}: worktree could not be created, live-tester not spawned (state unchanged)`);
				else {
					// a reviewer approval is a successful run too; the forced advance arrives with the
					// marker already consumed at the to-review branch, so it never re-counts
					consumeReviewerRun(root, task.file.replace(/\.md$/, ""));
					spawnAgent(root, cfg, "live-tester", task, ensured.wtDir);
					setState(root, task, "live-testing");
				}
			} else if (task.state === "to-merge") {
				sweepToMerge(root, cfg, task);
			} else if (task.state === "merging") {
				// its merger runs: the liveness poll requeues the task when the merger dies
			} else if (task.state === "done") {
				// cleanup always runs for a done worktree task (the merger merged before setting
				// done, so only the worktree/branch removal is left); the commit is gated on the
				// file actually differing from the mirror, since an unchanged done task would
				// otherwise issue a whole-board commit every sweep and fold other tasks' pending
				// changes under its label
				doneCleanup(root, task);
				if (code) commitKanban(root, `kanban: done ${task.file}`, files);
			}
		} catch (err) {
			log(root, `error handling ${task.file} (${task.state}): ${err instanceof Error ? err.message : err}`);
		}
	}
	// merger spawn bookkeeping: clear the global merger pid once no task is merging and the
	// merger is gone; the failed-merge markers stay while their task waits, and are dropped once
	// the task moved on (a successful merge ends in done)
	if (!tasks.some((t) => t.state === "merging") && !pidAlive(agentPid(root, "merger"))) clearPid(root, "merger");
	for (const task of tasks) {
		if (task.state !== "to-merge" && task.state !== "merging") clearMergerAttempt(root, task.file.replace(/\.md$/, ""));
	}
	autoSchedule(root, cfg, tasks);
}

const DEAD_TRANSITIONS: Partial<Record<TaskState, TaskState>> = {
	doing: "to-do",
	reviewing: "to-review",
	"live-testing": "to-merge",
	merging: "to-merge",
};

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const rank = (priority: string) => PRIORITY_RANK[priority] ?? PRIORITY_RANK.low + 1;
const taskNum = (file: string) => {
	const n = parseInt(file.slice(0, 6), 10);
	return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

// failsafe for when nothing gets scheduled: PM promotion stays the primary path. idleSince is
// null while any task is active or the backlog is empty, else the timestamp the board was last
// seen idle with promotable backlog work; the promotion fires after autoScheduleMinutes of
// continuous idle. Module state like lastMirrorHash: one locked daemon per project.
let idleSince: number | null = null;

function autoSchedule(root: string, cfg: Config, tasks: Task[]): void {
	// conflicted files parse bogus state values: neither promotable nor proof of activity
	const candidates = tasks.filter((t) => !t.conflicted);
	const backlog = candidates.filter((t) => t.state === "backlog");
	if (!backlog.length || candidates.some((t) => t.state !== "backlog" && t.state !== "done")) {
		idleSince = null;
		return;
	}
	const now = Date.now();
	if (idleSince === null) {
		idleSince = now;
		return;
	}
	if (now - idleSince < cfg.autoScheduleMinutes * 60_000) return;
	// taskFiles sorts by file name, so the stable sort keeps the oldest first within a rank
	const next = [...backlog].sort((a, b) => rank(a.priority) - rank(b.priority) || taskNum(a.file) - taskNum(b.file))[0];
	idleSince = null;
	log(root, `no active task for ${cfg.autoScheduleMinutes}min, promoting ${next.file} to to-do (failsafe)`);
	try {
		setState(root, next, "to-do");
	} catch (err) {
		log(root, `auto-schedule of ${next.file} failed: ${err instanceof Error ? err.message : err}`);
	}
}

function poll(root: string, cfg: Config): void {
	for (const task of listAll(root)) {
		try {
			// no state rewrite on a conflicted file: the parse is bogus and the merger owns resolution
			if (task.conflicted) continue;
			const next = DEAD_TRANSITIONS[task.state];
			const slug = task.file.replace(/\.md$/, "");
			// a merging task's agent is the project-wide merger (the global pid file); every other
			// state maps to the task's own agent pid. Clear before the transition check: a pidfile
			// for a state with no transition (to-merge, done) would otherwise linger forever
			const pidName = task.state === "merging" ? "merger" : slug;
			const pid = agentPid(root, pidName);
			if (pidAlive(pid)) continue;
			clearPid(root, pidName);
			if (!next) continue;
			if (bumpCounter(root, `${slug}.dead`) > RESPAWN_CAP) {
				// counter keeps growing while the pidfile stays dead; log the give-up only once
				if (readCounter(root, `${slug}.dead`) === RESPAWN_CAP + 1) {
					log(root, `${slug}: agent died ${RESPAWN_CAP}+ times, giving up (state ${task.state})`);
				}
				continue;
			}
			log(root, `${slug}: agent pid=${pid} dead without state update, ${task.state} -> ${next}`);
			const fresh = getTask(root, task.file);
			if (fresh) setState(root, fresh, next);
		} catch (err) {
			log(root, `error polling ${task.file} (${task.state}): ${err instanceof Error ? err.message : err}`);
		}
	}
}

function acquireLock(root: string): boolean {
	const lock = join(kanbanDir(root), ".orchestrator.lock");
	mkdirSync(kanbanDir(root), { recursive: true });
	try {
		writeFileSync(lock, String(process.pid), { flag: "wx" });
		return true;
	} catch {
		let other = 0;
		try {
			other = parseInt(readFileSync(lock, "utf8").trim(), 10);
		} catch {
			return false; // lock vanished since the wx attempt: a rival holds or released it, stay out
		}
		if (pidAlive(other)) return false;
		rmSync(lock);
		return acquireLock(root);
	}
}

function releaseLock(root: string): void {
	const lock = join(kanbanDir(root), ".orchestrator.lock");
	try {
		if (parseInt(readFileSync(lock, "utf8").trim(), 10) === process.pid) rmSync(lock);
	} catch {
		/* not ours */
	}
}

function holdsLock(root: string): boolean {
	try {
		return readFileSync(join(kanbanDir(root), ".orchestrator.lock"), "utf8").trim() === String(process.pid);
	} catch {
		return false;
	}
}

export function main(argv: string[]): void {
	const args = parseArgs(argv);
	if (!args.root) {
		process.stderr.write("usage: node orchestrator.ts --root <project-dir> [--no-webui]\n");
		process.exitCode = 1;
		return;
	}
	const root = args.root;
	const cfg = loadConfig(root);
	const pollMinutes = args.pollMinutes ?? cfg.pollMinutes;
	const rescanSeconds = args.rescanSeconds ?? 10;
	if (!acquireLock(root)) {
		log(root, "another orchestrator already runs for this project, exiting");
		return;
	}
	for (const dir of [".logs", ".pids"]) mkdirSync(join(kanbanDir(root), dir), { recursive: true });
	log(root, `orchestrator started (root=${root}, agent=${cfg.agent}, poll=${pollMinutes}min, rescan=${rescanSeconds}s, auto-schedule=${cfg.autoScheduleMinutes}min)`);
	bootstrapBoard(root);

	const sweep = () => {
		// lock self-heal: an external cleanup or an acquire race can drop the lock mid-life;
		// without this the daemon runs lockless forever and status/stop report "not running"
		if (!holdsLock(root)) {
			if (acquireLock(root)) log(root, "orchestrator lock was missing, re-acquired");
			else {
				log(root, "another orchestrator already runs for this project, exiting");
				process.exit(0);
			}
		}
		rescan(root, cfg);
	};
	let scheduled: NodeJS.Timeout | undefined;
	const scheduleSweep = () => {
		clearTimeout(scheduled);
		scheduled = setTimeout(sweep, 500);
	};
	const stop = () => {
		clearInterval(scheduled);
		clearInterval(timer);
		clearInterval(poller);
		releaseLock(root);
		log(root, "orchestrator stopped");
		process.exit(0);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	process.on("exit", () => releaseLock(root));

	sweep();
	poll(root, cfg);
	const timer = setInterval(sweep, rescanSeconds * 1000);
	const poller = setInterval(() => poll(root, cfg), pollMinutes * 60 * 1000);
	try {
		const w = watch(kanbanDir(root), scheduleSweep);
		w.on("error", (err) => log(root, `fs.watch error, polling only: ${err instanceof Error ? err.message : err}`));
		process.on("exit", () => w.close());
	} catch (err) {
		log(root, `fs.watch unavailable, polling only: ${err instanceof Error ? err.message : err}`);
	}
	// smoke runs read the same global config as production, so without this they bind the
	// production webui port and steal the real UI
	const noWebUi = args.noWebui || ["1", "true"].includes((process.env.SE_LLM_TEAM_NO_WEBUI ?? "").toLowerCase());
	const webUi = loadWebUiConfig(root);
	if (webUi.enabled && noWebUi) {
		log(root, "web ui disabled (no-webui)");
	} else if (webUi.enabled) {
		// the elected hub daemon serves every registered board on the webUi port; non-hub
		// daemons register with it and serve nothing (one port, one ui)
		joinHub({ name: basename(root), root, host: webUi.host, port: webUi.port, log: (message) => log(root, message) });
	}
}

// the extension (loaded by jiti) keeps the symlink path in import.meta.url and spawns the
// daemon through it, while plain node resolves symlinks, so the daemon's import.meta.url is
// the real path: compare real paths on both sides or the guard fails under a symlinked
// extension and main() never runs
function isMainEntry(): boolean {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false; // argv[1] or the module path is not an existing file: not the entry point
	}
}

if (isMainEntry()) {
	main(process.argv.slice(2));
}
