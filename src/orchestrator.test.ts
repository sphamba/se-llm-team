import assert from "node:assert/strict";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHubRegistry, startHub } from "./hub.ts";
import { createTask, kanbanDir, parseTask, setState, setWorktree } from "./kanban.ts";
import { pidAlive, removeTask, waitForBoardCommits } from "./orchestrator.ts";

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
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
if (prompt.includes("Developer agent")) {
	// emit JSONL only when spawned with --mode json, print-mode final text otherwise, so the
	// developer-log assertion below actually verifies the orchestrator's spawn args
	const m = process.argv.indexOf("--mode");
	if (m !== -1 && process.argv[m + 1] === "json") {
		process.stdout.write(JSON.stringify({ type: "session", version: 3, id: "s", timestamp: 0, cwd: process.cwd() }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "working" } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "git status" } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: "work" } }) + "\\n");
	} else {
		process.stdout.write("final text only\\n");
	}
	writeFileSync("code.txt", "work\\n");
	execSync("git add -A && git commit -qm work", { stdio: "ignore" });
}
if (prompt.includes("Merger agent")) {
	// the merger runs from the root: merge the branch into main, abort on conflict and requeue
	const wt = (readFileSync(file, "utf8").match(/^worktree: "(.*)"$/m) ?? [])[1];
	let merged = false;
	if (wt) {
		try {
			execSync("git merge --no-edit " + wt, { stdio: "ignore" });
			merged = true;
		} catch (e) {
			try { execSync("git merge --abort", { stdio: "ignore" }); } catch (e2) {}
		}
	}
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + (merged ? "done" : "to-merge")));
	process.exit(0);
}
const next = prompt.includes("Developer agent") ? "to-review"
	: prompt.includes("Reviewer agent") ? "to-live-test"
	: prompt.includes("Live-tester") ? "to-merge" : null;
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
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
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

async function runDaemon(root: string, script = join(HERE, "orchestrator.ts"), home?: string) {
	const daemon = spawn(
		process.execPath,
		[script, "--root", root, "--rescan-seconds", "1", "--poll-minutes", "0.05"],
		{ stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SE_LLM_TEAM_NO_WEBUI: "1", ...(home ? { HOME: home } : {}) } },
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
// a legacy unsuffixed log from the old naming: never renamed or rewritten, and it never
// counts toward the per-run index, so the first indexed run is still 0
const slugA = taskA.file.replace(/\.md$/, "");
mkdirSync(join(kanbanDir(rootA), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootA), ".logs", `${slugA}.developer.log`), "legacy\n");

const a = await runDaemon(rootA);
const readA = () => parseTask(rootA, taskA.file);

const taskClean = () => mirrorSubjects(rootA).includes(`kanban: done ${taskA.file}`);
// to-do -> doing -> to-review -> reviewing -> to-live-test -> live-testing -> to-merge -> merging -> done ->
// done mirror commit (the merger merged the branch, the done cleanup removed the worktree).
// The stub transitions in milliseconds, so intermediate states are asserted through the daemon log.
await waitFor(() => readA().state === "done" && readA().worktree === "" && taskClean(), 60000, "full pipeline + merge + done mirror commit", a.output);
for (const marker of ["spawned developer", "spawned reviewer", "spawned live-tester", "spawned merger", "merged feat/1-smoke-test"]) {
	assert.ok(a.output().includes(marker), `expected daemon log to contain: ${marker}`);
}
assert.ok(!existsSync(join(rootA, ".worktrees", "feat/1-smoke-test")), "worktree removed");
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
// --mode json: the agent log carries the full JSONL event stream (message, thinking, tool
// events), not print mode's final text only; per-run naming: the first indexed run is 0
const logsA = join(kanbanDir(rootA), ".logs");
const devLogA = readFileSync(join(logsA, `${slugA}.developer.0.log`), "utf8");
for (const record of ['"type":"message_update"', '"type":"tool_execution_start"', '"type":"message_end"']) {
	assert.ok(devLogA.includes(record), `developer log carries JSONL ${record}`);
}
assert.ok(existsSync(join(logsA, `${slugA}.reviewer.0.log`)) && existsSync(join(logsA, `${slugA}.live-tester.0.log`)), "reviewer and live-tester runs got indexed log files");
assert.equal(readFileSync(join(logsA, `${slugA}.developer.log`), "utf8"), "legacy\n", "legacy unsuffixed log never renamed or rewritten");
// the reviewer's approval (to-live-test) is a successful run: counted once per task
assert.equal(readFileSync(join(logsA, `${slugA}.reviewer-runs.count`), "utf8").trim(), "1", "reviewer approval counted as one successful run");
a.daemon.kill("SIGTERM");

// --- part B: dead agents bounce unconditionally; past the respawn cap the fresh spawn waits for the idle cooldown ---
const rootB = fixture();
cleaned.push(rootB);
mkdirSync(kanbanDir(rootB), { recursive: true });
writeFileSync(join(kanbanDir(rootB), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootB), pollMinutes: 0.05 }));
const taskB = createTask(rootB, { name: "fix: dead agent", summary: "Liveness smoke", specs: "n/a" });
setState(rootB, taskB, "to-do");
// a second task in live-testing with a branch: covers the poll's live-testing -> to-merge
// advance and the dead merger's merging -> to-merge requeue
const taskB2 = createTask(rootB, { name: "fix: dead merger", summary: "Liveness smoke", specs: "n/a" });
execSync("git checkout -qb feat/dead-merger && git commit -q --allow-empty -m x && git checkout -q main", { cwd: rootB, shell: "/bin/bash" });
setWorktree(rootB, taskB2, "feat/dead-merger");
setState(rootB, taskB2, "live-testing");

const b = await runDaemon(rootB);
const slugB = taskB.file.replace(/\.md$/, "");
const bouncesB = () => b.output().split("doing -> to-do").length - 1;
// six deaths, six bounces: the poll never freezes the task at the respawn cap
await waitFor(() => bouncesB() >= 6, 90000, "six unconditional bounces past the respawn cap", b.output);
assert.ok(b.output().includes("doing -> to-do"), "poll moved the dead developer back to to-do");
// under the cap each respawn was immediate: the first six runs kept pace with the 3s poll
for (let n = 0; n <= 5; n++) {
	assert.ok(existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.${n}.log`)), `developer run ${n} logged`);
}
// the cooldown log fired once at cap+1, and the deferred spawn has not fired yet
await waitFor(() => b.output().includes("respawn waits for the idle cooldown"), 30000, "cooldown log at cap+1", b.output);
assert.equal(b.output().split("respawn waits for the idle cooldown").length - 1, 1, "cooldown log fired exactly once");
assert.ok(!existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.6.log`)), "no fresh spawn while the idle cooldown runs");
// the death counter survived the cooldown wait: a bounce clears the pidfile first, so the
// completed-run counter clear does not misfire on the waiting task
assert.equal(readFileSync(join(kanbanDir(rootB), ".logs", `${slugB}.dead.count`), "utf8").trim(), "6", "death counter intact during the cooldown wait");
// aging the task file past the idle interval releases the deferred respawn
const taskBPath = join(kanbanDir(rootB), taskB.file);
const aged = new Date(Date.now() - 6 * 60_000);
utimesSync(taskBPath, aged, aged);
await waitFor(() => existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.6.log`)), 30000, "fresh spawn after the idle cooldown", b.output);
// the 7th death bounced again with no second cooldown log
assert.equal(b.output().split("respawn waits for the idle cooldown").length - 1, 1, "still one cooldown log past the cap");
// the dead live-tester advances live-testing -> to-merge, the sweep spawns a merger for it
// (the dead stub exits instantly), and the poll requeues the dead merger's task to to-merge;
// the failed-merge marker keeps it there for the rest of the run
await waitFor(() => b.output().includes("live-testing -> to-merge"), 30000, "poll advanced the dead live-tester to to-merge", b.output);
await waitFor(() => b.output().includes("merging -> to-merge"), 30000, "poll requeued the dead merger's task to to-merge", b.output);
assert.equal(parseTask(rootB, taskB2.file).state, "to-merge", "requeued task waits for the idle cooldown");
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
const second = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", rootC], { stdio: "ignore", env: { ...process.env, SE_LLM_TEAM_NO_WEBUI: "1" } });
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
const wtD = join(rootD, ".worktrees", "feat/1-shared-board");
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
const wtE = join(rootE, ".worktrees", "fix/1-review-without-worktree");
await waitFor(() => e.output().includes("spawned reviewer"), 30000, "reviewer spawn with ensured worktree", e.output);
assert.ok(existsSync(wtE), "worktree dir created for a to-review task with no worktree dir");
assert.ok(lstatSync(join(wtE, ".kanban")).isSymbolicLink(), "worktree board is a symlink to the shared board");
assert.ok(e.output().includes(`(cwd=${wtE})`), `reviewer spawn log shows an existing cwd: ${e.output()}`);
assert.equal(parseTask(rootE, taskE.file).worktree, "fix/1-review-without-worktree", "worktree recorded on the task");
// the dead reviewer respawns per the dead counter; past the cap the cooldown log fires and
// the fresh spawn defers; died runs never count as successful runs
await waitFor(() => e.output().includes("respawn waits for the idle cooldown"), 90000, "reviewer respawn cooldown", e.output);
const slugE = taskE.file.replace(/\.md$/, "");
const reviewerLogsE = readdirSync(join(kanbanDir(rootE), ".logs")).filter((f) => f.startsWith(`${slugE}.reviewer.`) && f.endsWith(".log")).sort();
assert.deepEqual(
	reviewerLogsE,
	[0, 1, 2, 3, 4, 5].map((n) => `${slugE}.reviewer.${n}.log`),
	"each reviewer run wrote its own indexed log",
);
assert.ok(!existsSync(join(kanbanDir(rootE), ".logs", `${slugE}.reviewer-runs.count`)), "died reviewer runs never counted as successful");
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

// --- part G: the merger spawn waits for the task's registered agent to die ---
const rootG = fixture();
cleaned.push(rootG);
mkdirSync(kanbanDir(rootG), { recursive: true });
// live-tester stub that sets to-merge, appends its report, then lingers alive before exiting;
// the merger role merges the branch into main and sets done
const lingerStub = join(rootG, "linger-agent.cjs");
writeFileSync(
	lingerStub,
	`#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file) process.exit(0);
if (prompt.includes("Merger agent")) {
	const wt = (readFileSync(file, "utf8").match(/^worktree: "(.*)"$/m) ?? [])[1];
	if (wt) execSync("git merge --no-edit " + wt, { stdio: "ignore" });
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, 'state: "done"'));
	process.exit(0);
}
if (!prompt.includes("Live-tester") || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, 'state: "to-merge"'));
appendFileSync(file, "\\nLive test report: merger waited for the live-tester pid.\\n");
setTimeout(() => process.exit(0), 5000);
`,
	{ mode: 0o755 },
);
writeFileSync(join(kanbanDir(rootG), "se-llm-team.json"), JSON.stringify({ agent: lingerStub, pollMinutes: 0.05 }));
const taskG = createTask(rootG, { name: "fix: defer merge while alive", summary: "Deferred merge smoke", specs: "n/a" });
setState(rootG, taskG, "to-live-test");

const g = await runDaemon(rootG);
// "fix: defer merge while alive" caps at 4 words then drops the type word: defer-merge-while
const wtG = join(rootG, ".worktrees", "fix/1-defer-merge-while");
await waitFor(() => parseTask(rootG, taskG.file).state === "to-merge", 30000, "live-tester set to-merge", g.output);
// the stub lingers 5s and the daemon rescans every 1s, so sweeps ran while the pid was alive:
// no merger spawn, no done mirror commit
await new Promise((r) => setTimeout(r, 2000));
assert.ok(existsSync(wtG), "worktree kept while the live-tester pid is alive");
assert.ok(!g.output().includes("spawned merger"), "no merger spawned while the live-tester pid is alive");
assert.ok(!mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), "no done mirror commit while the live-tester pid is alive");
// once the agent exits, the to-merge sweep spawns the merger, the merge completes and the
// done mirror commit folds in the report
await waitFor(() => !existsSync(wtG), 30000, "merge after agent death", g.output);
await waitFor(() => mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), 30000, "deferred done mirror commit", g.output);
assert.ok(g.output().includes("spawned merger"), "merger spawned after the live-tester pid died");
const committedG = execSync(`git show refs/heads/meta/kanban:.kanban/${taskG.file}`, { cwd: rootG, encoding: "utf8", shell: "/bin/bash" });
assert.match(committedG, /Live test report: merger waited for the live-tester pid\./, "report folded into the done mirror commit");
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
await waitFor(() => hi.output().includes("respawn waits for the idle cooldown"), 60000, "cooldown on repeated failed spawns", hi.output);
assert.deepEqual(pidsI(), [], "still no pid file after repeated failed spawns");
assert.equal(readI().state, "to-do", "bounced back and parked on the idle cooldown, not frozen in doing");
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

// --- part K: a failed merge requeues to to-merge and retries only after the idle cooldown ---
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
// 0.08min = 4.8s idle cooldown; the roleStub merger conflicts, aborts and requeues
writeFileSync(join(kanbanDir(rootK), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootK), pollMinutes: 0.05, autoScheduleMinutes: 0.08 }));
const taskK = createTask(rootK, { name: "fix: stuck conflict", summary: "Merge cooldown smoke", specs: "n/a" });
setState(rootK, taskK, "to-merge");
setWorktree(rootK, taskK, "fix/conflict");

const k = await runDaemon(rootK);
const slugK = taskK.file.replace(/\.md$/, "");
const spawnedK = () => k.output().split("spawned merger").length - 1;
// the merger pid file clears only after a sweep saw it dead, which is after its requeue write
const mergerGoneK = () => {
	try {
		return readFileSync(join(kanbanDir(rootK), ".pids", "merger.pid"), "utf8").trim() === "";
	} catch {
		return true;
	}
};
await waitFor(() => spawnedK() === 1, 30000, "first merger spawned", k.output);
await waitFor(() => mergerGoneK() && parseTask(rootK, taskK.file).state === "to-merge", 30000, "failed merger requeued to to-merge", k.output);
assert.ok(!existsSync(join(rootK, ".git", "MERGE_HEAD")), "main not left mid-merge after the requeue");
assert.ok(!existsSync(join(kanbanDir(rootK), ".logs", `${slugK}.merge-attempts.count`)), "no merge-attempts counter");
await new Promise((r) => setTimeout(r, 1500));
assert.equal(spawnedK(), 1, "no respawn before the idle cooldown elapses");
await waitFor(
	() => spawnedK() >= 2 && mergerGoneK() && parseTask(rootK, taskK.file).state === "to-merge",
	30000,
	"merger respawned after the cooldown and requeued again",
	k.output,
);
assert.notEqual(parseTask(rootK, taskK.file).state, "done", "the conflicting merge never reaches done");
// per-run merger logs: the two merger runs got their own indexed files
const mergerLogsK = readdirSync(join(kanbanDir(rootK), ".logs")).filter((f) => f.startsWith(`${slugK}.merger.`) && f.endsWith(".log")).sort();
assert.deepEqual(mergerLogsK, [`${slugK}.merger.0.log`, `${slugK}.merger.1.log`], "merger runs got indexed log files");
k.daemon.kill("SIGTERM");

// --- part K2: at most one merger runs at a time, even with several tasks in to-merge ---
const rootK2 = fixture();
cleaned.push(rootK2);
mkdirSync(kanbanDir(rootK2), { recursive: true });
// merger stub that sleeps 2.5s before merging, so an unserialized orchestrator would overlap spawns
writeFileSync(
	join(rootK2, "slow-merger.cjs"),
	`#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
if (prompt.includes("Live-tester")) {
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: to-merge"));
	process.exit(0);
}
if (prompt.includes("Merger agent")) {
	setTimeout(() => {
		const wt = (readFileSync(file, "utf8").match(/^worktree: "(.*)"$/m) ?? [])[1];
		if (wt) { try { execSync("git merge --no-edit " + wt, { stdio: "ignore" }); } catch (e) {} }
		writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: done"));
	}, 2500);
}
`,
	{ mode: 0o755 },
);
writeFileSync(join(kanbanDir(rootK2), "se-llm-team.json"), JSON.stringify({ agent: join(rootK2, "slow-merger.cjs"), pollMinutes: 0.05 }));
// two mergeable branches, two to-merge tasks
execSync("git checkout -qb feat/merger-one && git commit -q --allow-empty -m one && git checkout -q main", { cwd: rootK2, shell: "/bin/bash" });
execSync("git checkout -qb feat/merger-two && git commit -q --allow-empty -m two && git checkout -q main", { cwd: rootK2, shell: "/bin/bash" });
const taskK2a = createTask(rootK2, { name: "feat: merger one", summary: "Single merger smoke", specs: "n/a" });
const taskK2b = createTask(rootK2, { name: "feat: merger two", summary: "Single merger smoke", specs: "n/a" });
setWorktree(rootK2, taskK2a, "feat/merger-one");
setWorktree(rootK2, taskK2b, "feat/merger-two");
setState(rootK2, taskK2a, "to-merge");
setState(rootK2, taskK2b, "to-merge");

const k2 = await runDaemon(rootK2);
const spawnedK2 = () => k2.output().split("spawned merger").length - 1;
await waitFor(() => spawnedK2() === 1, 30000, "first merger spawned", k2.output);
await new Promise((r) => setTimeout(r, 1200));
assert.equal(spawnedK2(), 1, "no second merger while the first runs");
await waitFor(
	() => spawnedK2() === 2
		&& parseTask(rootK2, taskK2a.file).state === "done"
		&& parseTask(rootK2, taskK2b.file).state === "done"
		&& !existsSync(join(rootK2, ".worktrees", "feat/merger-one"))
		&& !existsSync(join(rootK2, ".worktrees", "feat/merger-two")),
	30000,
	"second merger only after the first finished; both worktrees cleaned up",
	k2.output,
);
assert.ok(!existsSync(join(rootK2, ".worktrees", "feat/merger-one")), "first worktree removed after the merge");
assert.ok(!existsSync(join(rootK2, ".worktrees", "feat/merger-two")), "second worktree removed after the merge");
k2.daemon.kill("SIGTERM");

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

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cooldown + mirror board + bootstrap smoke passed");

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

console.log("orchestrator.test.ts: all smoke parts passed (pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cooldown + mirror board + bootstrap + fresh-clone bootstrap)");

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

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cooldown + mirror board + bootstrap + fresh-clone bootstrap + worktree-cwd board-feed wait passed");

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
// the oldest candidate: without the open-questions guard it would win the sort and be promoted
const taskRQ = createTask(rootR, { name: "feat: blocked by questions", priority: "critical", summary: "Failsafe smoke", specs: "n/a", openQuestions: "- [user] Which API?" });
// the next critical: its explicitly empty questions section must not block promotion
const taskRE = createTask(rootR, { name: "feat: empty questions", priority: "critical", summary: "Failsafe smoke", specs: "n/a" });
appendFileSync(join(kanbanDir(rootR), taskRE.file), "\n# Open questions\n");
const taskR1 = createTask(rootR, { name: "feat: older critical", priority: "critical", summary: "Failsafe smoke", specs: "n/a" });
const taskR3 = createTask(rootR, { name: "feat: newer critical", priority: "critical", summary: "Failsafe smoke", specs: "n/a" });
const taskR2 = createTask(rootR, { name: "feat: low task", priority: "low", summary: "Failsafe smoke", specs: "n/a" });
setState(rootR, taskR0, "to-do");

const r = await runDaemon(rootR);
const readR = (file: string) => parseTask(rootR, file);
assert.equal(readR(taskRQ.file).openQuestions, "- [user] Which API?", "precondition: unanswered open questions present");
assert.equal(readR(taskRE.file).openQuestions, "", "precondition: explicit empty questions section");
// while taskR0 cycles to-do/doing the board is never idle: no promotion despite the elapsed window
await new Promise((res) => setTimeout(res, 10000));
assert.ok(!r.output().includes("promoting"), "no promotion while a task is active");

// past the respawn cap the poll bounces taskR0 back and the sweep defers its respawn:
// settling it done makes the board idle
await waitFor(() => r.output().includes("respawn waits for the idle cooldown"), 90000, "respawn cooldown on the active task", r.output);
writeFileSync(
	join(kanbanDir(rootR), taskR0.file),
	readFileSync(join(kanbanDir(rootR), taskR0.file), "utf8").replace(/^state: .*/m, 'state: "done"'),
);
// the window elapses: the failsafe promotes the oldest critical task whose questions are
// answered, never the older critical task that still has unanswered open questions
await waitFor(() => r.output().includes(`promoting ${taskRE.file} to to-do`), 30000, "failsafe promotion of the empty-questions task", r.output);
assert.ok(["to-do", "doing"].includes(readR(taskRE.file).state), "promoted task is active");
assert.equal(readR(taskRQ.file).state, "backlog", "task with unanswered open questions never promoted");
assert.equal(readR(taskR2.file).state, "backlog", "lower priority not promoted first");
assert.equal(readR(taskR3.file).state, "backlog", "newer task in the same priority not promoted first");
assert.equal(readR(taskR1.file).state, "backlog", "critical task after the promoted one not promoted");
// the promoted task stays active, so the window never re-arms: no second promotion
await new Promise((res) => setTimeout(res, 8000));
assert.equal(readR(taskR2.file).state, "backlog", "no second promotion while the promoted task is active");
assert.equal(readR(taskR3.file).state, "backlog", "no second promotion while the promoted task is active");
assert.equal(readR(taskRQ.file).state, "backlog", "no second promotion while the promoted task is active");
assert.equal(r.output().split("promoting ").length - 1, 1, "exactly one promotion logged");
r.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + failsafe auto-schedule smoke passed");

// --- part S: --no-webui / SE_LLM_TEAM_NO_WEBUI keep smoke daemons off the global webui config ---
// the global config (like the production ~/.pi/agent/se-llm-team.json) enables the webui on a fixed
// port; a smoke daemon without the override binds it and steals the real UI
const rootS = fixture();
cleaned.push(rootS);
const homeS = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeS);
mkdirSync(join(homeS, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeS, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: 4277 } }));

const sEnv = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", rootS, "--rescan-seconds", "1"], {
	stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, HOME: homeS, SE_LLM_TEAM_NO_WEBUI: "1" },
});
daemons.push({ daemon: sEnv, root: rootS });
let sEnvOut = "";
sEnv.stdout.on("data", (d) => (sEnvOut += d));
sEnv.stderr.on("data", (d) => (sEnvOut += d));
await waitFor(() => sEnvOut.includes("web ui disabled"), 10000, "SE_LLM_TEAM_NO_WEBUI disables the webui", () => sEnvOut);
assert.ok(!sEnvOut.includes("web ui on") && !sEnvOut.includes("web ui failed"), "env override never starts the webui");
sEnv.kill("SIGTERM");
// full exit before the next spawn: the lock must be released, or the second daemon exits early
await Promise.race([new Promise((r) => sEnv.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);

const sFlag = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", rootS, "--rescan-seconds", "1", "--no-webui"], {
	stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, HOME: homeS },
});
daemons.push({ daemon: sFlag, root: rootS });
let sFlagOut = "";
sFlag.stdout.on("data", (d) => (sFlagOut += d));
sFlag.stderr.on("data", (d) => (sFlagOut += d));
await waitFor(() => sFlagOut.includes("web ui disabled"), 10000, "--no-webui disables the webui", () => sFlagOut);
// the configured port was free the whole run, so a bound webui would have logged "web ui on":
// its absence proves the daemon never touched the port
assert.ok(!sFlagOut.includes("web ui on") && !sFlagOut.includes("web ui failed"), "--no-webui never starts the webui");
sFlag.kill("SIGTERM");
await Promise.race([new Promise((r) => sFlag.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);

cleanupAll(rootS, homeS);
console.log("orchestrator.test.ts: ... + no-webui override smoke passed");

// --- part T: 3 consecutive failed pushes log the warning once ---
const rootT = fixture();
cleaned.push(rootT);
// origin points at a non-repo path: every push fails fast, no SSH involved
execSync("git remote add origin /nonexistent/se-llm-team.git", { cwd: rootT, shell: "/bin/bash" });
mkdirSync(kanbanDir(rootT), { recursive: true });
writeFileSync(join(kanbanDir(rootT), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootT), pollMinutes: 0.05 }));
// a task per sweep: one create mirror commit (and one failed push) each, four in a row
const s = await runDaemon(rootT);
for (let i = 0; i < 4; i++) {
	const t = createTask(rootT, { name: `fix: push warn ${i}`, summary: "Push warning smoke", specs: "n/a" });
	await waitFor(() => mirrorSubjects(rootT).includes(`kanban: create ${t.file}`), 30000, `create mirror commit ${i}`, s.output);
}
await waitFor(() => s.output().includes("WARNING: auto-push of refs/heads/meta/kanban"), 10000, "warning after 3 consecutive failed pushes", s.output);
assert.equal(s.output().split("WARNING: auto-push").length - 1, 1, "push warning logged exactly once per failure streak");
s.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + push warning smoke passed");

// --- part T2: a stale push-failures counter above the cap still warns, once per streak ---
const rootT2 = fixture();
cleaned.push(rootT2);
// origin points at a non-repo path: every push fails fast, no SSH involved
execSync("git remote add origin /nonexistent/se-llm-team.git", { cwd: rootT2, shell: "/bin/bash" });
mkdirSync(join(kanbanDir(rootT2), ".logs"), { recursive: true });
// a counter restored from a backup or left by an earlier run sits above the cap already
writeFileSync(join(kanbanDir(rootT2), ".logs", "push-failures.count"), "5");
writeFileSync(join(kanbanDir(rootT2), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootT2), pollMinutes: 0.05 }));
// one task = one failed push: the stale counter never reaches equality, >= must still warn
const sT2 = await runDaemon(rootT2);
const taskT2 = createTask(rootT2, { name: "fix: push warn stale", summary: "Push warning smoke", specs: "n/a" });
await waitFor(() => mirrorSubjects(rootT2).includes(`kanban: create ${taskT2.file}`), 30000, "stale-counter create mirror commit", sT2.output);
await waitFor(() => sT2.output().includes("WARNING: auto-push of refs/heads/meta/kanban"), 10000, "warning despite a stale counter above the cap", sT2.output);
// a further failure stays silent: one warning per streak, not one per failure
const taskT2b = createTask(rootT2, { name: "fix: push warn stale 2", summary: "Push warning smoke", specs: "n/a" });
await waitFor(() => mirrorSubjects(rootT2).includes(`kanban: create ${taskT2b.file}`), 30000, "second create mirror commit", sT2.output);
await new Promise((r) => setTimeout(r, 2000));
assert.equal(sT2.output().split("WARNING: auto-push").length - 1, 1, "stale-counter warning logged once per streak");
sT2.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + stale push counter warning smoke passed");

// async variant of waitFor for fetch-based conditions
const waitForAsync = async (cond: () => Promise<boolean>, ms: number, what: string) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await cond()) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	console.error(`timeout waiting for ${what}`);
	killAll();
	process.exit(1);
};

const freePort = async (): Promise<number> => {
	const server = createServer();
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as { port: number }).port;
	await new Promise<void>((r) => server.close(r));
	return port;
};

// --- part U: hub server unit smoke: health, register, heartbeat, registry, per-project reads ---
const rootU1 = fixture();
const rootU2 = fixture();
const homeU = mkdtempSync(join(tmpdir(), "orch-hub-home-"));
cleaned.push(rootU1, rootU2, homeU);
const taskU2 = createTask(rootU2, { name: "fix: hub board b", summary: "Hub smoke", specs: "n/a" });
const realHome = process.env.HOME;
process.env.HOME = homeU;
// a registry left by a previous hub, carrying one long-stale entry: the new hub drops it at seed
mkdirSync(join(homeU, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeU, ".pi", "agent", "se-llm-team-hub.json"), JSON.stringify([{ name: "stale", root: rootU1, start: Date.now() - 60000, lastHeartbeat: Date.now() - 60000 }]));
const hubU = await startHub({ name: "a", root: rootU1, host: "127.0.0.1", port: 0, staleMs: 400, healthMs: 150 });
assert.ok(hubU, "hub starts and returns a port");
const hubBase = `http://127.0.0.1:${hubU.port}`;
assert.equal(await (await fetch(`${hubBase}/health`)).text(), "ok");
const regRes = await fetch(`${hubBase}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "b", root: rootU2 }) });
assert.equal(regRes.status, 200);
const regEntry = await regRes.json();
assert.deepEqual(Object.keys(regEntry).sort(), ["lastHeartbeat", "name", "root", "start"], "register answers the entry shape");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b" }) })).status, 400, "register without root rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "", root: rootU2 }) })).status, 400, "register with empty name rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b", root: "/nonexistent/dir" }) })).status, 400, "register with nonexistent root rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b", root: "relative/dir" }) })).status, 400, "register with relative root rejected");
const beforeBeat = (await (await fetch(`${hubBase}/api/projects`)).json()).find((e: any) => e.name === "b");
assert.equal((await fetch(`${hubBase}/heartbeat`, { method: "POST", body: JSON.stringify({ name: "b" }) })).status, 200);
assert.equal((await fetch(`${hubBase}/heartbeat`, { method: "POST", body: JSON.stringify({ name: "nope" }) })).status, 404, "heartbeat of an unknown project 404s");
const afterBeat = (await (await fetch(`${hubBase}/api/projects`)).json()).find((e: any) => e.name === "b");
assert.ok(afterBeat.lastHeartbeat >= beforeBeat.lastHeartbeat, "heartbeat refreshes lastHeartbeat");
const registryU = readHubRegistry();
assert.deepEqual(registryU.map((e) => e.name).sort(), ["a", "b"], "stale seed entry dropped, one entry per project");
assert.equal(registryU.find((e) => e.name === "a")!.root, rootU1);
assert.equal(registryU.find((e) => e.name === "b")!.root, rootU2);
assert.deepEqual(readdirSync(join(homeU, ".pi", "agent")).filter((f) => f.includes(".tmp")), [], "no atomic-rename temp litter");
const viaProject = await (await fetch(`${hubBase}/api/tasks?project=b`)).json();
assert.equal(viaProject.length, 1);
assert.equal(viaProject[0].file, taskU2.file);
assert.equal(viaProject[0].name, "fix: hub board b");
assert.equal((await fetch(`${hubBase}/api/tasks?project=nope`)).status, 404, "unknown project rejected");
assert.equal((await (await fetch(`${hubBase}/api/tasks`)).json()).length, 0, "no project param serves the hub's own board");
assert.equal((await (await fetch(`${hubBase}/api/projects`)).json()).length, 2);
assert.ok((await (await fetch(`${hubBase}/`)).text()).includes("Software Engineering LLM Team"), "the hub serves the ui page");
assert.equal((await fetch(`${hubBase}/api/tasks`, { method: "POST" })).status, 404);
// b stops heartbeating: the running hub ages the silent entry out of the registry
await waitFor(() => readHubRegistry().map((e) => e.name).join() === "a", 5000, "running hub ages out silent entries", () => "");
assert.equal((await fetch(`${hubBase}/api/tasks?project=b`)).status, 404, "aged-out project no longer served");
hubU.close();
process.env.HOME = realHome;
console.log("orchestrator.test.ts: ... + hub server unit smoke passed");

// --- part V: election race: two daemons on one port elect exactly one hub, the loser joins ---
const rootV1 = fixture();
const rootV2 = fixture();
const homeV = mkdtempSync(join(tmpdir(), "orch-hub-race-home-"));
cleaned.push(rootV1, rootV2, homeV);
const taskV2 = createTask(rootV2, { name: "fix: raced board", summary: "Election smoke", specs: "n/a" });
const portV = await freePort();
mkdirSync(join(homeV, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeV, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portV } }));
const hubEnv = { ...process.env, HOME: homeV, SE_LLM_TEAM_HUB_HEALTH_MS: "500" };
delete hubEnv.SE_LLM_TEAM_NO_WEBUI; // the election needs the webui enabled; the temp HOME config picks a free port
const dV1 = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", rootV1, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: hubEnv });
const dV2 = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", rootV2, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: hubEnv });
daemons.push({ daemon: dV1, root: rootV1 }, { daemon: dV2, root: rootV2 });
let outV1 = "", outV2 = "";
dV1.stdout.on("data", (d) => (outV1 += d));
dV1.stderr.on("data", (d) => (outV1 += d));
dV2.stdout.on("data", (d) => (outV2 += d));
dV2.stderr.on("data", (d) => (outV2 += d));
const nameV1 = basename(rootV1), nameV2 = basename(rootV2);
await waitFor(() => outV1.includes("web ui on") || outV2.includes("web ui on"), 15000, "one daemon won the election", () => outV1 + outV2);
const winnerIs1 = outV1.includes("web ui on");
assert.ok(!(winnerIs1 ? outV2 : outV1).includes("web ui on"), "the loser never served the ui");
await waitFor(() => (winnerIs1 ? outV2 : outV1).includes(`registered ${winnerIs1 ? nameV2 : nameV1} with the hub`), 15000, "loser registered with the hub", () => outV1 + outV2);
const baseV = `http://127.0.0.1:${portV}`;
await waitForAsync(async () => {
	try {
		return (await (await fetch(`${baseV}/api/projects`)).json()).length === 2;
	} catch {
		return false;
	}
}, 15000, "both projects registered in the hub");
assert.deepEqual((await (await fetch(`${baseV}/api/projects`)).json()).map((e: any) => e.name).sort(), [nameV1, nameV2].sort());
const tasksV = await (await fetch(`${baseV}/api/tasks?project=${nameV2}`)).json();
assert.equal(tasksV.length, 1);
assert.equal(tasksV[0].file, taskV2.file);
assert.equal((await (await fetch(`${baseV}/api/tasks?project=${nameV1}`)).json()).length, 0);
assert.equal((await fetch(`${baseV}/api/tasks?project=nope`)).status, 404);
const registryV = JSON.parse(readFileSync(join(homeV, ".pi", "agent", "se-llm-team-hub.json"), "utf8"));
assert.deepEqual(registryV.map((e: any) => e.name).sort(), [nameV1, nameV2].sort(), "registry file carries both entries");
dV1.kill("SIGTERM");
dV2.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + election race smoke passed");

// --- part W: failover: killing the hub re-elects a survivor, the new hub ages out the dead entry ---
const rootW1 = fixture();
const rootW2 = fixture();
const homeW = mkdtempSync(join(tmpdir(), "orch-hub-fail-home-"));
cleaned.push(rootW1, rootW2, homeW);
const portW = await freePort();
mkdirSync(join(homeW, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeW, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portW } }));
const hubEnvW = { ...process.env, HOME: homeW, SE_LLM_TEAM_HUB_HEALTH_MS: "500", SE_LLM_TEAM_HUB_STALE_MS: "1500" };
delete hubEnvW.SE_LLM_TEAM_NO_WEBUI;
const dW1 = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", rootW1, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: hubEnvW });
const dW2 = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", rootW2, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: hubEnvW });
daemons.push({ daemon: dW1, root: rootW1 }, { daemon: dW2, root: rootW2 });
let outW1 = "", outW2 = "";
dW1.stdout.on("data", (d) => (outW1 += d));
dW1.stderr.on("data", (d) => (outW1 += d));
dW2.stdout.on("data", (d) => (outW2 += d));
dW2.stderr.on("data", (d) => (outW2 += d));
const nameW1 = basename(rootW1), nameW2 = basename(rootW2);
await waitFor(() => outW1.includes("web ui on") || outW2.includes("web ui on"), 15000, "hub elected", () => outW1 + outW2);
const hubIs1 = outW1.includes("web ui on");
const hubProc = hubIs1 ? dW1 : dW2;
const survProc = hubIs1 ? dW2 : dW1;
const survName = hubIs1 ? nameW2 : nameW1;
const deadName = hubIs1 ? nameW1 : nameW2;
await waitForAsync(async () => {
	try {
		return (await (await fetch(`http://127.0.0.1:${portW}/api/projects`)).json()).length === 2;
	} catch {
		return false;
	}
}, 15000, "both registered before the kill");
hubProc.kill("SIGKILL");
await waitFor(() => (hubIs1 ? outW2 : outW1).includes("web ui on"), 20000, "survivor re-elected as hub after hub death", () => outW1 + outW2);
await waitForAsync(async () => {
	try {
		const projects = await (await fetch(`http://127.0.0.1:${portW}/api/projects`)).json();
		return projects.length === 1 && projects[0].name === survName;
	} catch {
		return false;
	}
}, 15000, "new hub serves only the survivor (dead entry aged out)");
assert.equal((await fetch(`http://127.0.0.1:${portW}/api/tasks?project=${deadName}`)).status, 404, "dead project rejected by the new hub");
assert.equal(parseInt(readFileSync(join(homeW, ".pi", "agent", "se-llm-team-hub.lock"), "utf8").trim(), 10), survProc.pid, "the stale hub lock was stolen by the survivor");
survProc.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + hub failover smoke passed");

// --- part X: provider/model/thinking config flags, with per-role overrides ---
// the llm flags sit between "--mode json" and "-p", in resolution order provider, model, thinking
const llmArgs = (argv: string[]) => argv.slice(argv.indexOf("--mode") + 2, argv.indexOf("-p"));
// stub agent that records every spawn (role + argv) and drives the pipeline; the developer
// commits so the merger has a real branch to merge and the merger path can run on a conflicting branch
const argvStub = (root: string) => {
	const stub = join(root, "argv-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const role = prompt.includes("Developer agent") ? "developer"
	: prompt.includes("Reviewer agent") ? "reviewer"
	: prompt.includes("Live-tester") ? "live-tester"
	: prompt.includes("Merger agent") ? "merger" : "";
appendFileSync(${JSON.stringify(join(root, "argv.log"))}, JSON.stringify({ role, argv: process.argv }) + "\\n");
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
if (role === "developer") {
	writeFileSync("code.txt", "work\\n");
	execSync("git add -A && git commit -qm work", { stdio: "ignore" });
}
if (role === "merger") {
	const wt = (readFileSync(file, "utf8").match(/^worktree: "(.*)"$/m) ?? [])[1];
	let merged = false;
	if (wt) {
		try {
			execSync("git merge --no-edit " + wt, { stdio: "ignore" });
			merged = true;
		} catch (e) {
			try { execSync("git merge --abort", { stdio: "ignore" }); } catch (e2) {}
		}
	}
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + (merged ? "done" : "to-merge")));
}
const next = role === "developer" ? "to-review" : role === "reviewer" ? "to-live-test" : role === "live-tester" ? "to-merge" : null;
if (next) writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + next));
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

const rootX = fixture();
cleaned.push(rootX);
// exact-flag asserts: an empty temp HOME keeps the ambient user-level config (provider, model,
// roles) out of loadConfig, which merges user-level first
const homeX = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeX);
mkdirSync(kanbanDir(rootX), { recursive: true });
writeFileSync(
	join(kanbanDir(rootX), "se-llm-team.json"),
	JSON.stringify({
		agent: argvStub(rootX),
		pollMinutes: 0.05,
		model: "global-model",
		thinking: "high",
		roles: {
			developer: { model: "dev-model", thinking: "low" },
			reviewer: { provider: "prov", model: "rev-model" },
			merger: { provider: "mprov", model: "merge-model" },
		},
	}),
);
const taskX = createTask(rootX, { name: "feat: llm flags", summary: "LLM config smoke", specs: "n/a" });
setState(rootX, taskX, "to-do");

const x = await runDaemon(rootX, join(HERE, "orchestrator.ts"), homeX);
await waitFor(() => parseTask(rootX, taskX.file).state === "done" && parseTask(rootX, taskX.file).worktree === "", 60000, "pipeline with llm config", x.output);
const xSpawns = () => readFileSync(join(rootX, "argv.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { role: string; argv: string[] });
const xFlags = (role: string) => llmArgs(xSpawns().find((s) => s.role === role)!.argv);
assert.deepEqual(xFlags("developer"), ["--model", "dev-model", "--thinking", "low"], "role entry overrides both global fields");
assert.deepEqual(xFlags("reviewer"), ["--provider", "prov", "--model", "rev-model", "--thinking", "high"], "role provider+model keeps the global thinking");
assert.deepEqual(xFlags("live-tester"), ["--model", "global-model", "--thinking", "high"], "no role entry: the global fields apply");

// a conflicting branch under the same running daemon makes the merger path run and record
execSync("git checkout -qb fix/llm-conflict", { cwd: rootX, shell: "/bin/bash" });
writeFileSync(join(rootX, "README.md"), "branch\n");
execSync("git commit -qam branch", { cwd: rootX, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootX, shell: "/bin/bash" });
writeFileSync(join(rootX, "README.md"), "main\n");
execSync("git commit -qam main", { cwd: rootX, shell: "/bin/bash" });
const taskX2 = createTask(rootX, { name: "fix: llm merger", summary: "LLM merger smoke", specs: "n/a" });
setState(rootX, taskX2, "to-merge");
setWorktree(rootX, taskX2, "fix/llm-conflict");
await waitFor(() => xSpawns().some((s) => s.role === "merger"), 30000, "merger spawned under the llm config", x.output);
assert.deepEqual(xFlags("merger"), ["--provider", "mprov", "--model", "merge-model", "--thinking", "high"], "merger role override applies");
x.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + llm config flags smoke passed");

// --- part Y: bad llm config values warn and are dropped, the daemon keeps running ---
const rootY = fixture();
cleaned.push(rootY);
const homeY = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeY);
mkdirSync(kanbanDir(rootY), { recursive: true });
writeFileSync(
	join(kanbanDir(rootY), "se-llm-team.json"),
	JSON.stringify({ agent: argvStub(rootY), pollMinutes: 0.05, provider: "lonely-provider", thinking: "banana", roles: { developer: "not-an-object", reviewer: { thinking: "wild" } } }),
);
const taskY = createTask(rootY, { name: "fix: bad llm config", summary: "Bad llm config smoke", specs: "n/a" });
setState(rootY, taskY, "to-do");
const y = await runDaemon(rootY, join(HERE, "orchestrator.ts"), homeY);
// wait for the stub's own record, not just the spawn log: the child may not have written argv.log yet
await waitFor(() => {
	try {
		return readFileSync(join(rootY, "argv.log"), "utf8").includes('"developer"');
	} catch {
		return false;
	}
}, 30000, "developer spawned despite bad llm config", y.output);
assert.ok(y.output().includes('unknown thinking level "banana" (global)'), "global thinking typo warned about");
assert.ok(y.output().includes('unknown thinking level "wild" for role "reviewer"'), "role thinking typo warned about");
assert.ok(y.output().includes('provider "lonely-provider" for role developer ignored'), "provider without model warned about");
const yDev = JSON.parse(readFileSync(join(rootY, "argv.log"), "utf8").trim().split("\n").find((l) => l.includes('"developer"'))!) as { role: string; argv: string[] };
assert.deepEqual(llmArgs(yDev.argv), [], "bad config values add no flags");
y.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + bad llm config smoke passed");

// --- part Z: a daemon restart preserves in-flight working-tree state and notes on a file
// already on the mirror. Mirror commits carry only creates and dones, so an agent's state
// and notes write lives in the working tree alone; the startup reconcile must keep it
// instead of reverting the task to its create-time mirror content and re-running it.
const rootZ = fixture();
cleaned.push(rootZ);
mkdirSync(kanbanDir(rootZ), { recursive: true });
writeFileSync(join(kanbanDir(rootZ), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootZ), pollMinutes: 0.05 }));
const taskZ = createTask(rootZ, { name: "fix: restart keeps in-flight state", summary: "Restart smoke", specs: "n/a" });
const z1 = await runDaemon(rootZ);
await waitFor(() => mirrorSubjects(rootZ).includes(`kanban: create ${taskZ.file}`), 30000, "task mirrored before the restart", z1.output);
z1.daemon.kill("SIGTERM");
// full exit first: the lock must be released and lastMirrorHash is process state
await Promise.race([new Promise((r) => z1.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
// in-flight write: the task settled done in the working tree, never mirrored
writeFileSync(
	join(kanbanDir(rootZ), taskZ.file),
	readFileSync(join(kanbanDir(rootZ), taskZ.file), "utf8")
		.replace(/^state: .*/m, 'state: "done"')
		.replace(/\n# Notes\n/, "\n# Notes\n- in-flight note\n"),
);
assert.ok(showTip(rootZ, taskZ.file)!.includes('state: "backlog"'), "precondition: the mirror tip still has the create-time state");

const z2 = await runDaemon(rootZ);
await waitFor(() => z2.output().includes("1 in-flight kept"), 30000, "reconcile kept the in-flight working-tree file", z2.output);
assert.ok(readFileSync(join(kanbanDir(rootZ), taskZ.file), "utf8").includes("- in-flight note"), "in-flight notes survived the restart");
// the in-flight done state is acted on, not reverted to the mirror's backlog: the done
// transition still mirrors because the working-tree file differs from the tip
await waitFor(() => mirrorSubjects(rootZ).includes(`kanban: done ${taskZ.file}`), 30000, "done mirror commit after the restart", z2.output);
assert.ok(showTip(rootZ, taskZ.file)!.includes("- in-flight note"), "the done mirror commit carries the in-flight note");
z2.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + restart preserves in-flight board state smoke passed");

// --- part AA: the reviewer successful-run cap: 3 successful runs, the 4th spawn is refused ---
// a reviewer run is successful when it sets the task state itself (back to to-review after
// changes, or forward to to-live-test on approval); died runs go through the dead counter
const loopStub = (root: string) => {
	const stub = join(root, "loop-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
const next = prompt.includes("Reviewer agent") ? "to-review" : prompt.includes("Live-tester") ? "done" : null;
if (next) writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + next));
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

const rootAA = fixture();
cleaned.push(rootAA);
mkdirSync(kanbanDir(rootAA), { recursive: true });
writeFileSync(join(kanbanDir(rootAA), "se-llm-team.json"), JSON.stringify({ agent: loopStub(rootAA), pollMinutes: 0.05 }));
const taskAA = createTask(rootAA, { name: "fix: reviewer cap", summary: "Reviewer run cap smoke", specs: "n/a" });
setState(rootAA, taskAA, "to-review");

const aa = await runDaemon(rootAA);
const slugAA = taskAA.file.replace(/\.md$/, "");
const runsAA = () => {
	try {
		return parseInt(readFileSync(join(kanbanDir(rootAA), ".logs", `${slugAA}.reviewer-runs.count`), "utf8").trim(), 10) || 0;
	} catch {
		return 0;
	}
};
// three successful reviewer runs (each back to to-review), then the 4th spawn is refused
await waitFor(() => aa.output().includes("reviewer succeeded 3+ times, moving to to-live-test"), 60000, "reviewer cap refusal logged", aa.output);
assert.equal(aa.output().split("spawned reviewer").length - 1, 3, "exactly three reviewer spawns before the refusal");
assert.equal(runsAA(), 0, "the counter cleared on the forced to-live-test advance");
const reviewerLogsAA = readdirSync(join(kanbanDir(rootAA), ".logs")).filter((f) => f.startsWith(`${slugAA}.reviewer.`) && f.endsWith(".log")).sort();
assert.deepEqual(reviewerLogsAA, [`${slugAA}.reviewer.0.log`, `${slugAA}.reviewer.1.log`, `${slugAA}.reviewer.2.log`], "three indexed reviewer run logs, no fourth");
// the pipeline continues from the forced advance: the live-tester runs and the task completes
await waitFor(() => parseTask(rootAA, taskAA.file).state === "done" && parseTask(rootAA, taskAA.file).worktree === "", 60000, "pipeline after the cap refusal", aa.output);
assert.equal(runsAA(), 0, "counter still cleared after the pipeline completed");
aa.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + reviewer successful-run cap smoke passed");

// --- part AB: kanban task removal: the file and the mirror go in one operation ---
// reconcileBoard restores files the working tree lacks whenever the mirror tip still carries
// them, so a removal must reach the mirror itself or the task comes back (the self-heal)
const rootAB = fixture();
cleaned.push(rootAB);
mkdirSync(kanbanDir(rootAB), { recursive: true });
writeFileSync(join(kanbanDir(rootAB), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAB), pollMinutes: 0.05 }));
const taskAB = createTask(rootAB, { name: "fix: mistaken task", summary: "Removal smoke", specs: "n/a" });
const taskAB2 = createTask(rootAB, { name: "fix: keep me", summary: "Stays on the board", specs: "n/a" });

const ab = await runDaemon(rootAB);
// both tasks reach the mirror first: creates run for every file not on the mirror yet
await waitFor(() => showTip(rootAB, taskAB.file) !== null && showTip(rootAB, taskAB2.file) !== null, 30000, "both tasks mirrored", ab.output);

// removal while the daemon runs: the file leaves the tree and the mirror in one operation
assert.equal(await removeTask(rootAB, taskAB.file), null, "removal succeeds");
assert.equal(existsSync(join(kanbanDir(rootAB), taskAB.file)), false, "task file deleted");
assert.equal(showTip(rootAB, taskAB.file), null, "task gone from the mirror tip");
assert.ok(mirrorSubjects(rootAB).includes(`kanban: delete ${taskAB.file}`), "delete commit recorded on the mirror");
assert.ok(showTip(rootAB, taskAB2.file) !== null, "other task untouched on the mirror");
assert.equal(existsSync(join(kanbanDir(rootAB), taskAB2.file)), true, "other task untouched in the tree");

// the running daemon's reconcile self-heal must not restore the removed task
await new Promise((r) => setTimeout(r, 2500));
assert.equal(existsSync(join(kanbanDir(rootAB), taskAB.file)), false, "daemon sweep does not restore the removed task");

// a restart re-materializes from the mirror tip: the removal survives it too
ab.daemon.kill("SIGTERM");
await Promise.race([new Promise((r) => ab.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
const ab2 = await runDaemon(rootAB);
await new Promise((r) => setTimeout(r, 2500));
assert.equal(existsSync(join(kanbanDir(rootAB), taskAB.file)), false, "daemon restart does not restore the removed task");
ab2.daemon.kill("SIGTERM");
await Promise.race([new Promise((r) => ab2.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);

// removing the last task empties the mirror board: the tip no longer carries the file
assert.equal(await removeTask(rootAB, taskAB2.file), null, "last-task removal succeeds");
assert.equal(existsSync(join(kanbanDir(rootAB), taskAB2.file)), false, "last task file deleted");
assert.equal(showTip(rootAB, taskAB2.file), null, "last task gone from the mirror tip");
assert.ok((await removeTask(rootAB, "000999_ghost.md"))!.includes("No task"), "unknown task reported, nothing deleted");

console.log("orchestrator.test.ts: ... + task removal smoke passed");

// --- part AC: the failsafe never auto-promotes a task with unfinished blockers; a ghost ref
// is ignored, and the blocked task schedules normally once its blocker is done ---
const rootAC = fixture();
cleaned.push(rootAC);
mkdirSync(kanbanDir(rootAC), { recursive: true });
// 0.05min = 3s idle window and poll; the dead stub keeps a promoted task active forever
writeFileSync(join(kanbanDir(rootAC), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAC), pollMinutes: 0.05, autoScheduleMinutes: 0.05 }));
const taskAC0 = createTask(rootAC, { name: "feat: blocker task", summary: "Failsafe smoke", specs: "n/a" });
const taskAC1 = createTask(rootAC, { name: "feat: blocked critical", priority: "critical", summary: "Failsafe smoke", specs: "n/a", blockedBy: `#${parseInt(taskAC0.file, 10)}` });
const taskAC2 = createTask(rootAC, { name: "feat: ghost ref", priority: "critical", summary: "Failsafe smoke", specs: "n/a", blockedBy: "#999" });

const ac = await runDaemon(rootAC);
const readAC = (file: string) => parseTask(rootAC, file);
// the ghost ref is ignored: the critical ghost task is promotable and wins by priority over
// the medium blocker task, while the blocked critical task stays held despite its priority
await waitFor(() => ac.output().includes(`promoting ${taskAC2.file} to to-do`), 30000, "ghost-only task promoted", ac.output);
assert.equal(readAC(taskAC1.file).state, "backlog", "blocked critical task not promoted despite priority");
// settle the ghost task: past the respawn cap the poll bounces it back and the sweep defers
// the respawn, so the board goes idle once it is settled done
await waitFor(() => ac.output().includes(`${taskAC2.file.replace(/\.md$/, "")}: agent died`), 60000, "respawn cap on the ghost task", ac.output);
writeFileSync(
	join(kanbanDir(rootAC), taskAC2.file),
	readFileSync(join(kanbanDir(rootAC), taskAC2.file), "utf8").replace(/^state: .*/m, 'state: "done"'),
);
// the blocker task is still backlog: the blocked critical task stays held, the medium task promotes
await waitFor(() => ac.output().includes(`promoting ${taskAC0.file} to to-do`), 30000, "unblocked medium task promoted", ac.output);
assert.equal(readAC(taskAC1.file).state, "backlog", "still held while the blocker is not done");
// settle the blocker: the deferred respawn is parked, so the board goes idle once it is done
await waitFor(() => ac.output().includes(`${taskAC0.file.replace(/\.md$/, "")}: agent died`), 60000, "respawn cap on the blocker task", ac.output);
writeFileSync(
	join(kanbanDir(rootAC), taskAC0.file),
	readFileSync(join(kanbanDir(rootAC), taskAC0.file), "utf8").replace(/^state: .*/m, 'state: "done"'),
);
await waitFor(() => ac.output().includes(`promoting ${taskAC1.file} to to-do`), 30000, "blocked task promoted after the blocker is done", ac.output);
assert.ok(["to-do", "doing"].includes(readAC(taskAC1.file).state), "promoted task is active");
ac.daemon.kill("SIGTERM");
// full exit before the removal: a sweep mid-flight still writes into the fixture
await Promise.race([new Promise((r) => ac.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
cleanupAll(rootAC);
console.log("orchestrator.test.ts: ... + blockedBy failsafe smoke passed");

// --- part AD: a completed run clears the dead counter, so the cooldown applies to consecutive-death streaks only ---
const rootAD = fixture();
cleaned.push(rootAD);
mkdirSync(join(kanbanDir(rootAD), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootAD), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootAD), pollMinutes: 0.05 }));
const taskAD = createTask(rootAD, { name: "fix: clear dead counter", summary: "Counter clear smoke", specs: "n/a" });
setState(rootAD, taskAD, "to-do");
// a stale death streak from earlier respawns: the next completed run must clear it, else the
// cooldown would gate a fresh streak that never had six deaths
const slugAD = taskAD.file.replace(/\.md$/, "");
writeFileSync(join(kanbanDir(rootAD), ".logs", `${slugAD}.dead.count`), "3");

const ad = await runDaemon(rootAD);
await waitFor(() => ad.output().includes("cleared the dead-agent counter"), 60000, "completed run cleared the dead counter", ad.output);
assert.equal(ad.output().split("cleared the dead-agent counter").length - 1, 1, "counter clear logged once per streak");
assert.equal(readFileSync(join(kanbanDir(rootAD), ".logs", `${slugAD}.dead.count`), "utf8").trim(), "0", "the completed run cleared the death counter");
// the pipeline still completes: the cleared counter does not disturb the normal flow
await waitFor(() => parseTask(rootAD, taskAD.file).state === "done" && parseTask(rootAD, taskAD.file).worktree === "", 60000, "pipeline after the counter clear", ad.output);
assert.equal(readFileSync(join(kanbanDir(rootAD), ".logs", `${slugAD}.dead.count`), "utf8").trim(), "0", "counter stays cleared");
ad.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + dead-counter clear on completed run smoke passed");
