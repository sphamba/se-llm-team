import { spawn, execFileSync, execSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync, readFileSync, readlinkSync, rmSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	appendNote,
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
import { loadWebUiConfig, startWebUi } from "./webui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLL_MINUTES = 1;
const RESPAWN_CAP = 5;
const MERGE_ATTEMPT_CAP = 3;
// the board's home ref: a branch is the only git-native carrier (push and clone transfer
// refs/heads/* only), so the board mirrors there and a fresh clone can bootstrap from it
const KANBAN_REF = "refs/heads/meta/kanban";

interface Config {
	agent: string;
	pollMinutes: number;
}

function loadConfig(root: string): Config {
	let cfg: { agent?: string; pollMinutes?: number } = {};
	// user-level first, project .kanban/se-llm-team.json overrides it
	for (const path of [join(process.env.HOME ?? "", ".pi", "agent", "se-llm-team.json"), join(root, ".kanban", "se-llm-team.json")]) {
		try {
			cfg = { ...cfg, ...JSON.parse(readFileSync(path, "utf8")) };
		} catch {
			/* optional file */
		}
	}
	return { agent: cfg.agent ?? "pi", pollMinutes: cfg.pollMinutes ?? DEFAULT_POLL_MINUTES };
}

function parseArgs(argv: string[]): { root?: string; rescanSeconds?: number; pollMinutes?: number } {
	const args: { root?: string; rescanSeconds?: number; pollMinutes?: number } = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--root") args.root = resolve(argv[++i]);
		else if (argv[i] === "--rescan-seconds") args.rescanSeconds = Number(argv[++i]);
		else if (argv[i] === "--poll-minutes") args.pollMinutes = Number(argv[++i]);
	}
	return args;
}

const logPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.log`);
const pidPath = (root: string, name: string) => join(kanbanDir(root), ".pids", `${name}.pid`);
const counterPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.count`);

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

function spawnAgent(root: string, agent: string, role: string, task: Task, cwd: string, pidName?: string): void {
	const slug = task.file.replace(/\.md$/, "");
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	const out = openSync(logPath(root, `${slug}.${role}`), "a");
	// --approve trusts the project-local files of the worktree, so the headless session never waits for a trust prompt
	const child = spawn(agent, ["--approve", "-p", renderPrompt(root, role, task, cwd === root ? undefined : cwd)], {
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
function commitKanban(root: string, message: string): boolean {
	const files = taskFiles(root);
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
	pushMirror(root);
	return true;
}

// best-effort auto-push of only the board mirror ref; failures are logged, never fatal
function pushMirror(root: string): void {
	if (!git(root, ["remote"], true)) return;
	try {
		execFileSync("git", ["push", "origin", "meta/kanban"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 30000,
		});
	} catch (err) {
		log(root, `push of ${KANBAN_REF} failed (non-fatal): ${err instanceof Error ? err.message : err}`);
	}
}

// board file status relative to the meta/kanban mirror: "??" = not on the mirror yet (new
// task), non-empty = differs from the mirror (changed after its last mirror commit), "" =
// identical; empty when git is missing
function boardStatus(root: string): Map<string, string> {
	const status = new Map<string, string>();
	const files = taskFiles(root);
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

// ensures the task's worktree dir exists (creating it with the -b fallback when the branch
// is taken), links the shared board into it and records the worktree on the task;
// null when creation fails
function ensureWorktree(root: string, task: Task): { wt: string; wtDir: string } | null {
	const wt = task.worktree || slugWorktree(task.name);
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

// a fresh clone has an empty .kanban/, and a merge that untracks the board may leave files
// behind on main: the board lives on refs/heads/meta/kanban, so restore task files that are
// missing from .kanban/ from the mirror branch (runs at every startup, idempotent)
function bootstrapBoard(root: string): void {
	// a fresh non-bare clone carries only the remote-tracking ref, no local branch: seed the
	// mirror branch from it, or the guard below returns early (board never materializes) and
	// the first mirror commit is an orphan whose push fails non-fast-forward
	if (git(root, ["rev-parse", "--verify", KANBAN_REF], true) === null) {
		const source = git(root, ["rev-parse", "--verify", "refs/remotes/origin/meta/kanban"], true) !== null
			? "refs/remotes/origin/meta/kanban"
			: git(root, ["for-each-ref", "--format=%(refname)", "refs/remotes/*/meta/kanban"], true)?.split("\n")[0];
		if (source && git(root, ["update-ref", KANBAN_REF, source], true) !== null) {
			log(root, `seeded ${KANBAN_REF} from ${source}`);
		}
	}
	if (git(root, ["rev-parse", "--verify", KANBAN_REF], true) === null) return;
	const have = new Set(taskFiles(root));
	let out: string;
	try {
		out = execFileSync("git", ["ls-tree", "-r", KANBAN_REF, "--", ".kanban"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		return;
	}
	let restored = 0;
	for (const line of out.split("\n")) {
		const m = line.match(/^\S+ blob (\S+)\t(.+)$/);
		if (!m) continue;
		const name = m[2].replace(/^\.kanban\//, "");
		// the branch can come from a remote on a fresh clone: flat .md names only, no traversal
		if (!name.endsWith(".md") || name.includes("/") || have.has(name)) continue;
		try {
			writeFileSync(
				join(root, m[2]),
				execFileSync("git", ["cat-file", "blob", m[1]], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
			);
			restored++;
		} catch {
			/* unreadable entry, skip */
		}
	}
	if (restored) log(root, `bootstrapped ${restored} task file(s) from ${KANBAN_REF}`);
}

function startTodo(root: string, cfg: Config, task: Task): void {
	const ensured = ensureWorktree(root, task);
	if (!ensured) return;
	spawnAgent(root, cfg.agent, "developer", { ...task, worktree: ensured.wt }, ensured.wtDir);
	setState(root, task, "doing");
}

// returns true when the done transition is fully processed: nothing left to merge, or the merge completed
function mergeDone(root: string, cfg: Config, task: Task): boolean {
	const branch = task.worktree;
	const wtDir = join(root, ".worktrees", branch);
	const slug = task.file.replace(/\.md$/, "");
	// the task's agent may outlive its done state (it writes its report and final worktree
	// commits after setting done): defer the merge until the pid dies; a conflict rerun waits
	// on the merger pid instead
	if (pidAlive(agentPid(root, slug)) || pidAlive(agentPid(root, `${slug}.merger`))) return false;
	if (!existsSync(wtDir) && git(root, ["branch", "--list", branch], true) === "") {
		setWorktree(root, task, "");
		return true;
	}
	if (git(root, ["merge", "--no-edit", branch], true) !== null) {
		// --force only drops uncommitted worktree debris; the merged branch content is already in main
		git(root, ["worktree", "remove", wtDir, "--force"], true);
		git(root, ["branch", "-d", branch], true);
		setWorktree(root, task, "");
		log(root, `merged ${branch} for ${task.file}`);
		return true;
	}
	const attempts = readCounter(root, `${slug}.merge-attempts`);
	if (attempts >= MERGE_ATTEMPT_CAP) {
		// a stuck-conflict task is rescanned forever: log the give-up once at the cap,
		// then freeze the counter instead of bumping and logging on every later sweep
		if (attempts === MERGE_ATTEMPT_CAP) {
			bumpCounter(root, `${slug}.merge-attempts`);
			log(root, `merge of ${branch} for ${task.file} still conflicts after ${MERGE_ATTEMPT_CAP} attempts, left for manual resolution`);
		}
		return false;
	}
	const next = bumpCounter(root, `${slug}.merge-attempts`);
	log(root, `merge conflict for ${branch}, spawning merger (attempt ${next})`);
	appendNote(root, task, `Merge conflict for branch ${branch}, merger spawned (attempt ${next}).`);
	spawnAgent(root, cfg.agent, "merger", task, root, `${slug}.merger`);
	return false;
}

function rescan(root: string, cfg: Config): void {
	const status = boardStatus(root);
	const tasks = listAll(root);
	// sole commit points: board files not on the mirror yet are new, finished tasks fold in
	// their whole life; everything else stays unmirrored until done. Creates run first:
	// commitKanban rebuilds the tree from the whole board, so a done commit later in the
	// sweep would fold pending creates under its label and the create events would never
	// surface on the mirror
	for (const task of tasks) {
		try {
			if (task.conflicted) continue;
			if (status.get(join(".kanban", task.file)) === "??") commitKanban(root, `kanban: create ${task.file}`);
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
			if (code === "??") commitKanban(root, `kanban: create ${task.file}`);
			if (task.state === "to-do") startTodo(root, cfg, task);
			else if (task.state === "to-review") {
				const ensured = ensureWorktree(root, task);
				// a failed spawn would bounce or strand the task; leave the state for the next rescan to retry
				if (!ensured) log(root, `${task.file}: worktree could not be created, reviewer not spawned (state unchanged)`);
				else {
					spawnAgent(root, cfg.agent, "reviewer", task, ensured.wtDir);
					setState(root, task, "reviewing");
				}
			} else if (task.state === "to-live-test") {
				const ensured = ensureWorktree(root, task);
				if (!ensured) log(root, `${task.file}: worktree could not be created, live-tester not spawned (state unchanged)`);
				else {
					spawnAgent(root, cfg.agent, "live-tester", task, ensured.wtDir);
					setState(root, task, "live-testing");
				}
			} else if (task.state === "done") {
				// mergeDone always runs for a done worktree task (it completes the merge and clears
				// the worktree); the commit is gated on the file actually differing from the mirror,
				// since an unchanged done task would otherwise issue a whole-board commit every sweep
				// and fold other tasks' pending changes under its label
				const merged = !task.worktree || mergeDone(root, cfg, task);
				if (code && merged) commitKanban(root, `kanban: done ${task.file}`);
			}
		} catch (err) {
			log(root, `error handling ${task.file} (${task.state}): ${err instanceof Error ? err.message : err}`);
		}
	}
}

const DEAD_TRANSITIONS: Partial<Record<TaskState, TaskState>> = {
	doing: "to-do",
	reviewing: "to-review",
	"live-testing": "done",
};

function poll(root: string, cfg: Config): void {
	for (const task of listAll(root)) {
		try {
			// no state rewrite on a conflicted file: the parse is bogus and the merger owns resolution
			if (task.conflicted) continue;
			const next = DEAD_TRANSITIONS[task.state];
			if (!next) continue;
			const slug = task.file.replace(/\.md$/, "");
			const pid = agentPid(root, slug);
			if (pidAlive(pid)) continue;
			clearPid(root, slug);
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
		process.stderr.write("usage: node orchestrator.ts --root <project-dir>\n");
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
	log(root, `orchestrator started (root=${root}, agent=${cfg.agent}, poll=${pollMinutes}min, rescan=${rescanSeconds}s)`);
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
	const webUi = loadWebUiConfig(root);
	if (webUi.enabled) {
		startWebUi(root, webUi)
			.then((ui) => (ui ? log(root, `web ui on http://${webUi.host}:${ui.port}`) : log(root, "web ui failed to start, continuing without it")))
			.catch((err) => log(root, `web ui failed to start, continuing without it: ${err instanceof Error ? err.message : err}`));
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
