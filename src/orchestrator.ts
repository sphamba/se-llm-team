import { spawn, execFileSync, execSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
	COMPLEXITIES,
	getTask,
	kanbanDir,
	listAll,
	PRIORITY_RANK,
	setState,
	setWorktree,
	slugWorktree,
	taskFiles,
	taskSlug,
	type Task,
	type TaskState,
} from "./kanban.ts";
import { joinHub } from "./hub.ts";
import { agentAlive, agentPid, clearPid, pidAlive, pidEntry, pidPath, writePid } from "./pid.ts";
import { loadWebUiConfig } from "./webui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLL_MINUTES = 1;
const DEFAULT_AUTO_SCHEDULE_MINUTES = 5;
// minutes a working agent's log may keep its size before the agent is assumed dead
const DEFAULT_LOG_STALL_MINUTES = 5;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const RESPAWN_CAP = 5;
// final fallback for the per-complexity cap when a Config carries no reviewerCap entry for
// the task's complexity
const REVIEWER_RUN_CAP = 3;
// per-complexity forced-advance caps: successful reviewer runs before to-review moves on to
// to-live-test; each overridable via the top-level reviewerCap config key
const DEFAULT_REVIEWER_CAP: Record<string, number> = { simple: 1, moderate: 2, complex: 3 };
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

// a roles entry may also hold per-complexity sub-objects keyed simple/moderate/complex, each
// an LlmConfig that overrides the role defaults for tasks of that complexity
interface RoleLlmConfig extends LlmConfig {
	simple?: LlmConfig;
	moderate?: LlmConfig;
	complex?: LlmConfig;
}

interface Config {
	agent: string;
	pollMinutes: number;
	autoScheduleMinutes: number;
	logStallMinutes: number;
	llm: LlmConfig;
	roles: Record<string, RoleLlmConfig>;
	reviewerCap: Record<string, number>;
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

export function loadConfig(root: string): Config {
	let cfg: { agent?: string; pollMinutes?: number; autoScheduleMinutes?: number; logStallMinutes?: unknown; provider?: unknown; model?: unknown; thinking?: unknown; roles?: unknown; reviewerCap?: unknown } = {};
	// user-level first, project .kanban/se-llm-team.json overrides it
	for (const path of [join(process.env.HOME ?? "", ".pi", "agent", "se-llm-team.json"), join(root, ".kanban", "se-llm-team.json")]) {
		try {
			cfg = { ...cfg, ...JSON.parse(readFileSync(path, "utf8")) };
		} catch {
			/* optional file */
		}
	}
	const roles: Record<string, RoleLlmConfig> = {};
	if (cfg.roles && typeof cfg.roles === "object" && !Array.isArray(cfg.roles)) {
		for (const [role, entry] of Object.entries(cfg.roles)) {
			const clean: RoleLlmConfig = cleanLlm(root, entry, ` for role "${role}"`);
			// nested complexity sub-objects are cleaned like role entries; a non-object value
			// under those keys warns and is ignored
			const src = (entry ?? {}) as Record<string, unknown>;
			for (const cx of COMPLEXITIES) {
				const v = src[cx];
				if (v === undefined) continue;
				if (v && typeof v === "object" && !Array.isArray(v)) clean[cx] = cleanLlm(root, v, ` for role "${role}" ${cx}`);
				else log(root, `non-object complexity override ${JSON.stringify(v)} for role "${role}" ${cx}, ignored`);
			}
			roles[role] = clean;
		}
	}
	const reviewerCap: Record<string, number> = { ...DEFAULT_REVIEWER_CAP };
	if (cfg.reviewerCap && typeof cfg.reviewerCap === "object" && !Array.isArray(cfg.reviewerCap)) {
		for (const cx of COMPLEXITIES) {
			const v = (cfg.reviewerCap as Record<string, unknown>)[cx];
			if (v === undefined) continue;
			if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
				log(root, `invalid reviewerCap.${cx} ${JSON.stringify(v)}, ignored (expected an integer >= 1)`);
				continue;
			}
			reviewerCap[cx] = v;
		}
	}
	let logStallMinutes = DEFAULT_LOG_STALL_MINUTES;
	const stall = cfg.logStallMinutes;
	if (stall !== undefined) {
		if (typeof stall !== "number" || stall <= 0) log(root, `logStallMinutes ${JSON.stringify(stall)} ignored: must be a positive number of minutes`);
		else logStallMinutes = stall;
	}
	return {
		agent: cfg.agent ?? "pi",
		pollMinutes: cfg.pollMinutes ?? DEFAULT_POLL_MINUTES,
		autoScheduleMinutes: cfg.autoScheduleMinutes ?? DEFAULT_AUTO_SCHEDULE_MINUTES,
		logStallMinutes,
		llm: cleanLlm(root, cfg, " (global)"),
		roles,
		reviewerCap,
	};
}

// per-field precedence: the role's complexity entry wins over the role default, which wins
// over the global default; an unset field adds no flag. --provider is only valid together
// with --model, so a provider alone is ignored.
function llmFlags(root: string, cfg: Config, role: string, complexity: string): string[] {
	const roleCfg = cfg.roles[role] ?? {};
	const cxCfg = (roleCfg as Record<string, LlmConfig | undefined>)[complexity] ?? {};
	const provider = cxCfg.provider ?? roleCfg.provider ?? cfg.llm.provider;
	const model = cxCfg.model ?? roleCfg.model ?? cfg.llm.model;
	const thinking = cxCfg.thinking ?? roleCfg.thinking ?? cfg.llm.thinking;
	const flags: string[] = [];
	if (provider && !model) log(root, `provider "${provider}" for role ${role} ignored: --provider requires --model`);
	else if (provider) flags.push("--provider", provider);
	if (model) flags.push("--model", model);
	if (thinking) flags.push("--thinking", thinking);
	return flags;
}

function parseArgs(argv: string[]): { root?: string; rescanSeconds?: number; pollMinutes?: number; noWebui?: boolean; compactLogs?: boolean } {
	const args: { root?: string; rescanSeconds?: number; pollMinutes?: number; noWebui?: boolean; compactLogs?: boolean } = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--root") args.root = resolve(argv[++i]);
		else if (argv[i] === "--rescan-seconds") args.rescanSeconds = Number(argv[++i]);
		else if (argv[i] === "--poll-minutes") args.pollMinutes = Number(argv[++i]);
		else if (argv[i] === "--no-webui") args.noWebui = true;
		else if (argv[i] === "--compact-logs") args.compactLogs = true;
	}
	return args;
}

const logPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.log`);
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
// a legacy unsuffixed `<slug>.<role>.log` never counts, so the first indexed run is 0. The
// sweep's .log.gz replacements count too: a gzipped run keeps its index, so a fresh spawn
// never re-creates a used index and overwrites the gzipped history
export function nextRunIndex(root: string, slug: string, role: string): number {
	const prefix = `${slug}.${role}.`;
	let max = -1;
	try {
		for (const f of readdirSync(join(kanbanDir(root), ".logs"))) {
			if (!f.startsWith(prefix)) continue;
			const m = f.slice(prefix.length).match(/^(\d+)\.log(?:\.gz)?$/);
			if (m) max = Math.max(max, parseInt(m[1], 10));
		}
	} catch {
		/* no .logs dir yet: first run is 0 */
	}
	return max + 1;
}

// one JSONL log line -> the compacted line, or null to drop it. The moderate drop list: the
// run-opening system prompt echoes (message_start/end with role=system, the ~135 KB sections
// payload), agent_end's full message replay, and the toolResult message_start (the full tool
// result echoed a second time); message_update loses its per-record usage envelope. Everything
// the read path renders survives byte-for-byte: message_update deltas, tool calls, full tool
// results (the subagent-log matching needs them), turn replays, and non-system message_end
// records (the user prompt's qualifies).
export function compactLogLine(line: string): string | null {
	if (!line.startsWith("{")) return line; // non-JSON stderr passes through unchanged
	let rec: any;
	try {
		rec = JSON.parse(line);
	} catch {
		return line; // not JSON either: pass through unchanged
	}
	if (!rec || typeof rec.type !== "string") return line;
	switch (rec.type) {
		case "message_start":
		case "message_end":
			if (rec.message?.role === "system") return null;
			if (rec.type === "message_start" && rec.message?.role === "toolResult") return null;
			return line; // kept verbatim
		case "agent_end":
			delete rec.messages; // the full message replay; the rest of the record stays
			return JSON.stringify(rec);
		case "message_update":
			if (rec.assistantMessageEvent === undefined) {
				delete rec.usage;
				return JSON.stringify(rec);
			}
			return JSON.stringify({ type: "message_update", assistantMessageEvent: rec.assistantMessageEvent });
		default:
			return line; // kept verbatim, byte-for-byte
	}
}

// raw agent logs are compacted retro-actively, in every sweep, at run end (poll) and via
// --compact-logs: the log fd belongs to the child, so the write-time pipe (whose read end
// lived in the daemon and died with it, EPIPE-killing the agent) cannot come back

function spawnAgent(root: string, cfg: Config, role: string, task: Task, cwd: string, pidName?: string): void {
	const slug = taskSlug(task.file);
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	// stdout and stderr write the log file directly through an fd the child owns: a pipe read
	// end would live in this daemon, and the daemon's death (stop, restart) would close it and
	// EPIPE-kill the agent's next write. An open file fd survives the daemon, so a restart
	// leaves in-flight agents running and logging; the raw log is compacted at run end
	const fd = openSync(logPath(root, `${slug}.${role}.${nextRunIndex(root, slug, role)}`), "a");
	// --approve trusts the project-local files of the worktree, so the headless session never waits for a trust prompt;
	// --mode json streams the full JSONL event log (thinking, tool calls, text) instead of print mode's final text only;
	// the provider/model/thinking flags come from the config, resolved per role
	const child = spawn(cfg.agent, ["--approve", "--mode", "json", ...llmFlags(root, cfg, role, task.complexity ?? "moderate"), "-p", renderPrompt(root, role, task, cwd === root ? undefined : cwd)], {
		cwd,
		detached: true,
		stdio: ["ignore", fd, fd],
	});
	closeSync(fd); // the child holds its own dup of the fd from uv_spawn
	child.on("error", (err) => {
		log(root, `agent ${role} for ${task.file} failed to start: ${err.message}`);
	});
	child.unref();
	// a failed spawn (ENOENT) reports no pid; a written 0 reads as the caller's process group
	if (child.pid) {
		writePid(root, pidName ?? slug, child.pid);
		log(root, `spawned ${role} pid=${child.pid} for ${task.file} (cwd=${cwd})`);
	}
}

// retro-compact pass, wired into every sweep, at detected run ends (poll) and one-time via
// --compact-logs: rewrite finished agent logs through the compactor into <name>.log.gz and
// drop the plain file, so a finished run's raw JSONL stops growing the disk. A log whose
// writer may still be alive is skipped: the liveness of the pid each guard file names, so a
// finished run's stale pidfile no longer blocks the pass. Non role-log names
// (orchestrator.log, counters, armed markers) and already-gzipped logs never match the
// pattern, so the pass is idempotent. The .gz is renamed into place before the plain file is
// removed: a crash between the two leaves both, and the next pass re-gzips the plain file
// over the old .gz
export function compactFinishedLogs(root: string): { files: number; before: number; after: number } {
	const result = { files: 0, before: 0, after: 0 };
	let names: string[];
	try {
		names = readdirSync(join(kanbanDir(root), ".logs"));
	} catch {
		return result;
	}
	for (const name of names) {
		// role-log name pattern: <slug>.<role>.<n>.log and the legacy unsuffixed <slug>.<role>.log
		const m = name.match(/^(.+)\.(developer|reviewer|live-tester|merger)(\.\d+)?\.log$/);
		if (!m) continue;
		const guards = m[2] === "merger" ? ["merger", `${m[1]}.merger`] : [m[1]];
		if (guards.some((g) => agentAlive(root, g))) continue;
		const path = join(kanbanDir(root), ".logs", name);
		const before = readFileSync(path, "utf8");
		const after = before.split("\n").map(compactLogLine).filter((l) => l !== null).join("\n");
		const tmp = `${path}.gz.compact-tmp`;
		try {
			const gz = gzipSync(Buffer.from(after, "utf8"));
			writeFileSync(tmp, gz);
			renameSync(tmp, `${path}.gz`);
			rmSync(path);
			result.files++;
			result.before += Buffer.byteLength(before);
			result.after += gz.length;
		} catch {
			try {
				rmSync(tmp, { force: true });
			} catch {
				/* keep the original */
			}
		}
	}
	return result;
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
function commitKanban(root: string, message: string, files: string[], allowEmpty = false): boolean {
	if (!files.length && !allowEmpty) return false;
	let tree: string;
	try {
		// empty board (removal of the last task): mktree with no entries yields the empty tree
		const blobs = files.length
			? execFileSync("git", ["hash-object", "-w", "--", ...files.map((f) => join(".kanban", f))], {
					cwd: root,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				})
					.trim()
					.split("\n")
			: [];
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

// serialized in-flight push: the pushes were synchronous, so "consecutive failures" was
// well-defined; the queue keeps that order without blocking the daemon loop
let pushQueue: Promise<void> = Promise.resolve();

// best-effort auto-push of only the board mirror ref, detached: the daemon loop never waits
// on the network (a hanging SSH held the single-threaded sweep for the full 30s cap per
// changed board file). The 30s cap kills a hanging push; results (success/failure count) are
// logged and counted from the child's exit, asynchronously. PUSH_WARN_AFTER consecutive
// failures log a prominent warning once (a success resets the count and the warned marker),
// so a permanently unreachable origin is visible instead of silently defeating the mirror
// and the fresh-clone bootstrap
function pushMirror(root: string): void {
	if (!git(root, ["remote"], true)) return;
	pushQueue = pushQueue.then(() => doPush(root)).catch(() => {});
}

// in-flight push children, killed on daemon exit so a stopped daemon leaves no orphaned
// hanging push behind (the child's kill timer dies with the daemon that spawned it)
const pushChildren = new Set<ReturnType<typeof spawn>>();

function doPush(root: string): Promise<void> {
	return new Promise<void>((resolvePush) => {
		let settled = false;
		const finish = (failed: boolean, detail: string) => {
			if (settled) return;
			settled = true;
			pushChildren.delete(child);
			clearTimeout(timer);
			if (!failed) {
				if (readCounter(root, "push-failures") > 0) writeFileSync(counterPath(root, "push-failures"), "0");
				if (readCounter(root, "push-warned") > 0) writeFileSync(counterPath(root, "push-warned"), "0");
			} else {
				log(root, `push of ${KANBAN_REF} failed (non-fatal): ${detail}`);
				// >= plus a warned marker: a stale counter past PUSH_WARN_AFTER never hits equality, and
				// >= alone would warn on every failure past the cap instead of once per streak
				if (bumpCounter(root, "push-failures") >= PUSH_WARN_AFTER && readCounter(root, "push-warned") === 0) {
					writeFileSync(counterPath(root, "push-warned"), "1");
					log(root, `WARNING: auto-push of ${KANBAN_REF} to origin failed ${PUSH_WARN_AFTER} times in a row; the board mirror is not reaching origin and fresh-clone bootstrap cannot work. Check SSH access to origin for the daemon user (known_hosts entry, deploy key). This warning is logged once until a push succeeds.`);
				}
			}
			resolvePush();
		};
		const child = spawn("git", ["push", "origin", "meta/kanban"], { cwd: root, detached: true, stdio: ["ignore", "ignore", "pipe"] });
		pushChildren.add(child);
		child.unref();
		let stderr = "";
		child.stderr?.on("data", (d) => (stderr += d));
		child.stderr?.unref();
		const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
		timer.unref();
		child.on("error", (err) => finish(true, err.message));
		child.on("close", (code) => finish(code !== 0, stderr.trim() || `exit code ${code}`));
	});
}

// removes a task in one operation: delete the file, then commit a whole-board mirror
// snapshot, so the removal reaches refs/heads/meta/kanban and reconcileBoard cannot restore
// it (the tip no longer carries the file). The daemon is the only other mirror writer: a
// sweep mid-flight with a pre-removal board snapshot can re-add the file with its commit, so
// while a daemon runs the tip is checked after a settle delay and the removal retries when
// the file returned. Returns null on success, else a reason string.
export async function removeTask(root: string, file: string): Promise<string | null> {
	const name = file.endsWith(".md") ? file : `${file}.md`;
	if (!taskFiles(root).includes(name)) return `No task ${file}`;
	const hasGit = git(root, ["rev-parse", "--git-dir"], true) !== null;
	rmSync(join(kanbanDir(root), name), { force: true });
	// no git, no mirror and no reconcile: deleting the file is the whole removal
	if (!hasGit) return null;
	let daemonPid = 0;
	try {
		daemonPid = parseInt(readFileSync(join(kanbanDir(root), ".orchestrator.lock"), "utf8").trim(), 10) || 0;
	} catch {
		/* no lock: no daemon runs */
	}
	for (let attempt = 0; attempt < 3; attempt++) {
		if (!commitKanban(root, `kanban: delete ${name}`, taskFiles(root), true)) {
			return `mirror commit for ${name} failed, the board may restore the file: retry`;
		}
		// let a racing in-flight daemon commit land before the tip check
		if (pidAlive(daemonPid)) await new Promise((resolve) => setTimeout(resolve, 1000));
		const onTip = git(root, ["ls-tree", "--name-only", KANBAN_REF, "--", join(".kanban", name)], true);
		if (onTip === null) return "git unavailable, the removal may not be mirrored";
		if (!onTip) return null;
		// a racing sweep re-added the file: the daemon may have restored it to the tree too
		rmSync(join(kanbanDir(root), name), { force: true });
	}
	return `${name} returned to the mirror (a daemon sweep raced the removal): retry`;
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
	const wt = task.worktree || slugWorktree(task.name, task.file, task.shortName || undefined);
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
	const slug = taskSlug(task.file);
	// a manual to-do rewrite can land while the spawned agent still runs: the live pid is the
	// guard, the state alone is not, or a second sweep spawns a twin that overwrites the pid file
	if (pidAlive(agentPid(root, slug))) return;
	const ensured = ensureWorktree(root, task);
	if (!ensured) return;
	// state before spawn: the next sweep reads doing and defers, with the pid check as the belt
	setState(root, task, "doing");
	spawnAgent(root, cfg, "developer", { ...task, worktree: ensured.wt }, ensured.wtDir);
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
	const slug = taskSlug(task.file);
	// the live-tester may still be committing and writing its report after setting to-merge
	if (agentAlive(root, slug)) return;
	// at most one merger at a time, project-wide
	if (agentAlive(root, "merger")) return;
	// a task bounced here past the respawn cap (dead live-tester or merger) also waits for
	// the idle cooldown before its merger spawns
	if (deadCooldownActive(root, cfg, task)) return;
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
	mergerLogSlug = slug;
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

// past RESPAWN_CAP the fresh agent waits for the idle cooldown: the unconditional bounce
// still moves the task back one step, only the respawn backs off. The task file's update
// time is the idle clock (the bounce's setState wrote it). Read before any write:
// ensureWorktree/setWorktree bump the mtime and would restart the clock mid-check
function deadCooldownActive(root: string, cfg: Config, task: Task): boolean {
	if (readCounter(root, `${taskSlug(task.file)}.dead`) <= RESPAWN_CAP) return false;
	return Date.now() - statSync(join(kanbanDir(root), task.file)).mtimeMs < cfg.autoScheduleMinutes * 60_000;
}

// stale per-task merger pid leftovers (the old per-task merger scheme, e.g. 000038.merger.pid):
// current code reads only the global merger pid, so a leftover is dead weight. Drop each one
// whose process is dead; a live pid keeps its file, and a task still in merging is skipped
function janitorPids(root: string, tasks: Task[]): void {
	const merging = new Set(tasks.filter((t) => t.state === "merging").map((t) => taskSlug(t.file)));
	let files: string[] = [];
	try {
		files = readdirSync(join(kanbanDir(root), ".pids"));
	} catch {
		return; // no .pids dir yet
	}
	for (const f of files) {
		if (!f.endsWith(".merger.pid")) continue;
		const name = f.slice(0, -".pid".length); // "<slug>.merger"
		if (merging.has(name.slice(0, -".merger".length))) continue;
		const { pid, disc } = pidEntry(root, name);
		if (pidAlive(pid, disc)) continue; // never remove a running process's pid file
		try {
			rmSync(join(kanbanDir(root), ".pids", f));
		} catch {
			/* already gone */
		}
	}
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
			// past the respawn cap the fresh developer waits for the idle cooldown (state unchanged)
			if (task.state === "to-do" && !deadCooldownActive(root, cfg, task)) startTodo(root, cfg, task);
			else if (task.state === "to-review" && !deadCooldownActive(root, cfg, task)) {
				const ensured = ensureWorktree(root, task);
				// a failed spawn would bounce or strand the task; leave the state for the next rescan to retry
				if (!ensured) log(root, `${task.file}: worktree could not be created, reviewer not spawned (state unchanged)`);
				else {
					const slug = taskSlug(task.file);
					consumeReviewerRun(root, slug);
					const cap = cfg.reviewerCap[task.complexity] ?? REVIEWER_RUN_CAP;
					if (readCounter(root, `${slug}.reviewer-runs`) >= cap) {
						// re-read before the forced advance: a state changed underneath (PM or user) wins
						const fresh = getTask(root, task.file);
						if (fresh && fresh.state === "to-review") {
							setState(root, fresh, "to-live-test");
							// clears the count, so a future rework cycle starts fresh
							writeFileSync(counterPath(root, `${slug}.reviewer-runs`), "0");
							log(root, `${task.file}: reviewer succeeded ${cap}+ times, moving to to-live-test`);
						}
					} else if (!pidAlive(agentPid(root, slug))) {
						// the previous agent for this task (usually the developer writing its report) may
						// still be alive: defer the spawn to a later sweep instead of double-spawning
						setState(root, task, "reviewing");
						spawnAgent(root, cfg, "reviewer", task, ensured.wtDir);
						const pid = agentPid(root, slug);
						if (pid) writeFileSync(armedPath(root, slug), String(pid));
					}
				}
			} else if (task.state === "to-live-test" && !deadCooldownActive(root, cfg, task)) {
				const ensured = ensureWorktree(root, task);
				if (!ensured) log(root, `${task.file}: worktree could not be created, live-tester not spawned (state unchanged)`);
				else {
					// a reviewer approval is a successful run too; the forced advance arrives with the
					// marker already consumed at the to-review branch, so it never re-counts
					const slug = taskSlug(task.file);
					consumeReviewerRun(root, slug);
					if (!pidAlive(agentPid(root, slug))) {
						// the reviewer that approved it may still be alive: defer the spawn to a later sweep
						setState(root, task, "live-testing");
						spawnAgent(root, cfg, "live-tester", task, ensured.wtDir);
					}
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
	if (!tasks.some((t) => t.state === "merging") && !agentAlive(root, "merger")) clearPid(root, "merger");
	for (const task of tasks) {
		if (task.state !== "to-merge" && task.state !== "merging") clearMergerAttempt(root, taskSlug(task.file));
	}
	janitorPids(root, tasks);
	autoSchedule(root, cfg, tasks);
	// every sweep: finished agents' logs compact into .log.gz (idempotent; live pids are skipped)
	compactFinishedLogs(root);
}

// the working states with an agent out: next is the one-state-back bounce target when the
// agent dies, role is the agent role whose per-run log (.kanban/.logs/<slug>.<role>.<n>.log)
// the stall check samples
const WORKING_STATES: Partial<Record<TaskState, { next: TaskState; role: string }>> = {
	doing: { next: "to-do", role: "developer" },
	reviewing: { next: "to-review", role: "reviewer" },
	"live-testing": { next: "to-merge", role: "live-tester" },
	merging: { next: "to-merge", role: "merger" },
};

// a live-but-hung agent passes pidAlive forever: the stall check kills it by its log instead
// (the window itself is the logStallMinutes config, default DEFAULT_LOG_STALL_MINUTES)
// per-daemon log-size samples for the stall check: "<slug>.<role>" -> the sampled log path,
// its size and the time that size was first seen; a daemon restart restarts the window
const logSamples = new Map<string, { path: string; size: number; since: number }>();
// the slug the live merger was spawned for: the merger pid file is project-wide, so a merging
// task can outlive its own merger run while another task's merger works; only the task the
// current merger serves may stall-bounce it, or an old merger log would get the wrong
// process killed
let mergerLogSlug: string | null = null;

const rank = (priority: string) => PRIORITY_RANK[priority] ?? 4;
// unprefixed files sort last (MAX_SAFE_INTEGER), distinct from kanban.ts taskNum (0)
const sortNum = (file: string) => {
	const n = parseInt(file.slice(0, 6), 10);
	return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

// failsafe for when nothing gets scheduled: PM promotion stays the primary path. idleSince is
// null while any task is active or the backlog is empty, else the timestamp the board was last
// seen idle with promotable backlog work; the promotion fires after autoScheduleMinutes of
// continuous idle. Module state like lastMirrorHash: one locked daemon per project.
let idleSince: number | null = null;

// a blockedBy entry ("#<num>") holds the task while its blocker exists and is not done;
// a ref resolving to no existing task is ignored
function blockedByUndone(tasks: Task[], task: Task): boolean {
	if (!task.blockedBy) return false;
	const states = new Map(tasks.map((t) => [sortNum(t.file), t.state]));
	return task.blockedBy.split(",").some((ref) => {
		const num = parseInt(ref.trim().replace(/^#/, ""), 10);
		return num > 0 && states.get(num) !== undefined && states.get(num) !== "done";
	});
}

function autoSchedule(root: string, cfg: Config, tasks: Task[]): void {
	// conflicted files parse bogus state values: neither promotable nor proof of activity
	const candidates = tasks.filter((t) => !t.conflicted);
	// unanswered open questions mean the task waits for the user: never promote it
	const backlog = candidates.filter((t) => t.state === "backlog" && !t.openQuestions);
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
	// taskFiles sorts by file name, so the stable sort keeps the oldest first within a rank;
	// unfinished blockers hold the task: the failsafe never auto-promotes a blocked task
	const next = [...backlog]
		.filter((t) => !blockedByUndone(tasks, t))
		.sort((a, b) => rank(a.priority) - rank(b.priority) || sortNum(a.file) - sortNum(b.file))[0];
	if (!next) return;
	idleSince = null;
	log(root, `no active task for ${cfg.autoScheduleMinutes}min, promoting ${next.file} to to-do (failsafe)`);
	try {
		setState(root, next, "to-do");
	} catch (err) {
		log(root, `auto-schedule of ${next.file} failed: ${err instanceof Error ? err.message : err}`);
	}
}

// every sample of one task's agent logs: dropped when the task leaves the working states or
// its pid dies (the dead-pid path owns it then)
function dropLogSamples(slug: string): void {
	for (const key of logSamples.keys()) {
		if (key.startsWith(`${slug}.`)) logSamples.delete(key);
	}
}

// the stall check for one working-state task with a live agent: sample the newest per-run
// log's size and report a stall when the size is unchanged for the whole window. No per-run
// log (nothing indexed yet, or vanished between readdir and stat) => no sample, no check
function logStalled(root: string, slug: string, role: string, stallMinutes: number, now: number): boolean {
	const key = `${slug}.${role}`;
	const n = nextRunIndex(root, slug, role) - 1;
	if (n < 0) {
		logSamples.delete(key);
		return false;
	}
	const path = logPath(root, `${slug}.${role}.${n}`);
	let size: number;
	try {
		size = statSync(path).size;
	} catch {
		logSamples.delete(key);
		return false;
	}
	const prev = logSamples.get(key);
	// a new run (new file) or any size change restarts the window
	if (!prev || prev.path !== path || prev.size !== size) {
		logSamples.set(key, { path, size, since: now });
		return false;
	}
	return now - prev.since >= stallMinutes * 60_000;
}

// one bounce for both death kinds (dead pid, stalled log): SIGTERM the agent on request,
// clear its pid files, re-read the task and move it one state back when the state has not
// moved on, then bump the death counter so the respawn machinery takes over (immediate under
// the cap, idle-cooldown past it). The bounce itself is unconditional past RESPAWN_CAP: a
// frozen mid-flight task is worse than a bounced one, only the respawn backs off
function bounceDead(root: string, task: Task, next: TaskState, pidName: string, pid: number, kill: boolean): void {
	const slug = taskSlug(task.file);
	dropLogSamples(slug);
	if (kill) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			/* already gone */
		}
	}
	clearPid(root, pidName);
	// re-read + state-match: a task that moved on underneath (agent, PM or user) wins
	const fresh = getTask(root, task.file);
	if (!fresh || fresh.state !== task.state) return;
	setState(root, fresh, next);
	// past the cap the fresh spawn waits for the idle cooldown (the sweep defers it);
	// logged once at cap+1, like the old give-up line
	if (bumpCounter(root, `${slug}.dead`) === RESPAWN_CAP + 1) {
		log(root, `${slug}: agent died ${RESPAWN_CAP}+ times; respawn waits for the idle cooldown (state ${next})`);
	}
}

// now is injectable so the stall window is testable without waiting out real minutes
export function poll(root: string, stallMinutes: number, now = Date.now()): void {
	// a run ended this pass (a bounced working agent, or the stale pidfile of a completed one):
	// the ended logs are raw, so the pass ends with their retro-compact
	let ended = false;
	for (const task of listAll(root)) {
		try {
			// no state rewrite on a conflicted file: the parse is bogus and the merger owns resolution
			if (task.conflicted) continue;
			const working = WORKING_STATES[task.state];
			const slug = taskSlug(task.file);
			// a merging task's agent is the project-wide merger (the global pid file); every other
			// state maps to the task's own agent pid. Clear before the transition check: a pidfile
			// for a state with no transition (to-merge, done) would otherwise linger forever
			const pidName = task.state === "merging" ? "merger" : slug;
			const { pid, disc } = pidEntry(root, pidName);
			if (pidAlive(pid, disc)) {
				// a live pid is stalled when its per-run log size is unchanged for the whole window:
				// bounced and killed like a dead agent. A merging task only samples while the live
				// merger is its own (see mergerLogSlug); outside the working states there is no
				// check, and stale samples are dropped
				if (working && (task.state !== "merging" || mergerLogSlug === slug) && logStalled(root, slug, working.role, stallMinutes, now)) {
					log(root, `${task.file}: agent log unchanged for ${stallMinutes}+ min, assuming dead (state ${task.state})`);
					ended = true;
					bounceDead(root, task, working.next, pidName, pid, true);
				} else if (!working) {
					dropLogSamples(slug);
				}
				continue;
			}
			// a dead or missing pid: the dead-pid path owns the task, its stall samples are dropped
			dropLogSamples(slug);
			const hadPid = pid > 0;
			clearPid(root, pidName);
			if (!working) {
				// a completed run leaves its stale pidfile behind, a bounce clears it first, so a
				// stale pidfile here means the agent advanced the task out of the mapped state by
				// its own action: the death streak is over. Clearing on a missing pidfile too would
				// wipe the counter of a past-cap task still waiting out its respawn cooldown
				if (hadPid) {
					ended = true;
					if (readCounter(root, `${slug}.dead`) > 0) {
						writeFileSync(counterPath(root, `${slug}.dead`), "0");
						log(root, `${slug}: run completed, cleared the dead-agent counter`);
					}
				}
				continue;
			}
			// the bounce is unconditional: a frozen mid-flight task is worse than a bounced one
			log(root, `${slug}: agent pid=${pid} dead without state update, ${task.state} -> ${working.next}`);
			ended = true;
			bounceDead(root, task, working.next, pidName, pid, false);
		} catch (err) {
			log(root, `error polling ${task.file} (${task.state}): ${err instanceof Error ? err.message : err}`);
		}
	}
	// the compactor lives in the retro pass now: a run's raw log is rewritten at its end (the
	// write-time pipe is gone - the log fd must survive the daemon, so it cannot be a pipe).
	// compactFinishedLogs skips logs whose writer is still alive
	if (ended) compactFinishedLogs(root);
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
		process.stderr.write("usage: node orchestrator.ts --root <project-dir> [--rescan-seconds <s>] [--poll-minutes <m>] [--no-webui] [--compact-logs]\n");
		process.exitCode = 1;
		return;
	}
	const root = args.root;
	if (args.compactLogs) {
		const r = compactFinishedLogs(root);
		const summary = `retro-compacted ${r.files} agent log(s): ${r.before} -> ${r.after} bytes`;
		log(root, summary);
		process.stdout.write(summary + "\n");
		return;
	}
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
	process.on("exit", () => {
		releaseLock(root);
		for (const child of pushChildren) child.kill("SIGKILL");
	});

	sweep();
	poll(root, cfg.logStallMinutes);
	const timer = setInterval(sweep, rescanSeconds * 1000);
	const poller = setInterval(() => poll(root, cfg.logStallMinutes), pollMinutes * 60 * 1000);
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
