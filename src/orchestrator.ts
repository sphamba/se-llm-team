import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	appendNote,
	commitKanban,
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
	} catch {
		return false;
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

function startTodo(root: string, cfg: Config, task: Task): void {
	const wt = task.worktree || slugWorktree(task.name);
	const wtDir = join(root, ".worktrees", wt);
	if (!existsSync(wtDir)) {
		if (git(root, ["worktree", "add", join(".worktrees", wt), "-b", wt], true) === null) {
			git(root, ["worktree", "add", join(".worktrees", wt), wt]);
		}
	}
	setWorktree(root, task, wt);
	spawnAgent(root, cfg.agent, "developer", { ...task, worktree: wt }, wtDir);
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
	for (const task of listAll(root)) {
		try {
			const wtDir = join(root, ".worktrees", task.worktree || slugWorktree(task.name));
			if (task.state === "to-do") startTodo(root, cfg, task);
			else if (task.state === "to-review") {
				spawnAgent(root, cfg.agent, "reviewer", task, wtDir);
				setState(root, task, "reviewing");
			} else if (task.state === "to-live-test") {
				spawnAgent(root, cfg.agent, "live-tester", task, wtDir);
				setState(root, task, "live-testing");
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
	doing: "to-review",
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
		const other = parseInt(readFileSync(lock, "utf8").trim(), 10);
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
	const rescanSeconds = args.rescanSeconds ?? 30;
	if (!acquireLock(root)) {
		log(root, "another orchestrator already runs for this project, exiting");
		return;
	}
	for (const dir of [".logs", ".pids"]) mkdirSync(join(kanbanDir(root), dir), { recursive: true });
	log(root, `orchestrator started (root=${root}, agent=${cfg.agent}, poll=${pollMinutes}min, rescan=${rescanSeconds}s)`);

	const sweep = () => rescan(root, cfg);
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
		process.on("exit", () => w.close());
	} catch (err) {
		log(root, `fs.watch unavailable, polling only: ${err instanceof Error ? err.message : err}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2));
}
