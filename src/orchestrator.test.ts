import assert from "node:assert/strict";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, kanbanDir, parseTask, setState, setWorktree } from "./kanban.ts";
import { pidAlive } from "./orchestrator.ts";

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
mkdirSync(kanbanDir(rootA), { recursive: true });
writeFileSync(join(kanbanDir(rootA), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootA), pollMinutes: 0.05 }));
const taskA = createTask(rootA, { name: "feat: smoke test", summary: "Pipeline smoke", specs: "Run the full pipeline" });
setState(rootA, taskA, "to-do");

const a = await runDaemon(rootA);
const readA = () => parseTask(rootA, taskA.file);

const taskClean = () => !execSync(`git status --porcelain -- .kanban/${taskA.file}`, { cwd: rootA, encoding: "utf8" }).trim();
// to-do -> doing -> to-review -> reviewing -> to-live-test -> live-testing -> done -> merge -> done commit.
// The stub transitions in milliseconds, so intermediate states are asserted through the daemon log.
await waitFor(() => readA().state === "done" && readA().worktree === "" && taskClean(), 60000, "full pipeline + merge + done commit", a.output);
for (const marker of ["spawned developer", "spawned reviewer", "spawned live-tester", "merged feat/smoke-test"]) {
	assert.ok(a.output().includes(marker), `expected daemon log to contain: ${marker}`);
}
assert.ok(!existsSync(join(rootA, ".worktrees", "feat/smoke-test")), "worktree removed");
// the daemon is the sole committer: done folds in the whole task life, exactly one
// create and one done board commit, nothing else; the merged work never touched .kanban
await waitFor(
	() => execSync(`git status --porcelain -- .kanban/${taskA.file}`, { cwd: rootA, encoding: "utf8" }).trim() === "",
	60000,
	"done commit",
	a.output,
	rootA,
);
const boardLog = execSync("git log --format=%s -- .kanban", { cwd: rootA, encoding: "utf8" }).trim().split("\n");
assert.deepEqual(boardLog, [`kanban: done ${taskA.file}`, `kanban: create ${taskA.file}`]); // newest first
const committed = execSync(`git show HEAD:.kanban/${taskA.file}`, { cwd: rootA, encoding: "utf8", shell: "/bin/bash" });
assert.match(committed, /^state: "done"$/m);
assert.match(committed, /^worktree: ""$/m);
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
	rootD,
);
assert.equal(readlinkSync(wtBoardD), kanbanDir(rootD)); // absolute path to the shared board
const tags = execSync("git ls-files -v .kanban", { cwd: wtD, encoding: "utf8" }).trim().split("\n");
assert.ok(tags.length > 0, "stale board entries are tracked in the worktree");
assert.ok(tags.every((l) => l.startsWith("S ")), `expected skip-worktree on all board entries: ${tags.join(", ")}`);
assert.equal(
	execSync("git status --porcelain", { cwd: wtD, encoding: "utf8" }).split("\n").filter((l) => l.includes(".kanban")).length,
	0,
	"worktree git status shows no .kanban entries",
);
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
assert.ok(
	execSync(`git status --porcelain -- .kanban/${taskG.file}`, { cwd: rootG, encoding: "utf8" }).trim() !== "",
	"no done commit while the live-tester pid is alive",
);
// once the agent exits, the deferred merge and the done commit run and fold in the report
await waitFor(() => !existsSync(wtG), 30000, "merge after agent death", g.output);
await waitFor(
	() => execSync(`git status --porcelain -- .kanban/${taskG.file}`, { cwd: rootG, encoding: "utf8" }).trim() === "",
	30000,
	"deferred done commit",
	g.output,
);
const committedG = execSync(`git show HEAD:.kanban/${taskG.file}`, { cwd: rootG, encoding: "utf8", shell: "/bin/bash" });
assert.match(committedG, /Live test report: merge waited for the live-tester pid\./, "report folded into the done commit");
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

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cap smoke passed");
