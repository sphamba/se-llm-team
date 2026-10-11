import assert from "node:assert/strict";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, kanbanDir, parseTask, setState, setWorktree } from "./kanban.ts";
import { pidAlive, waitForBoardCommits } from "./orchestrator.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "orch-smoke-"));
	execSync("git init -q", { cwd: root });
	execSync("git config user.email t@t && git config user.name t && git config commit.gpgsign false", {
		cwd: root,
		shell: "/bin/bash",
	});
	writeFileSync(join(root, "README.md"), "x\n");
	execSync("git add -A && git commit -qm init", { cwd: root, shell: "/bin/bash" });
	return root;
}

// subjects of the board mirror branch; "" before the first mirror commit (or without git);
// stderr piped so the not-yet-existing-ref fatal stays out of the test output
const mirrorSubjects = (root: string) => {
	try {
		return execSync("git log --format=%s refs/heads/meta/kanban", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return "";
	}
};

// a file's content at the mirror tip; null when the tip lacks it (or git fails)
const showTip = (root: string, file: string): string | null => {
	try {
		return execSync(`git show refs/heads/meta/kanban:.kanban/${file}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: "/bin/bash" });
	} catch {
		return null;
	}
};

// an external mirror-head move, built with the same plumbing the daemon uses (full-tree
// snapshot, parent = current tip): files is name -> content for the whole .kanban board
const externalCommit = (root: string, files: Record<string, string>, message: string): string => {
	const entries = Object.entries(files)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([name, content]) => {
			const sha = execSync("git hash-object -w --stdin", { input: content, cwd: root, encoding: "utf8" }).trim();
			return `100644 blob ${sha}\t${name}\n`;
		})
		.join("");
	const board = execSync("git mktree", { input: entries, cwd: root, encoding: "utf8" }).trim();
	const tree = execSync("git mktree", { input: `040000 tree ${board}\t.kanban\n`, cwd: root, encoding: "utf8" }).trim();
	const parent = execSync("git rev-parse --verify refs/heads/meta/kanban", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	const commit = execSync(`git commit-tree ${tree} -p ${parent} -m '${message}'`, { cwd: root, encoding: "utf8", shell: "/bin/bash" }).trim();
	execSync(`git update-ref refs/heads/meta/kanban ${commit}`, { cwd: root, shell: "/bin/bash" });
	return commit;
};

// a task file's frontmatter, for hand-written board entries in the tests
const taskContent = (name: string, state = "backlog") =>
	`---\nname: "${name}"\npriority: "medium"\nstate: "${state}"\nworktree: ""\n---\n\n# Summary\nTest task.\n\n# Specs\nn/a\n\n# Notes\n`;

// stub agent: parses its role out of the prompt and applies the pipeline transition;
// the developer also commits a code change, so the merge is a real one and the blanket
// git add -A in the worktree proves board changes cannot be staged
const roleStub = (root: string) => {
	const stub = join(root, "stub-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[4] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
if (prompt.includes("Developer agent")) {
	writeFileSync("code.txt", "work\\n");
	execSync("git add -A && git commit -qm work", { stdio: "ignore" });
}
const next = prompt.includes("Developer agent") ? "to-review"
	: prompt.includes("Reviewer agent") ? "to-live-test"
	: prompt.includes("Live-tester") ? "done" : null;
if (next) writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + next));
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

// stub agent that only moves the developer forward, so the worktree persists
const devStub = (root: string) => {
	const stub = join(root, "dev-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const prompt = process.argv[4] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!prompt.includes("Developer agent") || !file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: to-review"));
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

// stub agent that always dies without updating the task
const deadStub = (root: string) => {
	const stub = join(root, "dead-agent.cjs");
	writeFileSync(stub, `#!/usr/bin/env node\nprocess.exit(0);\n`);
	chmodSync(stub, 0o755);
	return stub;
};

async function runDaemon(root: string, script = join(HERE, "orchestrator.ts")) {
	const daemon = spawn(
		process.execPath,
		[script, "--root", root, "--rescan-seconds", "1", "--poll-minutes", "0.05"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	daemons.push({ daemon, root });
	let out = "";
	daemon.stdout.on("data", (d) => (out += d));
	daemon.stderr.on("data", (d) => (out += d));
	daemon.on("exit", (code, sig) => (out += `\n[daemon exit ${code} ${sig}]`));
	daemon.on("error", (e) => (out += `\n[daemon error ${e.message}]`));
	return { daemon, output: () => out };
}

const waitFor = async (cond: () => boolean, ms: number, what: string, out: () => string) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (cond()) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	console.error(`timeout waiting for ${what}; daemon output (live):
${out()}`);
	killAll();
	process.exit(1);
};
const cleaned: string[] = [];
const cleanupAll = (...roots: string[]) => roots.forEach((r) => rmSync(r, { recursive: true, force: true }));
const daemons: { daemon: ChildProcess; root: string }[] = [];
// agents the daemons spawned run detached, so the test learns their pids from the daemon's pidfiles;
// the cmdline guard keeps a recycled pid from getting an unrelated process killed
const agentPids = (root: string): number[] => {
	try {
		return readdirSync(join(kanbanDir(root), ".pids")).flatMap((f) => {
			const pid = parseInt(readFileSync(join(kanbanDir(root), ".pids", f), "utf8").trim(), 10);
			try {
				return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(root) ? [pid] : [];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
};
// safety net for failure and interruption paths: SIGKILL the daemons (the happy path already sent
// SIGTERM), then kill every agent they spawned from the pidfiles
const killAll = () => {
	for (const { daemon, root } of daemons) {
		daemon.kill("SIGKILL");
		for (const pid of agentPids(root)) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				/* agent already gone */
			}
		}
	}
};
process.on("exit", () => {
	killAll();
	cleanupAll(...cleaned);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		killAll();
		cleanupAll(...cleaned);
		process.exit(sig === "SIGINT" ? 130 : 143);
	});
}

// --- part A: happy pipeline with a working stub ---
const rootA = fixture();
cleaned.push(rootA);
// bare origin for the auto-push checks: the daemon must push only the board mirror there
const remoteA = `${rootA}-origin.git`;
execSync(`git init -q --bare ${remoteA}`, { shell: "/bin/bash" });
execSync(`git remote add origin ${remoteA}`, { cwd: rootA, shell: "/bin/bash" });
mkdirSync(kanbanDir(rootA), { recursive: true });
writeFileSync(join(kanbanDir(rootA), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootA), pollMinutes: 0.05 }));
const taskA = createTask(rootA, { name: "feat: smoke test", summary: "Pipeline smoke", specs: "Run the full pipeline" });
setState(rootA, taskA, "to-do");

const a = await runDaemon(rootA);
const readA = () => parseTask(rootA, taskA.file);

const taskClean = () => mirrorSubjects(rootA).includes(`kanban: done ${taskA.file}`);
// to-do -> doing -> to-review -> reviewing -> to-live-test -> live-testing -> done -> merge -> done mirror commit.
// The stub transitions in milliseconds, so intermediate states are asserted through the daemon log.
await waitFor(() => readA().state === "done" && readA().worktree === "" && taskClean(), 60000, "full pipeline + merge + done mirror commit", a.output);
for (const marker of ["spawned developer", "spawned reviewer", "spawned live-tester", "merged feat/smoke-test"]) {
	assert.ok(a.output().includes(marker), `expected daemon log to contain: ${marker}`);
}
assert.ok(!existsSync(join(rootA, ".worktrees", "feat/smoke-test")), "worktree removed");
// the board mirrors to refs/heads/meta/kanban via plumbing, never onto the current branch:
// done folds in the whole task life, exactly one create and one done commit, newest first;
// the merged work never touched .kanban and main history gets no board commits
const boardLog = mirrorSubjects(rootA).split("\n");
assert.deepEqual(boardLog, [`kanban: done ${taskA.file}`, `kanban: create ${taskA.file}`]);
assert.equal(execSync("git log --format=%s -- .kanban", { cwd: rootA, encoding: "utf8" }).trim(), "", "board commits landed on main history");
const committed = execSync(`git show refs/heads/meta/kanban:.kanban/${taskA.file}`, { cwd: rootA, encoding: "utf8", shell: "/bin/bash" });
assert.match(committed, /^state: "done"$/m);
assert.match(committed, /^worktree: ""$/m);
// auto-push: the board mirror reaches origin, and nothing else does
const mirrorSha = execSync("git rev-parse refs/heads/meta/kanban", { cwd: rootA, encoding: "utf8" }).trim();
assert.equal(execSync("git rev-parse refs/heads/meta/kanban", { cwd: remoteA, encoding: "utf8" }).trim(), mirrorSha, "meta/kanban auto-pushed to origin");
assert.equal(
	execSync("git for-each-ref --format='%(refname)' refs/heads", { cwd: remoteA, encoding: "utf8" }).trim(),
	"refs/heads/meta/kanban",
	"only meta/kanban is pushed to origin",
);
a.daemon.kill("SIGTERM");

// --- part B: dead agents get moved forward by the liveness poll, capped at 5 respawns ---
const rootB = fixture();
cleaned.push(rootB);
mkdirSync(kanbanDir(rootB), { recursive: true });
writeFileSync(join(kanbanDir(rootB), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootB), pollMinutes: 0.05 }));
const taskB = createTask(rootB, { name: "fix: dead agent", summary: "Liveness smoke", specs: "n/a" });
setState(rootB, taskB, "to-do");

const b = await runDaemon(rootB);
const readB = () => parseTask(rootB, taskB.file);
await waitFor(() => b.output().includes("giving up"), 60000, "respawn cap", b.output);
assert.equal(readB().state, "doing");
assert.ok(b.output().includes("doing -> to-do"), "poll moved the dead developer back to to-do");
b.daemon.kill("SIGTERM");

// --- part C: lock lifecycle: singleton, self-heal while running, release on stop ---
const rootC = fixture();
cleaned.push(rootC);
const c = await runDaemon(rootC);
const lockC = () => {
	try {
		return readFileSync(join(kanbanDir(rootC), ".orchestrator.lock"), "utf8").trim();
	} catch {
		return "";
	}
};
await waitFor(() => lockC() !== "", 10000, "lock acquired", c.output);
assert.equal(lockC(), String(c.daemon.pid), "lock holds the daemon pid");

// a second start attempt exits instead of becoming a daemon; the first keeps the lock
const second = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", rootC], { stdio: "ignore" });
const secondExit = await Promise.race([
	new Promise<string>((r) => second.on("exit", (code) => r(String(code)))),
	new Promise<string>((r) => setTimeout(() => r("timeout"), 10000)),
]);
second.kill("SIGTERM");
assert.equal(secondExit, "0", "second start attempt exits instead of becoming a daemon");
assert.equal(lockC(), String(c.daemon.pid), "lock still held by the first daemon");

// self-heal: the daemon re-acquires the lock when it goes missing mid-life
rmSync(join(kanbanDir(rootC), ".orchestrator.lock"));
await waitFor(() => lockC() === String(c.daemon.pid), 10000, "lock re-acquired after deletion", c.output);

// stop: SIGTERM ends the daemon and releases the lock
const stopped = new Promise<string>((r) => c.daemon.on("exit", (code) => r(String(code))));
c.daemon.kill("SIGTERM");
assert.equal(await Promise.race([stopped, new Promise<string>((r) => setTimeout(() => r("timeout"), 10000))]), "0", "daemon exits on SIGTERM");
await waitFor(() => lockC() === "", 10000, "lock released on stop", c.output);

// --- part D: the worktree board is a symlink to the shared board, invisible to the worktree's git ---
const rootD = fixture();
cleaned.push(rootD);
mkdirSync(kanbanDir(rootD), { recursive: true });
writeFileSync(join(kanbanDir(rootD), "se-llm-team.json"), JSON.stringify({ agent: devStub(rootD) }));
const taskD = createTask(rootD, { name: "feat: shared board", summary: "Symlink smoke", specs: "n/a" });
setState(rootD, taskD, "to-do");

const d = await runDaemon(rootD);
const wtD = join(rootD, ".worktrees", "feat/shared-board");
const wtBoardD = join(wtD, ".kanban");
await waitFor(
	() => {
		try {
			return lstatSync(wtBoardD).isSymbolicLink();
		} catch {
			return false;
		}
	},
	60000,
	"worktree board symlink",
	d.output,
);
assert.equal(readlinkSync(wtBoardD), kanbanDir(rootD)); // absolute path to the shared board
// the excludes setup lands milliseconds after the symlink: wait for convergence before asserting
await waitFor(
	() => {
		try {
			return !execSync("git status --porcelain", { cwd: wtD, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").some((l) => l.includes(".kanban"));
		} catch {
			return false;
		}
	},
	10000,
	"worktree git stops showing .kanban",
	d.output,
);
// the board is untracked (mirror commits never touch the index), so the worktree index
// carries no board entries at all and the symlink stays invisible to the worktree's git
assert.equal(execSync("git ls-files .kanban", { cwd: wtD, encoding: "utf8" }).trim(), "", "worktree index tracks no board entries");
// a blanket git add -A cannot stage board changes, and the shared board sees writes through the symlink
const wtTask = join(wtBoardD, taskD.file);
writeFileSync(wtTask, readFileSync(wtTask, "utf8").replace(/^state: .*/m, 'state: "doing"'));
assert.match(readFileSync(join(kanbanDir(rootD), taskD.file), "utf8"), /^state: "doing"$/m);
execSync("git add -A", { cwd: wtD });
assert.equal(
	execSync("git diff --cached --name-only", { cwd: wtD, encoding: "utf8" }).split("\n").filter((l) => l.includes(".kanban")).length,
	0,
	"blanket git add -A staged board changes",
);
d.daemon.kill("SIGTERM");

// --- part E: to-review and to-live-test tasks get their worktree ensured before the spawn ---
const rootE = fixture();
cleaned.push(rootE);
mkdirSync(kanbanDir(rootE), { recursive: true });
writeFileSync(join(kanbanDir(rootE), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootE) }));
const taskE = createTask(rootE, { name: "fix: review without worktree", summary: "Ensured worktree", specs: "n/a" });
setState(rootE, taskE, "to-review");

const e = await runDaemon(rootE);
const wtE = join(rootE, ".worktrees", "fix/review-without-worktree");
await waitFor(() => e.output().includes("spawned reviewer"), 30000, "reviewer spawn with ensured worktree", e.output);
assert.ok(existsSync(wtE), "worktree dir created for a to-review task with no worktree dir");
assert.ok(lstatSync(join(wtE, ".kanban")).isSymbolicLink(), "worktree board is a symlink to the shared board");
assert.ok(e.output().includes(`(cwd=${wtE})`), `reviewer spawn log shows an existing cwd: ${e.output()}`);
assert.equal(parseTask(rootE, taskE.file).worktree, "fix/review-without-worktree", "worktree recorded on the task");
e.daemon.kill("SIGTERM");

// a to-live-test task whose worktree cannot be created stays in to-live-test, never reaches done
const rootF = fixture();
cleaned.push(rootF);
mkdirSync(kanbanDir(rootF), { recursive: true });
writeFileSync(join(rootF, ".worktrees"), "not a dir\n"); // regular file blocks worktree creation
writeFileSync(join(kanbanDir(rootF), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootF) }));
const taskF = createTask(rootF, { name: "fix: blocked live test", summary: "Uncreatable worktree", specs: "n/a" });
setState(rootF, taskF, "to-live-test");

const f = await runDaemon(rootF);
await waitFor(() => f.output().includes("live-tester not spawned"), 30000, "spawn skipped for uncreatable worktree", f.output);
assert.equal(parseTask(rootF, taskF.file).state, "to-live-test", "stayed in to-live-test instead of reaching done");
assert.ok(!f.output().includes("spawned live-tester"), "live-tester never spawned");
f.daemon.kill("SIGTERM");

// --- part G: the done merge and commit wait for the task's registered agent to die ---
const rootG = fixture();
cleaned.push(rootG);
mkdirSync(kanbanDir(rootG), { recursive: true });
// live-tester stub that sets done, appends its report, then lingers alive before exiting
const lingerStub = join(rootG, "linger-agent.cjs");
writeFileSync(
	lingerStub,
	`#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const prompt = process.argv[4] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!prompt.includes("Live-tester") || !file) process.exit(0);
writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, 'state: "done"'));
appendFileSync(file, "\\nLive test report: merge waited for the live-tester pid.\\n");
setTimeout(() => process.exit(0), 5000);
`,
	{ mode: 0o755 },
);
writeFileSync(join(kanbanDir(rootG), "se-llm-team.json"), JSON.stringify({ agent: lingerStub, pollMinutes: 0.05 }));
const taskG = createTask(rootG, { name: "fix: defer merge while alive", summary: "Deferred merge smoke", specs: "n/a" });
setState(rootG, taskG, "to-live-test");

const g = await runDaemon(rootG);
const wtG = join(rootG, ".worktrees", "fix/defer-merge-while-alive");
await waitFor(() => parseTask(rootG, taskG.file).state === "done", 30000, "live-tester set done", g.output);
// the stub lingers 5s and the daemon rescans every 1s, so sweeps ran while the pid was alive:
// no merge, no worktree removal, no done commit
await new Promise((r) => setTimeout(r, 2000));
assert.ok(existsSync(wtG), "worktree kept while the live-tester pid is alive");
assert.ok(!mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), "no done mirror commit while the live-tester pid is alive");
// once the agent exits, the deferred merge and the done mirror commit run and fold in the report
await waitFor(() => !existsSync(wtG), 30000, "merge after agent death", g.output);
await waitFor(() => mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), 30000, "deferred done mirror commit", g.output);
const committedG = execSync(`git show refs/heads/meta/kanban:.kanban/${taskG.file}`, { cwd: rootG, encoding: "utf8", shell: "/bin/bash" });
assert.match(committedG, /Live test report: merge waited for the live-tester pid\./, "report folded into the done mirror commit");
g.daemon.kill("SIGTERM");

// --- part H: the main-entry guard holds when the daemon is spawned through a symlink ---
// pi loads the extension (which computes the daemon path from import.meta.url) through a
// symlink, so the tool spawns the daemon through a symlinked path; the guard must still run main
const rootH = fixture();
cleaned.push(rootH);
const symDir = mkdtempSync(join(tmpdir(), "orch-sym-"));
const symScript = join(symDir, "orchestrator.ts");
symlinkSync(join(HERE, "orchestrator.ts"), symScript);
const h = await runDaemon(rootH, symScript);
await waitFor(() => h.output().includes("orchestrator started"), 10000, "daemon start through symlinked script", h.output);
assert.ok(existsSync(join(kanbanDir(rootH), ".orchestrator.lock")), "lock created when spawned through a symlink");
h.daemon.kill("SIGTERM");
rmSync(symDir, { recursive: true, force: true });

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn smoke passed");

// --- part I: pid 0 is dead and a failed spawn writes no pid file, so the poll bounces per DEAD_TRANSITIONS ---
assert.equal(pidAlive(0), false, "pid 0 is the caller's process group, not a live agent");
assert.equal(pidAlive(-1), false, "negative pids are not alive");
assert.equal(pidAlive(process.pid), true, "a live pid is alive");

const rootI = fixture();
cleaned.push(rootI);
mkdirSync(kanbanDir(rootI), { recursive: true });
// missing executable: every spawn fails with ENOENT and reports no pid
writeFileSync(join(kanbanDir(rootI), "se-llm-team.json"), JSON.stringify({ agent: join(rootI, "missing-agent"), pollMinutes: 0.05 }));
const taskI = createTask(rootI, { name: "fix: failed spawn", summary: "Missing agent smoke", specs: "n/a" });
setState(rootI, taskI, "to-do");

const hi = await runDaemon(rootI);
const readI = () => parseTask(rootI, taskI.file);
await waitFor(() => hi.output().includes("failed to start"), 30000, "spawn failure logged", hi.output);
const pidsI = () => {
	try {
		return readdirSync(join(kanbanDir(rootI), ".pids"));
	} catch {
		return [];
	}
};
assert.deepEqual(pidsI(), [], "failed spawn left no pid file");
// agentPid reads 0 for the missing pid file and pidAlive(0) is false, so the poll
// bounces doing -> to-do per DEAD_TRANSITIONS and the rescan retries the spawn
await waitFor(() => hi.output().includes("agent pid=0 dead without state update, doing -> to-do"), 30000, "poll bounced the doing task", hi.output);
await waitFor(() => hi.output().includes("giving up"), 60000, "respawn cap on repeated failed spawns", hi.output);
assert.deepEqual(pidsI(), [], "still no pid file after repeated failed spawns");
assert.equal(readI().state, "doing");
hi.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard smoke passed");

// --- part J: a conflict-marked task file is left untouched until the merger resolves it ---
const rootJ = fixture();
cleaned.push(rootJ);
mkdirSync(kanbanDir(rootJ), { recursive: true });
writeFileSync(join(kanbanDir(rootJ), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootJ), pollMinutes: 0.05 }));
const taskJ = createTask(rootJ, { name: "fix: conflicted task", summary: "Mid-merge conflict", specs: "n/a" });
setState(rootJ, taskJ, "to-do");
// simulate a mid-merge conflict on the task file itself: git leaves both markers in the
// working-tree file, and the merged-in side's state line sits last in the frontmatter
const taskFileJ = join(kanbanDir(rootJ), taskJ.file);
writeFileSync(
	taskFileJ,
	readFileSync(taskFileJ, "utf8").replace(
		/^state: "to-do"$/m,
		'<<<<<<< HEAD\nstate: "done"\n=======\nstate: "to-live-test"\n>>>>>>> fix/other-branch',
	),
);
const rawJ = readFileSync(taskFileJ, "utf8");

const j = await runDaemon(rootJ);
await new Promise((r) => setTimeout(r, 4000)); // a few sweeps and liveness polls
assert.ok(!j.output().includes("spawned developer"), "no agent spawned from a conflicted task file");
assert.ok(j.output().includes("unresolved merge conflict markers"), "daemon logs the skipped conflicted file");
assert.equal(readFileSync(taskFileJ, "utf8"), rawJ, "conflicted task file untouched by the daemon");
j.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip smoke passed");

// --- part K: past the merge cap, sweeps stop bumping the counter and stop logging the give-up ---
const rootK = fixture();
cleaned.push(rootK);
mkdirSync(kanbanDir(rootK), { recursive: true });
// a branch that conflicts with main: both edit README.md
execSync("git checkout -qb fix/conflict", { cwd: rootK, shell: "/bin/bash" });
writeFileSync(join(rootK, "README.md"), "branch\n");
execSync("git commit -qam branch", { cwd: rootK, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootK, shell: "/bin/bash" });
writeFileSync(join(rootK, "README.md"), "main\n");
execSync("git commit -qam main", { cwd: rootK, shell: "/bin/bash" });
writeFileSync(join(kanbanDir(rootK), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootK), pollMinutes: 0.05 }));
const taskK = createTask(rootK, { name: "fix: stuck conflict", summary: "Merge cap smoke", specs: "n/a" });
setState(rootK, taskK, "done");
setWorktree(rootK, taskK, "fix/conflict");

const k = await runDaemon(rootK);
const slugK = taskK.file.replace(/\.md$/, "");
const attemptsK = () => {
	try {
		return parseInt(readFileSync(join(kanbanDir(rootK), ".logs", `${slugK}.merge-attempts.count`), "utf8").trim(), 10) || 0;
	} catch {
		return 0;
	}
};
const giveUpsK = () => k.output().split("left for manual resolution").length - 1;
// the merger dies without resolving, so every sweep conflicts: attempts 1-3 spawn mergers,
// the 4th logs the give-up once, and later sweeps change nothing
await waitFor(() => giveUpsK() > 0, 30000, "merge give-up logged at the cap", k.output);
await waitFor(() => attemptsK() === 4, 10000, "counter frozen at cap+1", k.output);
assert.ok(k.output().includes("spawning merger (attempt 1)"), "merger spawned on the first conflict");
assert.ok(k.output().includes("spawning merger (attempt 3)"), "merger spawned on the third conflict");
assert.ok(!k.output().includes("spawning merger (attempt 4)"), "no merger past the cap");
assert.equal(giveUpsK(), 1, "give-up logged exactly once");
// three more sweeps: counter frozen, no new give-up line
await new Promise((r) => setTimeout(r, 3500));
assert.equal(attemptsK(), 4, "counter unchanged past the cap");
assert.equal(giveUpsK(), 1, "give-up not logged again past the cap");
assert.equal(parseTask(rootK, taskK.file).state, "done", "stuck task stays done for manual resolution");
k.daemon.kill("SIGTERM");

// --- part L: bootstrap materializes board files missing from .kanban/ from the mirror branch ---
const rootL = fixture();
cleaned.push(rootL);
mkdirSync(kanbanDir(rootL), { recursive: true });
writeFileSync(join(kanbanDir(rootL), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootL), pollMinutes: 0.05 }));
const taskL = createTask(rootL, { name: "fix: bootstrap board", summary: "Bootstrap smoke", specs: "n/a" });
// board content on refs/heads/meta/kanban via the same plumbing the daemon uses, then the
// working board file removed: the daemon must materialize it on startup (fresh clone)
const shaL = execSync(`git hash-object -w .kanban/${taskL.file}`, { cwd: rootL, encoding: "utf8", shell: "/bin/bash" }).trim();
const boardTreeL = execSync("git mktree", { cwd: rootL, input: `100644 blob ${shaL}\t${taskL.file}\n`, encoding: "utf8" }).trim();
const rootTreeL = execSync("git mktree", { cwd: rootL, input: `040000 tree ${boardTreeL}\t.kanban\n`, encoding: "utf8" }).trim();
const commitL = execSync(`git commit-tree ${rootTreeL} -m "kanban: create ${taskL.file}"`, { cwd: rootL, encoding: "utf8", shell: "/bin/bash" }).trim();
execSync(`git update-ref refs/heads/meta/kanban ${commitL}`, { cwd: rootL, shell: "/bin/bash" });
const contentL = readFileSync(join(kanbanDir(rootL), taskL.file), "utf8");
rmSync(join(kanbanDir(rootL), taskL.file));

const l = await runDaemon(rootL);
await waitFor(() => existsSync(join(kanbanDir(rootL), taskL.file)), 10000, "bootstrap materialized the board from the mirror branch", l.output);
assert.equal(readFileSync(join(kanbanDir(rootL), taskL.file), "utf8"), contentL, "bootstrapped content matches the mirror branch");
// the bootstrapped file is already on the mirror: no duplicate commits, nothing on main
await new Promise((r) => setTimeout(r, 2500));
assert.equal(mirrorSubjects(rootL), `kanban: create ${taskL.file}`, "bootstrap adds no mirror commits");
assert.equal(execSync("git log --format=%s -- .kanban", { cwd: rootL, encoding: "utf8" }).trim(), "", "bootstrap commits nothing on main");
l.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cap + mirror board + bootstrap smoke passed");

// --- part M: a fresh non-bare clone bootstraps the board from origin's meta/kanban ---
// a fresh `git clone` carries only refs/remotes/origin/meta/kanban, no local branch: the
// daemon must seed refs/heads/meta/kanban from it so the board materializes and the first
// board change mirrors with a parent (fast-forward push instead of an orphan commit)
const rootM = fixture();
cleaned.push(rootM);
const remoteM = `${rootM}-origin.git`;
execSync(`git init -q --bare ${remoteM}`, { shell: "/bin/bash" });
execSync(`git remote add origin ${remoteM}`, { cwd: rootM, shell: "/bin/bash" });
mkdirSync(kanbanDir(rootM), { recursive: true });
const taskM = createTask(rootM, { name: "fix: fresh clone bootstrap", summary: "Fresh clone bootstrap smoke", specs: "n/a" });
setState(rootM, taskM, "done");
setWorktree(rootM, taskM, "");
// board content on the mirror via the same plumbing the daemon uses, then both branches pushed
const shaM = execSync(`git hash-object -w .kanban/${taskM.file}`, { cwd: rootM, encoding: "utf8", shell: "/bin/bash" }).trim();
const boardTreeM = execSync("git mktree", { cwd: rootM, input: `100644 blob ${shaM}\t${taskM.file}\n`, encoding: "utf8" }).trim();
const rootTreeM = execSync("git mktree", { cwd: rootM, input: `040000 tree ${boardTreeM}\t.kanban\n`, encoding: "utf8" }).trim();
const commitM = execSync(`git commit-tree ${rootTreeM} -m "kanban: create ${taskM.file}"`, { cwd: rootM, encoding: "utf8", shell: "/bin/bash" }).trim();
execSync(`git update-ref refs/heads/meta/kanban ${commitM}`, { cwd: rootM, shell: "/bin/bash" });
execSync("git push -q --all origin", { cwd: rootM, shell: "/bin/bash" });
execSync("git push -q origin meta/kanban", { cwd: rootM, shell: "/bin/bash" });
// fresh non-bare clone: empty .kanban/ and only the remote-tracking mirror ref
const cloneM = `${rootM}-clone`;
execSync(`git clone -q ${remoteM} ${cloneM}`, { shell: "/bin/bash" });
cleaned.push(cloneM);
assert.equal(execSync("git branch --list meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim(), "", "precondition: fresh clone has no local meta/kanban");
assert.ok(execSync("git rev-parse --verify refs/remotes/origin/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim(), "precondition: clone has the remote-tracking mirror ref");
// a fresh clone is configured before the daemon runs, like a real setup
mkdirSync(kanbanDir(cloneM), { recursive: true });
writeFileSync(join(kanbanDir(cloneM), "se-llm-team.json"), JSON.stringify({ agent: deadStub(cloneM), pollMinutes: 0.05 }));

const m = await runDaemon(cloneM);
await waitFor(() => existsSync(join(kanbanDir(cloneM), taskM.file)), 10000, "bootstrap materialized the board in a fresh clone", m.output);
assert.ok(m.output().includes("seeded refs/heads/meta/kanban from refs/remotes/origin/meta/kanban"), "daemon logged the mirror seed");
const seededShaM = execSync("git rev-parse refs/heads/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim();
assert.equal(seededShaM, commitM, "local mirror branch seeded from the remote-tracking ref");
assert.equal(readFileSync(join(kanbanDir(cloneM), taskM.file), "utf8"), readFileSync(join(kanbanDir(rootM), taskM.file), "utf8"), "bootstrapped content matches origin's board");
assert.equal(execSync("git log --format=%s -- .kanban", { cwd: cloneM, encoding: "utf8" }).trim(), "", "bootstrap commits nothing on main");
// the first board change in the clone mirrors with a parent and pushes fast-forward to origin
appendFileSync(join(kanbanDir(cloneM), taskM.file), "\nNote: post-clone board change.\n");
await waitFor(
	() => execSync("git rev-parse refs/remotes/origin/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim() !== seededShaM,
	30000,
	"post-clone mirror commit pushed to origin",
	m.output,
);
const advancedShaM = execSync("git rev-parse refs/heads/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim();
assert.equal(execSync("git rev-parse refs/remotes/origin/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim(), advancedShaM, "remote-tracking ref advanced with the push");
assert.equal(execSync("git rev-parse refs/heads/meta/kanban", { cwd: remoteM, encoding: "utf8" }).trim(), advancedShaM, "origin's meta/kanban advanced to the clone's commit");
assert.deepEqual(mirrorSubjects(cloneM).split("\n"), [`kanban: done ${taskM.file}`, `kanban: create ${taskM.file}`], "mirror commit has a parent, no orphan");
assert.ok(!m.output().includes("push of refs/heads/meta/kanban failed"), "no push failures");
m.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: all smoke parts passed (pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cap + mirror board + bootstrap + fresh-clone bootstrap)");

// --- part N: the board-feed wait resolves from the main checkout even when the session cwd is a worktree ---
const rootN = fixture();
cleaned.push(rootN);
execSync("git worktree add -q -b feat/session .worktrees/feat/session", { cwd: rootN, shell: "/bin/bash" });
const wtN = join(rootN, ".worktrees", "feat/session");
// pin the session cwd's HEAD at its own advanced branch tip, like a task worktree: a
// HEAD-based wait would satisfy itself on worktree commits and never see the board feed
writeFileSync(join(wtN, "session.txt"), "session work\n");
execSync("git add -A && git commit -qm 'session work'", { cwd: wtN, shell: "/bin/bash" });
const mirrorCommit = (message: string) => {
	const tree = execSync("git rev-parse HEAD^{tree}", { cwd: rootN, encoding: "utf8", shell: "/bin/bash" }).trim();
	const commit = execSync(`git commit-tree ${tree} -m '${message}'`, { cwd: rootN, encoding: "utf8", shell: "/bin/bash" }).trim();
	execSync(`git update-ref refs/heads/meta/kanban ${commit}`, { cwd: rootN, shell: "/bin/bash" });
};
// baseline mirror commit, wait starts from the worktree cwd, then the kanban: done commit lands
// in the main checkout: the wait must report it
mirrorCommit("kanban: create 000042_fix_feed.md");
const waitN = waitForBoardCommits(wtN, 15);
await new Promise((r) => setTimeout(r, 500));
mirrorCommit("kanban: done 000042_fix_feed.md");
assert.deepEqual(await waitN, ["kanban: done 000042_fix_feed.md"], "wait from a worktree cwd sees main-checkout board commits");
// the wait started after that baseline: an unrelated mirror commit does not satisfy it
const waitN2 = waitForBoardCommits(wtN, 1);
mirrorCommit("unrelated mirror commit");
assert.deepEqual(await waitN2, [], "unrelated commits do not satisfy the wait; it times out");

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cap + mirror board + bootstrap + fresh-clone bootstrap + worktree-cwd board-feed wait passed");

// --- part O: a settled done task without a worktree must not swallow create events ---
// the old code issued a "kanban: done" commit every sweep for such a task; commitKanban
// rebuilds the tree from the whole board, so the first of those folded a newly created
// task's file in under the done label and the create commit became a no-op
const rootO = fixture();
cleaned.push(rootO);
mkdirSync(kanbanDir(rootO), { recursive: true });
writeFileSync(join(kanbanDir(rootO), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootO), pollMinutes: 0.05 }));
const taskO1 = createTask(rootO, { name: "fix: settled done task", summary: "Settled", specs: "n/a" });
setState(rootO, taskO1, "done");

const mo = await runDaemon(rootO);
await waitFor(() => mirrorSubjects(rootO) !== "", 10000, "settled done task mirrored", mo.output);
// a new task arrives while the settled done task exists: it must get its own create commit
const taskO2 = createTask(rootO, { name: "fix: late arrival", summary: "Created after a done task", specs: "n/a" });
await waitFor(() => mirrorSubjects(rootO).includes(`kanban: create ${taskO2.file}`), 10000, "late task create commit", mo.output);
// further sweeps change nothing: no done-label folding, no commit churn
await new Promise((r) => setTimeout(r, 2500));
assert.deepEqual(mirrorSubjects(rootO).split("\n"), [`kanban: create ${taskO2.file}`, `kanban: create ${taskO1.file}`]);
mo.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + settled done task create-event smoke passed");

// --- part P: an external mirror-head move is reconciled into the working tree within one scan
// (external add and external deletion both propagate; the reconcile itself commits nothing)
const rootP = fixture();
cleaned.push(rootP);
mkdirSync(kanbanDir(rootP), { recursive: true });
writeFileSync(join(kanbanDir(rootP), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootP), pollMinutes: 0.05 }));
const taskP = createTask(rootP, { name: "fix: external move", summary: "Reconcile smoke", specs: "n/a" });
const p = await runDaemon(rootP);
await waitFor(() => mirrorSubjects(rootP) !== "", 30000, "task mirrored", p.output);
const contentP = readFileSync(join(kanbanDir(rootP), taskP.file), "utf8");
// the tip gains a task while the working tree lacks it: one scan must materialize it
const externalP = "000002_feat_external_task.md";
const externalContentP = taskContent("fix: external task");
const extP = externalCommit(rootP, { [taskP.file]: contentP, [externalP]: externalContentP }, "external: add a task");
await waitFor(() => existsSync(join(kanbanDir(rootP), externalP)), 10000, "external add materialized within one scan", p.output);
assert.equal(readFileSync(join(kanbanDir(rootP), externalP), "utf8"), externalContentP, "external content materialized byte-for-byte");
// the tip then loses it again: the deletion propagates to the working tree
const extP2 = externalCommit(rootP, { [taskP.file]: contentP }, "external: drop a task");
await waitFor(() => !existsSync(join(kanbanDir(rootP), externalP)), 10000, "external deletion propagated to the working tree", p.output);
assert.equal(readFileSync(join(kanbanDir(rootP), taskP.file), "utf8"), contentP, "untouched task file unchanged by the reconcile");
assert.ok(showTip(rootP, taskP.file) !== null, "the untouched task stays on the branch");
// the reconcile itself commits nothing: the board already matches the tip
await new Promise((r) => setTimeout(r, 2500));
assert.deepEqual(
	mirrorSubjects(rootP).split("\n").filter((s) => s.startsWith("kanban:")),
	[`kanban: create ${taskP.file}`],
	"reconcile adds no mirror commits",
);
await waitFor(() => p.output().includes(`reconciled .kanban to ${extP2}`), 10000, "reconcile logged", p.output);
assert.ok(p.output().includes(`reconciled .kanban to ${extP}: 1 file(s) updated, 0 deleted`), "reconcile log line carries hash, updated and deleted counts");
assert.ok(p.output().includes(`reconciled .kanban to ${extP2}: 0 file(s) updated, 1 deleted`), "deletion reconcile logged with counts");
p.daemon.kill("SIGTERM");

// --- part Q: a stale working tree never erases branch-only files, and an unmirrored local
// write survives the reconcile: the next mirror commit is built after the reconcile, so the
// branch-only file folds in instead of being dropped
const rootQ = fixture();
cleaned.push(rootQ);
mkdirSync(kanbanDir(rootQ), { recursive: true });
writeFileSync(join(kanbanDir(rootQ), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootQ), pollMinutes: 0.05 }));
const taskQ = createTask(rootQ, { name: "fix: no branch erase", summary: "Reconcile smoke", specs: "n/a" });
const q = await runDaemon(rootQ);
await waitFor(() => mirrorSubjects(rootQ).includes(`kanban: create ${taskQ.file}`), 30000, "task mirrored", q.output);
// branch-only file: the tip gains it while the working tree lacks it (the drift that used to erase it)
const externalQ = "000002_feat_branch_only.md";
const externalContentQ = taskContent("fix: branch-only task");
const extQ = externalCommit(rootQ, { [taskQ.file]: readFileSync(join(kanbanDir(rootQ), taskQ.file), "utf8"), [externalQ]: externalContentQ }, "external: add a branch-only task");
// an in-flight PM write, never mirrored: the reconcile that materializes the branch-only
// file must keep it
const inflightQ = "000009_feat_in_flight_write.md";
const inflightContentQ = taskContent("feat: in-flight write");
writeFileSync(join(kanbanDir(rootQ), inflightQ), inflightContentQ);
await waitFor(() => existsSync(join(kanbanDir(rootQ), externalQ)), 10000, "branch-only file materialized", q.output);
assert.ok(existsSync(join(kanbanDir(rootQ), inflightQ)), "unmirrored in-flight write survives the reconcile");
// the next mirror commit (the in-flight file's own create) must carry the branch-only file
await waitFor(() => showTip(rootQ, externalQ) !== null && execSync(`git rev-parse refs/heads/meta/kanban`, { cwd: rootQ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() !== extQ, 10000, "next mirror commit keeps the branch-only file", q.output);
assert.equal(showTip(rootQ, externalQ), externalContentQ, "branch-only file survived the next mirror commit");
assert.ok(mirrorSubjects(rootQ).includes(`kanban: create ${inflightQ}`), "in-flight write got its own create commit");
assert.equal(showTip(rootQ, inflightQ), inflightContentQ, "in-flight write mirrored after the reconcile");
q.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + mirror reconcile smoke passed");

// --- part R: the failsafe promotes the oldest highest-priority backlog task after the idle window ---
const rootR = fixture();
cleaned.push(rootR);
mkdirSync(kanbanDir(rootR), { recursive: true });
// 0.05min = 3s idle window; the dead stub keeps any started task active forever (to-do/doing cycle)
writeFileSync(join(kanbanDir(rootR), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootR), pollMinutes: 0.05, autoScheduleMinutes: 0.05 }));
const taskR0 = createTask(rootR, { name: "feat: active task", summary: "Failsafe smoke", specs: "n/a" });
const taskR1 = createTask(rootR, { name: "feat: older critical", priority: "critical", summary: "Failsafe smoke", specs: "n/a" });
const taskR3 = createTask(rootR, { name: "feat: newer critical", priority: "critical", summary: "Failsafe smoke", specs: "n/a" });
const taskR2 = createTask(rootR, { name: "feat: low task", priority: "low", summary: "Failsafe smoke", specs: "n/a" });
setState(rootR, taskR0, "to-do");

const r = await runDaemon(rootR);
const readR = (file: string) => parseTask(rootR, file);
// while taskR0 cycles to-do/doing the board is never idle: no promotion despite the elapsed window
await new Promise((res) => setTimeout(res, 10000));
assert.ok(!r.output().includes("promoting"), "no promotion while a task is active");

// the respawn cap exhausts and the poll stops rewriting taskR0: settling it done makes the board idle
await waitFor(() => r.output().includes("giving up"), 60000, "respawn cap on the active task", r.output);
writeFileSync(
	join(kanbanDir(rootR), taskR0.file),
	readFileSync(join(kanbanDir(rootR), taskR0.file), "utf8").replace(/^state: .*/m, 'state: "done"'),
);
// the window elapses: the failsafe promotes the older critical task, not the newer one or the low one
await waitFor(() => r.output().includes(`promoting ${taskR1.file} to to-do`), 30000, "failsafe promotion of the oldest critical task", r.output);
assert.ok(["to-do", "doing"].includes(readR(taskR1.file).state), "promoted task is active");
assert.equal(readR(taskR2.file).state, "backlog", "lower priority not promoted first");
assert.equal(readR(taskR3.file).state, "backlog", "newer task in the same priority not promoted first");
// the promoted task stays active, so the window never re-arms: no second promotion
await new Promise((res) => setTimeout(res, 8000));
assert.equal(readR(taskR2.file).state, "backlog", "no second promotion while the promoted task is active");
assert.equal(readR(taskR3.file).state, "backlog", "no second promotion while the promoted task is active");
assert.equal(r.output().split("promoting ").length - 1, 1, "exactly one promotion logged");
r.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + failsafe auto-schedule smoke passed");
