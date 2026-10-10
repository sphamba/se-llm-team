import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, rmSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	appendNote,
	getTask,
	kanbanDir,
	listAll,
	setState,
	setWorktree,
	slugWorktree,
	type Task,
	type TaskState,
} from "./kanban.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLL_MINUTES = 15;
const RESPAWN_CAP = 5;
const MERGE_ATTEMPT_CAP = 3;

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

function pidAlive(pid: number): boolean {
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
	writePid(root, pidName ?? slug, child.pid ?? 0);
	log(root, `spawned ${role} pid=${child.pid} for ${task.file} (cwd=${cwd})`);
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

// the orchestrator is the sole .kanban committer; a missing git repo is tolerated
function commitKanban(root: string, files: string[], message: string): boolean {
	try {
		execFileSync("git", ["add", "--", ...files.map((f) => join(".kanban", f))], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["commit", "-m", message, "--", ...files.map((f) => join(".kanban", f))], {
			cwd: root,
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}

// git status --porcelain per board file (XY code); empty when git is missing.
// Runs git directly: the shared git() helper trims leading whitespace, which would
// corrupt the first line's XY prefix for unstaged changes.
function boardStatus(root: string): Map<string, string> {
	const status = new Map<string, string>();
	let out: string;
	try {
		out = execFileSync("git", ["status", "--porcelain", "-uall", "--", ".kanban"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		return status;
	}
	for (const line of out.split("\n")) {
		if (line.length < 4) continue;
		status.set(line.slice(3), line.slice(0, 2));
	}
	return status;
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
	if (pidAlive(agentPid(root, `${slug}.merger`))) return false;
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
	const attempts = bumpCounter(root, `${slug}.merge-attempts`);
	if (attempts > MERGE_ATTEMPT_CAP) {
		log(root, `merge of ${branch} for ${task.file} still conflicts after ${MERGE_ATTEMPT_CAP} attempts, left for manual resolution`);
		return false;
	}
	log(root, `merge conflict for ${branch}, spawning merger (attempt ${attempts})`);
	appendNote(root, task, `Merge conflict for branch ${branch}, merger spawned (attempt ${attempts}).`);
	spawnAgent(root, cfg.agent, "merger", task, root, `${slug}.merger`);
	return false;
}

function rescan(root: string, cfg: Config): void {
	const status = boardStatus(root);
	for (const task of listAll(root)) {
		try {
			// sole commit points: untracked board files are new, finished tasks fold in
			// their whole life; everything else stays uncommitted until done
			const code = status.get(join(".kanban", task.file));
			if (code === "??") commitKanban(root, [task.file], `kanban: create ${task.file}`);
			else if (code && task.state === "done" && !task.worktree) commitKanban(root, [task.file], `kanban: done ${task.file}`);
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
				// the one done commit: after the merge completes, or at once with no worktree
				if (!task.worktree || mergeDone(root, cfg, task)) commitKanban(root, [task.file], `kanban: done ${task.file}`);
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2));
}
