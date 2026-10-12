import assert from "node:assert/strict";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isLinkedWorktree, readHubRegistry, startHub } from "./hub.ts";
import { createTask, kanbanDir, listAll, parseTask, setState, setWorktree, updateTask, ROLE_NOTES_RE } from "./kanban.ts";
import { compactFinishedLogs, compactLogLine, dropDoneBlockers, loadConfig, nextRunIndex, poll, promoteBacklog, removeTask, waitForBoardCommits } from "./orchestrator.ts";
import { gunzipSync } from "node:zlib";
import { pidAlive } from "./pid.ts";

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
		process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "system", content: "", sections: { preamble: "the system prompt" } } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_update", usage: { input: 0, output: 1 }, assistantMessageEvent: { type: "text_delta", delta: "working" } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "git status" } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "result echo" }] } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "result echo" }] } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: "work" } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: "full replay" }], willRetry: false }) + "\\n");
		process.stderr.write("stub stderr diagnostic: not json\\n");
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
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + (merged ? "to-live-test" : "to-merge")));
	process.exit(0);
}
const next = prompt.includes("Developer agent") ? "to-review"
	: prompt.includes("Reviewer agent") ? "to-merge"
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
		[script, "--root", root, "--rescan-seconds", "1", "--poll-minutes", "0.01"],
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
writeFileSync(join(kanbanDir(rootA), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootA), pollMinutes: 0.01 }));
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
// to-do -> doing -> to-review -> reviewing -> to-merge -> merging -> to-live-test -> live-testing -> done ->
// done mirror commit (the merger merged the branch, the live test passed, the done cleanup
// removed the worktree). The stub transitions in milliseconds, so intermediate states are
// asserted through the daemon log.
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
// auto-push: the board mirror reaches origin, and nothing else does. The push is detached
// now, so wait for it to land before comparing the refs
const mirrorSha = execSync("git rev-parse refs/heads/meta/kanban", { cwd: rootA, encoding: "utf8" }).trim();
await waitFor(
	() => {
		try {
			return execSync("git rev-parse refs/heads/meta/kanban", { cwd: remoteA, encoding: "utf8" }).trim() === mirrorSha;
		} catch {
			return false; // ref not on origin yet
		}
	},
	10000,
	"meta/kanban auto-pushed to origin",
	a.output,
);
assert.equal(execSync("git rev-parse refs/heads/meta/kanban", { cwd: remoteA, encoding: "utf8" }).trim(), mirrorSha, "meta/kanban auto-pushed to origin");
assert.equal(
	execSync("git for-each-ref --format='%(refname)' refs/heads", { cwd: remoteA, encoding: "utf8" }).trim(),
	"refs/heads/meta/kanban",
	"only meta/kanban is pushed to origin",
);
// --mode json: the agent log carries the full JSONL event stream (message, thinking, tool
// events), not print mode's final text only; per-run naming: the first indexed run is 0.
// The run ended while the pipeline moved on, so the sweep compacted its raw log into .log.gz
// (the fd redirect removed the write-time pipe): wait for the gz, then read it decompressed
const logsA = join(kanbanDir(rootA), ".logs");
const logOnDisk = (base: string) => existsSync(join(logsA, `${base}.log`)) || existsSync(join(logsA, `${base}.log.gz`));
await waitFor(() => existsSync(join(logsA, `${slugA}.developer.0.log.gz`)), 30000, "sweep compaction+gzip of the finished developer log", a.output);
const devLogA = gunzipSync(readFileSync(join(logsA, `${slugA}.developer.0.log.gz`))).toString();
for (const record of ['"type":"message_update"', '"type":"tool_execution_start"', '"type":"message_end"']) {
	assert.ok(devLogA.includes(record), `developer log carries JSONL ${record}`);
}
// the retro compact dropped the dead weight, the streamed deltas survive the rewrite
assert.ok(!devLogA.includes('"usage"'), "message_update usage envelope stripped");
assert.ok(!devLogA.includes('"sections"'), "run-opening system prompt echo dropped");
assert.ok(devLogA.includes('"text_delta"'), "streamed text deltas survive the compactor");
assert.equal(devLogA.split('"result echo"').length - 1, 1, "toolResult message_start dropped, its message_end kept");
assert.ok(devLogA.includes('"willRetry":false') && !devLogA.includes('"full replay"'), "agent_end messages dropped, the rest of the record kept");
assert.ok(devLogA.includes("stub stderr diagnostic: not json"), "non-JSON stderr passes through the compactor");
assert.ok(logOnDisk(`${slugA}.reviewer.0`) && logOnDisk(`${slugA}.live-tester.0`), "reviewer and live-tester runs got indexed log files");
// every run here advanced the state itself, so no bounce fired and no death marker lingers
assert.deepEqual(readdirSync(logsA).filter((f) => f.endsWith(".dead")), [], "a run that advances the state itself leaves no death marker");
const legacyA = existsSync(join(logsA, `${slugA}.developer.log`))
	? readFileSync(join(logsA, `${slugA}.developer.log`), "utf8")
	: gunzipSync(readFileSync(join(logsA, `${slugA}.developer.log.gz`))).toString();
assert.equal(legacyA, "legacy\n", "legacy unsuffixed log content survives the sweep; spawns never renamed or rewrote it");
// the reviewer's approval (to-merge) is a successful run: counted once per task
assert.equal(readFileSync(join(logsA, `${slugA}.reviewer-runs.count`), "utf8").trim(), "1", "reviewer approval counted as one successful run");
a.daemon.kill("SIGTERM");

// --- part B: dead agents bounce unconditionally; past the respawn cap the fresh spawn waits for the idle cooldown ---
const rootB = fixture();
cleaned.push(rootB);
mkdirSync(kanbanDir(rootB), { recursive: true });
writeFileSync(join(kanbanDir(rootB), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootB), pollMinutes: 0.01 }));
const taskB = createTask(rootB, { name: "fix: dead agent", summary: "Liveness smoke", specs: "n/a" });
setState(rootB, taskB, "to-do");
// a second task in live-testing with a branch: covers the poll's live-testing -> to-live-test
// bounce, the unmerged-branch requeue to to-merge and the dead merger's merging -> to-merge requeue
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
// under the cap each respawn was immediate: the first six runs kept pace with the 600ms poll
for (let n = 0; n <= 5; n++) {
	// the sweep may have gzipped a finished run's log; either form counts as logged
	assert.ok(existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.${n}.log`)) || existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.${n}.log.gz`)), `developer run ${n} logged`);
	// every bounce marks its own run: the marker names the dying run's index, never the
	// counter files, and its one line is the dying pid
	const deadPath = join(kanbanDir(rootB), ".logs", `${slugB}.developer.${n}.dead`);
	assert.ok(existsSync(deadPath), `bounced developer run ${n} carries its death marker`);
	assert.match(readFileSync(deadPath, "utf8").trim(), /^\d+$/, `death marker of run ${n} records the dying pid`);
}
// the cooldown log fired once at cap+1, and the deferred spawn has not fired yet
await waitFor(() => b.output().includes("respawn waits for the idle cooldown"), 30000, "cooldown log at cap+1", b.output);
assert.equal(b.output().split("respawn waits for the idle cooldown").length - 1, 1, "cooldown log fired exactly once");
assert.ok(!existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.6.log`)) && !existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.6.log.gz`)), "no fresh spawn while the idle cooldown runs");
// the death counter survived the cooldown wait: a bounce clears the pidfile first, so the
// completed-run counter clear does not misfire on the waiting task
assert.equal(readFileSync(join(kanbanDir(rootB), ".logs", `${slugB}.dead.count`), "utf8").trim(), "6", "death counter intact during the cooldown wait");
// aging the task file past the idle interval releases the deferred respawn
const taskBPath = join(kanbanDir(rootB), taskB.file);
const aged = new Date(Date.now() - 6 * 60_000);
utimesSync(taskBPath, aged, aged);
await waitFor(() => existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.6.log`)) || existsSync(join(kanbanDir(rootB), ".logs", `${slugB}.developer.6.log.gz`)), 30000, "fresh spawn after the idle cooldown", b.output);
// the 7th death bounced again with no second cooldown log
assert.equal(b.output().split("respawn waits for the idle cooldown").length - 1, 1, "still one cooldown log past the cap");
// the dead live-tester bounces live-testing -> to-live-test (the merge already happened);
// the branch is unmerged, so the rescan sends the task to the merger first, the dead stub
// exits instantly, and the poll requeues the dead merger's task to to-merge; the failed-merge
// marker keeps it there for the rest of the run
await waitFor(() => b.output().includes("live-testing -> to-live-test"), 30000, "poll bounced the dead live-tester to to-live-test", b.output);
await waitFor(() => b.output().includes("not merged yet, moving to to-merge"), 30000, "unmerged branch sent to the merger first", b.output);
await waitFor(() => b.output().includes("merging -> to-merge"), 30000, "poll requeued the dead merger's task to to-merge", b.output);
assert.equal(parseTask(rootB, taskB2.file).state, "to-merge", "requeued task waits for the idle cooldown");
// a completed run re-arms the streak: a stale pidfile on a task outside the mapped states
// clears the counter, so a second streak past the cap gets its own cooldown log, not silence.
// done, not backlog: the sweep would promote a backlog task back to to-do mid-check
setState(rootB, taskB, "done");
writeFileSync(join(kanbanDir(rootB), ".pids", `${slugB}.pid`), "999999999");
await waitFor(() => b.output().includes("cleared the dead-agent counter"), 30000, "completed run cleared the dead counter", b.output);
setState(rootB, taskB, "to-do");
await waitFor(() => b.output().split("respawn waits for the idle cooldown").length - 1 >= 2, 90000, "second streak cooldown log", b.output);
assert.equal(b.output().split("respawn waits for the idle cooldown").length - 1, 2, "second death streak logged its own cooldown message");
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

// --- part E: to-review tasks get their worktree ensured before the spawn (to-live-test no
// longer needs one: the live test runs on the merged commit) ---
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
// the sweep may have gzipped a finished run; count the run indexes, either file form
const runIdx = (root: string, base: string) =>
	readdirSync(join(kanbanDir(root), ".logs"))
		.filter((f) => f.startsWith(`${base}.`))
		.map((f) => f.slice(base.length + 1).match(/^(\d+)\.log(?:\.gz)?$/)?.[1])
		.filter(Boolean)
		.sort();
const reviewerLogsE = runIdx(rootE, `${slugE}.reviewer`);
assert.deepEqual(
	reviewerLogsE,
	[0, 1, 2, 3, 4, 5].map(String),
	"each reviewer run wrote its own indexed log",
);
assert.ok(!existsSync(join(kanbanDir(rootE), ".logs", `${slugE}.reviewer-runs.count`)), "died reviewer runs never counted as successful");
e.daemon.kill("SIGTERM");

// a to-live-test task whose branch is not merged yet goes to the merger first: the live test
// runs on the merged commit on main, so an unmerged branch must never spawn a live-tester;
// a to-live-test task with no worktree at all routes to to-merge too, where the
// nothing-to-merge path sets done without a live test
const rootF = fixture();
cleaned.push(rootF);
mkdirSync(kanbanDir(rootF), { recursive: true });
writeFileSync(join(kanbanDir(rootF), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootF), pollMinutes: 0.01 }));
const taskF = createTask(rootF, { name: "fix: unmerged live test", summary: "Unmerged branch smoke", specs: "n/a" });
execSync("git checkout -qb feat/unmerged-live && git commit -q --allow-empty -m x && git checkout -q main", { cwd: rootF, shell: "/bin/bash" });
setWorktree(rootF, taskF, "feat/unmerged-live");
setState(rootF, taskF, "to-live-test");
const taskF2 = createTask(rootF, { name: "fix: worktree-less live test", summary: "No-worktree smoke", specs: "n/a" });
setState(rootF, taskF2, "to-live-test");

const f = await runDaemon(rootF);
await waitFor(() => f.output().includes("not merged yet, moving to to-merge"), 30000, "unmerged branch sent to the merger first", f.output);
assert.ok(!f.output().includes("spawned live-tester"), "live-tester never spawned for an unmerged branch");
await waitFor(() => f.output().includes("merging -> to-merge"), 30000, "the dead stub's merge requeued through merging", f.output);
assert.equal(parseTask(rootF, taskF.file).state, "to-merge", "task waits for the merger instead of testing unmerged code");
await waitFor(() => parseTask(rootF, taskF2.file).state === "done", 30000, "no-worktree task done without a live test", f.output);
assert.ok(f.output().includes("nothing to merge, set done"), "no-worktree task routed through the nothing-to-merge path");
f.daemon.kill("SIGTERM");

// --- part G: the merger spawn waits for the task's registered agent to die, and the live
// test runs on the merged commit on main ---
const rootG = fixture();
cleaned.push(rootG);
mkdirSync(kanbanDir(rootG), { recursive: true });
// reviewer stub that waits for the armed marker, re-affirms to-review (a fixes run), then
// lingers alive before exiting: the per-complexity cap advance lands while it lingers, so
// the merger role must wait for its pid. The merger merges the branch into main and sets
// to-live-test; the live-tester runs on main, appends its report and sets done
const lingerStub = join(rootG, "linger-agent.cjs");
writeFileSync(
	lingerStub,
	`#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync, existsSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file) process.exit(0);
if (prompt.includes("Merger agent")) {
	const wt = (readFileSync(file, "utf8").match(/^worktree: "(.*)"$/m) ?? [])[1];
	if (wt) execSync("git merge --no-edit " + wt, { stdio: "ignore" });
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, 'state: "to-live-test"'));
	process.exit(0);
}
if (!readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
const armed = () => join(dirname(file), ".logs", basename(file, ".md") + ".reviewer-armed");
const waitUntil = (cond, ms) => {
	const end = Date.now() + ms;
	while (!cond() && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
};
if (prompt.includes("Reviewer agent")) {
	waitUntil(() => existsSync(armed()), 10000);
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, 'state: "to-review"'));
	waitUntil(() => !existsSync(armed()), 10000);
	setTimeout(() => process.exit(0), 3000);
} else if (prompt.includes("Live-tester")) {
	appendFileSync(file, "\\nLive test report: merger waited for the reviewer pid.\\n");
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, 'state: "done"'));
	process.exit(0);
}
`,
	{ mode: 0o755 },
);
writeFileSync(join(kanbanDir(rootG), "se-llm-team.json"), JSON.stringify({ agent: lingerStub, pollMinutes: 0.01, reviewerCap: { moderate: 1 } }));
const taskG = createTask(rootG, { name: "fix: defer merge while alive", summary: "Deferred merge smoke", specs: "n/a" });
setState(rootG, taskG, "to-review");

const g = await runDaemon(rootG);
// "fix: defer merge while alive" caps at 4 words then drops the type word: defer-merge-while
const wtG = join(rootG, ".worktrees", "fix/1-defer-merge-while");
// cap 1: the first successful reviewer run advances the task to to-merge while the reviewer
// still lingers; the merger spawn must wait for its pid
await waitFor(() => parseTask(rootG, taskG.file).state === "to-merge", 30000, "cap advance to to-merge", g.output);
// the stub lingers 3s before exiting, but its node startup eats into that window, so a fixed
// sleep can land after the stub's death and the whole merger chain on a loaded machine. Poll
// until the registered pid is actually dead instead, asserting the defer continuously while
// it lives: every sweep in the window must defer
const livePidG = () => {
	try {
		return parseInt(readFileSync(join(kanbanDir(rootG), ".pids", `${taskG.file.replace(/\.md$/, "")}.pid`), "utf8").trim(), 10);
	} catch {
		return 0; // pid file cleared once the poll saw the agent dead: the defer window is over
	}
};
await waitFor(
	() => {
		if (!pidAlive(livePidG())) return true;
		assert.ok(existsSync(wtG), "worktree kept while the reviewer pid is alive");
		assert.ok(!g.output().includes("spawned merger"), "no merger spawned while the reviewer pid is alive");
		assert.ok(!mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), "no done mirror commit while the reviewer pid is alive");
		return false;
	},
	30000,
	"reviewer pid death",
	g.output,
);
// once the reviewer exits, the merger merges, the rescan spawns the live-tester on the merged
// commit (cwd=root), and the done mirror commit folds in the live test report
await waitFor(() => g.output().includes("spawned live-tester") && g.output().includes(`(cwd=${rootG})`), 30000, "live-tester runs on the merged commit", g.output);
await waitFor(() => !existsSync(wtG), 30000, "worktree removed at done", g.output);
await waitFor(() => mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), 30000, "deferred done mirror commit", g.output);
assert.ok(g.output().includes("spawned merger"), "merger spawned after the reviewer pid died");
const committedG = execSync(`git show refs/heads/meta/kanban:.kanban/${taskG.file}`, { cwd: rootG, encoding: "utf8", shell: "/bin/bash" });
assert.match(committedG, /Live test report: merger waited for the reviewer pid\./, "live test report folded into the done mirror commit");
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
writeFileSync(join(kanbanDir(rootI), "se-llm-team.json"), JSON.stringify({ agent: join(rootI, "missing-agent"), pollMinutes: 0.01 }));
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
writeFileSync(join(kanbanDir(rootJ), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootJ), pollMinutes: 0.01 }));
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
await new Promise((r) => setTimeout(r, 2000)); // a few sweeps and liveness polls
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
writeFileSync(join(kanbanDir(rootK), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootK), pollMinutes: 0.01, autoScheduleMinutes: 0.08 }));
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
assert.deepEqual(runIdx(rootK, `${slugK}.merger`), ["0", "1"], "merger runs got indexed log files");
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
if (prompt.includes("Merger agent")) {
	setTimeout(() => {
		const wt = (readFileSync(file, "utf8").match(/^worktree: "(.*)"$/m) ?? [])[1];
		if (wt) { try { execSync("git merge --no-edit " + wt, { stdio: "ignore" }); } catch (e) {} }
		writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: to-live-test"));
	}, 2500);
}
else if (prompt.includes("Live-tester")) {
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: done"));
	process.exit(0);
}
`,
	{ mode: 0o755 },
);
writeFileSync(join(kanbanDir(rootK2), "se-llm-team.json"), JSON.stringify({ agent: join(rootK2, "slow-merger.cjs"), pollMinutes: 0.01 }));
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
writeFileSync(join(kanbanDir(rootL), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootL), pollMinutes: 0.01 }));
const taskL = createTask(rootL, { name: "fix: bootstrap board", summary: "Bootstrap smoke", specs: "n/a", openQuestions: "- [user] Which API?" });
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
await new Promise((r) => setTimeout(r, 1500));
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
writeFileSync(join(kanbanDir(cloneM), "se-llm-team.json"), JSON.stringify({ agent: deadStub(cloneM), pollMinutes: 0.01 }));

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
writeFileSync(join(kanbanDir(rootO), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootO), pollMinutes: 0.01 }));
const taskO1 = createTask(rootO, { name: "fix: settled done task", summary: "Settled", specs: "n/a" });
setState(rootO, taskO1, "done");

const mo = await runDaemon(rootO);
await waitFor(() => mirrorSubjects(rootO) !== "", 30000, "settled done task mirrored", mo.output);
// a new task arrives while the settled done task exists: it must get its own create commit
const taskO2 = createTask(rootO, { name: "fix: late arrival", summary: "Created after a done task", specs: "n/a" });
// generous timeout: under load the daemon's scan loop can stall past 10s (silence, no crash),
// so a fixed 10s wait flakes (000083); 30s matches the first-wait timeouts above
await waitFor(() => mirrorSubjects(rootO).includes(`kanban: create ${taskO2.file}`), 30000, "late task create commit", mo.output);
// further sweeps change nothing: no done-label folding, no commit churn
await new Promise((r) => setTimeout(r, 1500));
assert.deepEqual(mirrorSubjects(rootO).split("\n"), [`kanban: create ${taskO2.file}`, `kanban: create ${taskO1.file}`]);
mo.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + settled done task create-event smoke passed");

// --- part P: an external mirror-head move is reconciled into the working tree within one scan
// (external add and external deletion both propagate; the reconcile itself commits nothing)
const rootP = fixture();
cleaned.push(rootP);
mkdirSync(kanbanDir(rootP), { recursive: true });
writeFileSync(join(kanbanDir(rootP), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootP), pollMinutes: 0.01 }));
const taskP = createTask(rootP, { name: "fix: external move", summary: "Reconcile smoke", specs: "n/a", openQuestions: "- [user] Which API?" });
const p = await runDaemon(rootP);
await waitFor(() => mirrorSubjects(rootP) !== "", 30000, "task mirrored", p.output);
const contentP = readFileSync(join(kanbanDir(rootP), taskP.file), "utf8");
// the tip gains a task while the working tree lacks it: one scan must materialize it
const externalP = "000002_feat_external_task.md";
const externalContentP = taskContent("fix: external task", "done");
const extP = externalCommit(rootP, { [taskP.file]: contentP, [externalP]: externalContentP }, "external: add a task");
await waitFor(() => existsSync(join(kanbanDir(rootP), externalP)), 30000, "external add materialized within one scan", p.output);
assert.equal(readFileSync(join(kanbanDir(rootP), externalP), "utf8"), externalContentP, "external content materialized byte-for-byte");
// the tip then loses it again: the deletion propagates to the working tree
const extP2 = externalCommit(rootP, { [taskP.file]: contentP }, "external: drop a task");
await waitFor(() => !existsSync(join(kanbanDir(rootP), externalP)), 30000, "external deletion propagated to the working tree", p.output);
assert.equal(readFileSync(join(kanbanDir(rootP), taskP.file), "utf8"), contentP, "untouched task file unchanged by the reconcile");
assert.ok(showTip(rootP, taskP.file) !== null, "the untouched task stays on the branch");
// the reconcile itself commits nothing: the board already matches the tip
await new Promise((r) => setTimeout(r, 1500));
assert.deepEqual(
	mirrorSubjects(rootP).split("\n").filter((s) => s.startsWith("kanban:")),
	[`kanban: create ${taskP.file}`],
	"reconcile adds no mirror commits",
);
await waitFor(() => p.output().includes(`reconciled .kanban to ${extP2}`), 30000, "reconcile logged", p.output);
assert.ok(p.output().includes(`reconciled .kanban to ${extP}: 1 file(s) updated, 0 deleted`), "reconcile log line carries hash, updated and deleted counts");
assert.ok(p.output().includes(`reconciled .kanban to ${extP2}: 0 file(s) updated, 1 deleted`), "deletion reconcile logged with counts");
p.daemon.kill("SIGTERM");

// --- part Q: a stale working tree never erases branch-only files, and an unmirrored local
// write survives the reconcile: the next mirror commit is built after the reconcile, so the
// branch-only file folds in instead of being dropped
const rootQ = fixture();
cleaned.push(rootQ);
mkdirSync(kanbanDir(rootQ), { recursive: true });
writeFileSync(join(kanbanDir(rootQ), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootQ), pollMinutes: 0.01 }));
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
await waitFor(() => existsSync(join(kanbanDir(rootQ), externalQ)), 30000, "branch-only file materialized", q.output);
assert.ok(existsSync(join(kanbanDir(rootQ), inflightQ)), "unmirrored in-flight write survives the reconcile");
// the next mirror commit (the in-flight file's own create) must carry the branch-only file
await waitFor(() => showTip(rootQ, externalQ) !== null && execSync(`git rev-parse refs/heads/meta/kanban`, { cwd: rootQ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() !== extQ, 30000, "next mirror commit keeps the branch-only file", q.output);
assert.equal(showTip(rootQ, externalQ), externalContentQ, "branch-only file survived the next mirror commit");
assert.ok(mirrorSubjects(rootQ).includes(`kanban: create ${inflightQ}`), "in-flight write got its own create commit");
assert.equal(showTip(rootQ, inflightQ), inflightContentQ, "in-flight write mirrored after the reconcile");
q.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + mirror reconcile smoke passed");

// --- part R: promotion is event-driven: every schedulable backlog task promotes on the
// sweep, in parallel lanes, even while other tasks run; open questions hold a task ---
const rootR = fixture();
cleaned.push(rootR);
mkdirSync(kanbanDir(rootR), { recursive: true });
// the working stub completes every promoted task, so the board is never idle: promotion
// must not wait for idle (the old failsafe did)
writeFileSync(join(kanbanDir(rootR), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootR), pollMinutes: 0.01 }));
const taskR0 = createTask(rootR, { name: "feat: active task", summary: "Promotion smoke", specs: "n/a" });
setState(rootR, taskR0, "to-do");
// two unchained backlog tasks: both promote at once, in parallel lanes
const taskR1 = createTask(rootR, { name: "feat: lane one", priority: "low", summary: "Promotion smoke", specs: "n/a" });
const taskR2 = createTask(rootR, { name: "feat: lane two", priority: "low", summary: "Promotion smoke", specs: "n/a" });
// unanswered open questions mean the task waits for the user: never promoted
const taskRQ = createTask(rootR, { name: "feat: blocked by questions", priority: "critical", summary: "Promotion smoke", specs: "n/a", openQuestions: "- [user] Which API?" });
// a task chained behind lane one: held until its blocker stops blocking (reaches the live test
// or done, never to-merge/merging)
const taskR3 = createTask(rootR, { name: "feat: chained task", priority: "critical", summary: "Promotion smoke", specs: "n/a", blockedBy: `#${parseInt(taskR1.file, 10)}` });

const r = await runDaemon(rootR);
const readR = (file: string) => parseTask(rootR, file);
assert.equal(readR(taskRQ.file).openQuestions, "- [user] Which API?", "precondition: unanswered open questions present");
// the sweep promotes while taskR0 is still active: no idle gate, both unchained tasks at once
await waitFor(
	() => r.output().includes(`promoting ${taskR1.file} to to-do`) && r.output().includes(`promoting ${taskR2.file} to to-do`),
	30000,
	"both unchained backlog tasks promoted",
	r.output,
);
assert.ok(readR(taskR0.file).state !== "done", "promotion fired while another task was still active");
assert.equal(readR(taskRQ.file).state, "backlog", "task with unanswered open questions never promoted");
assert.equal(readR(taskR3.file).state, "backlog", "chained task held while its blocker still runs");
// the chain serializes: the chained task promotes only after its blocker stops blocking, and
// the daemon drops the ref from blockedBy in the same sweep
await waitFor(() => readR(taskR1.file).state === "done", 60000, "lane one completed", r.output);
await waitFor(() => r.output().includes(`promoting ${taskR3.file} to to-do`), 30000, "chained task promoted after its blocker stopped blocking", r.output);
assert.notEqual(readR(taskR3.file).state, "backlog", "chained task active after promotion");
assert.ok(!readR(taskR3.file).blockedBy.includes(`#${parseInt(taskR1.file, 10)}`), "satisfied blocker ref dropped from blockedBy");
assert.ok(r.output().includes(`dropped satisfied blocker ref(s) #${parseInt(taskR1.file, 10)}`), "ref drop logged");
assert.equal(r.output().split("promoting ").length - 1, 3, "each schedulable task promoted exactly once");
r.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + event-driven promotion smoke passed");

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
writeFileSync(join(kanbanDir(rootT), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootT), pollMinutes: 0.01 }));
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
writeFileSync(join(kanbanDir(rootT2), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootT2), pollMinutes: 0.01 }));
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
const regRes = await fetch(`${hubBase}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "b", root: rootU2, branch: "feat/x" }) });
assert.equal(regRes.status, 200);
const regEntry = await regRes.json();
assert.deepEqual(Object.keys(regEntry).sort(), ["branch", "lastHeartbeat", "name", "root", "start"], "register answers the entry shape");
assert.equal(regEntry.branch, "feat/x", "register stores the checkout's branch");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b" }) })).status, 400, "register without root rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "", root: rootU2 }) })).status, 400, "register with empty name rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b", root: "/nonexistent/dir" }) })).status, 400, "register with nonexistent root rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b", root: "relative/dir" }) })).status, 400, "register with relative root rejected");
const beforeBeat = (await (await fetch(`${hubBase}/api/projects`)).json()).find((e: any) => e.name === "b");
assert.equal((await fetch(`${hubBase}/heartbeat`, { method: "POST", body: JSON.stringify({ name: "b" }) })).status, 200, "a name-only heartbeat (old daemon) still finds the entry");
assert.equal((await fetch(`${hubBase}/heartbeat`, { method: "POST", body: JSON.stringify({ name: "nope" }) })).status, 404, "heartbeat of an unknown project 404s");
assert.equal((await fetch(`${hubBase}/heartbeat`, { method: "POST", body: JSON.stringify({ name: "b", root: rootU2, branch: "main" }) })).status, 200);
const afterBeat = (await (await fetch(`${hubBase}/api/projects`)).json()).find((e: any) => e.name === "b");
assert.ok(afterBeat.lastHeartbeat >= beforeBeat.lastHeartbeat, "heartbeat refreshes lastHeartbeat");
assert.equal(afterBeat.branch, "main", "heartbeat re-resolves the branch, so the label tracks the checkout");
const registryU = readHubRegistry();
assert.deepEqual(registryU.map((e) => e.name).sort(), ["a", "b"], "stale seed entry dropped, one entry per project");
assert.equal(registryU.find((e) => e.name === "a")!.root, rootU1);
assert.equal(registryU.find((e) => e.name === "b")!.root, rootU2);
assert.deepEqual(readdirSync(join(homeU, ".pi", "agent")).filter((f) => f.includes(".tmp")), [], "no atomic-rename temp litter");
const viaProject = await (await fetch(`${hubBase}/api/tasks?project=b`)).json();
assert.equal(viaProject.length, 1);
assert.equal(viaProject[0].file, taskU2.file);
assert.equal(viaProject[0].name, "fix: hub board b");
// 000103: root is the identity - a second checkout of the same repo registers its own entry
const rootU3 = fixture();
cleaned.push(rootU3);
const taskU3 = createTask(rootU3, { name: "fix: hub board b2", summary: "Hub smoke", specs: "n/a" });
const reg3 = await fetch(`${hubBase}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "b", root: rootU3, branch: "feat" }) });
assert.equal(reg3.status, 200);
const sameNamed = (await (await fetch(`${hubBase}/api/projects`)).json()).filter((e: any) => e.name === "b");
assert.equal(sameNamed.length, 2, "two same-named checkouts keep their own entries");
assert.deepEqual((await (await fetch(`${hubBase}/api/tasks?project=${encodeURIComponent(rootU2)}`)).json()).map((t: any) => t.file), [taskU2.file], "root selects the first checkout's board");
assert.deepEqual((await (await fetch(`${hubBase}/api/tasks?project=${encodeURIComponent(rootU3)}`)).json()).map((t: any) => t.file), [taskU3.file], "root selects the second checkout's board");
assert.equal((await fetch(`${hubBase}/api/tasks?project=nope`)).status, 404, "unknown project rejected");
assert.equal((await (await fetch(`${hubBase}/api/tasks`)).json()).length, 0, "no project param serves the hub's own board");
assert.equal((await (await fetch(`${hubBase}/api/projects`)).json()).length, 3);
assert.ok((await (await fetch(`${hubBase}/`)).text()).includes("Software Engineering LLM Team"), "the hub serves the ui page");
assert.equal((await fetch(`${hubBase}/api/tasks`, { method: "POST" })).status, 404);
// b stops heartbeating: the running hub ages the silent entry out of the registry
await waitFor(() => readHubRegistry().map((e) => e.name).join() === "a", 5000, "running hub ages out silent entries", () => "");
assert.equal((await fetch(`${hubBase}/api/tasks?project=b`)).status, 404, "aged-out project no longer served");
hubU.close();
assert.deepEqual(readHubRegistry(), [], "close removes the hub's own entry from the registry");
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
assert.ok(registryV.every((e: any) => typeof e.branch === "string" && e.branch.length > 0), "registry entries carry the root checkout's branch");
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

// --- part Y: 000165 a worktree daemon never serves the ui and reaps itself when its task ends ---
const rootWt = fixture();
const homeWt = mkdtempSync(join(tmpdir(), "orch-hub-wt-home-"));
cleaned.push(rootWt, homeWt);
const portWt = await freePort();
mkdirSync(join(homeWt, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeWt, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portWt } }));
// the owner task: open (openQuestions keep the sweep from promoting it), worktree attribute set
const taskWt = createTask(rootWt, { name: "feat: worktree daemon", summary: "Hub candidacy smoke", specs: "n/a", openQuestions: "smoke: stays open" });
setWorktree(rootWt, taskWt, "fix/1-wt");
setState(rootWt, taskWt, "doing");
execSync("git worktree add .worktrees/fix/1-wt -b fix/1-wt", { cwd: rootWt, shell: "/bin/bash" });
const wtPath = join(rootWt, ".worktrees", "fix", "1-wt");
const envWt = { ...process.env, HOME: homeWt, SE_LLM_TEAM_HUB_HEALTH_MS: "500" };
delete envWt.SE_LLM_TEAM_NO_WEBUI;
// the hub comes up AFTER the worktree daemon: its startup election stands down instead of racing
const dWt = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", wtPath, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: envWt });
daemons.push({ daemon: dWt, root: wtPath });
let outWt = "";
dWt.stdout.on("data", (d) => (outWt += d));
dWt.stderr.on("data", (d) => (outWt += d));
const exitWt = new Promise<string>((r) => dWt.on("exit", (code) => r(String(code))));
await waitFor(() => outWt.includes("stands down"), 15000, "worktree daemon stands down at startup with no hub", () => outWt);
assert.ok(!outWt.includes("web ui on"), "a worktree daemon never races for the port");
const realHomeWt = process.env.HOME;
process.env.HOME = homeWt;
const hubWt = await startHub({ name: basename(rootWt), root: rootWt, host: "127.0.0.1", port: portWt, healthMs: 500, staleMs: 3000 });
assert.ok(hubWt, "the hub starts in-process");
await waitForAsync(async () => {
	try {
		return (await (await fetch(`http://127.0.0.1:${portWt}/api/projects`)).json()).some((e: any) => e.root === wtPath);
	} catch {
		return false;
	}
}, 15000, "worktree daemon registers with the hub once it appears");
await new Promise((r) => setTimeout(r, 2000)); // several hub ticks: still never served
assert.ok(!outWt.includes("web ui on"), "a worktree daemon never serves the ui");
assert.equal(await Promise.race([exitWt, Promise.resolve("alive")]), "alive", "the worktree daemon stays alive while its task is open");
// the task goes done: the daemon reaps itself on its next sweep
setState(rootWt, taskWt, "done");
assert.equal(await Promise.race([exitWt, new Promise<string>((r) => setTimeout(() => r("timeout"), 15000))]), "0", "the worktree daemon reaped itself when its task went done");
// the task gone: a fresh daemon reaps at startup, before anything recreates the removed worktree's dirs
rmSync(join(rootWt, ".kanban", taskWt.file));
rmSync(join(rootWt, ".worktrees"), { recursive: true, force: true });
const dWt2 = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", wtPath, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: envWt });
daemons.push({ daemon: dWt2, root: wtPath });
let outWt2 = "";
dWt2.stdout.on("data", (d) => (outWt2 += d));
dWt2.stderr.on("data", (d) => (outWt2 += d));
const exitWt2 = new Promise<string>((r) => dWt2.on("exit", (code) => r(String(code))));
assert.equal(await Promise.race([exitWt2, new Promise<string>((r) => setTimeout(() => r("timeout"), 15000))]), "0", "a worktree daemon whose task is gone reaps at startup");
assert.ok(!existsSync(wtPath), "the startup reap ran before the dirs were recreated, no worktree shell left behind");
process.env.HOME = realHomeWt;
hubWt.close();
console.log("orchestrator.test.ts: ... + worktree hub candidacy smoke passed");

// --- part Y2: 000168 hub candidacy is git topology: a linked worktree outside .worktrees
// stands down like a task worktree; a main checkout, a subdir of one and a non-git root stay
// hub-eligible ---
const repoT = fixture();
const wtT = join(mkdtempSync(join(tmpdir(), "orch-hub-wt-out-")), "wt");
cleaned.push(repoT, dirname(wtT));
execSync(`git worktree add -q ${wtT} -b wt-out`, { cwd: repoT, shell: "/bin/bash" });
assert.equal(isLinkedWorktree(repoT), false, "a main checkout is hub-eligible");
mkdirSync(join(repoT, "sub"));
assert.equal(isLinkedWorktree(join(repoT, "sub")), false, "a subdir of a main checkout is hub-eligible");
assert.equal(isLinkedWorktree(wtT), true, "a linked worktree outside .worktrees is not hub-eligible");
mkdirSync(join(wtT, "sub"));
assert.equal(isLinkedWorktree(join(wtT, "sub")), true, "a subdir of a linked worktree is not hub-eligible");
const nogitT = mkdtempSync(join(tmpdir(), "orch-hub-nogit-"));
cleaned.push(nogitT);
assert.equal(isLinkedWorktree(nogitT), false, "a non-git root is hub-eligible");
const homeT = mkdtempSync(join(tmpdir(), "orch-hub-wt-out-home-"));
cleaned.push(homeT);
const portT = await freePort();
mkdirSync(join(homeT, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeT, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portT } }));
const envT = { ...process.env, HOME: homeT, SE_LLM_TEAM_HUB_HEALTH_MS: "300" };
delete envT.SE_LLM_TEAM_NO_WEBUI;
const dT = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", wtT, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: envT });
daemons.push({ daemon: dT, root: wtT });
let outT = "";
dT.stdout.on("data", (d) => (outT += d));
dT.stderr.on("data", (d) => (outT += d));
const exitT = new Promise<string>((r) => dT.on("exit", (code) => r(String(code))));
await waitFor(() => outT.includes("stands down"), 15000, "worktree-outside-.worktrees daemon stands down with no hub", () => outT);
assert.ok(!outT.includes("web ui on"), "a worktree outside .worktrees never races for the port");
assert.ok(!existsSync(join(homeT, ".pi", "agent", "se-llm-team-hub.lock")), "a worktree outside .worktrees never races for the hub lock");
await new Promise((r) => setTimeout(r, 1200)); // several hub ticks: still never served
assert.ok(!outT.includes("web ui on"), "a worktree outside .worktrees never serves the ui");
assert.equal(await Promise.race([exitT, Promise.resolve("alive")]), "alive", "a daemon rooted outside .worktrees is not reaped as a task worktree");
dT.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + worktree-outside-.worktrees hub candidacy smoke passed");

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
const role = prompt.includes("Merger agent") ? "merger"
	: prompt.includes("Developer agent") ? "developer"
	: prompt.includes("Reviewer agent") ? "reviewer"
	: prompt.includes("Live-tester") ? "live-tester" : "";
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
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + (merged ? "to-live-test" : "to-merge")));
}
const next = role === "developer" ? "to-review" : role === "reviewer" ? "to-merge" : role === "live-tester" ? "done" : null;
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
		pollMinutes: 0.01,
		model: "global-model",
		thinking: "high",
		roles: {
			developer: { model: "dev-model", thinking: "low", complex: { model: "dev-complex-model" } },
			reviewer: { provider: "prov", model: "rev-model" },
			merger: { provider: "mprov", model: "merge-model" },
		},
	}),
);
const taskX = createTask(rootX, { name: "feat: llm flags", summary: "LLM config smoke", specs: "n/a" });
setState(rootX, taskX, "to-do");
// a complex task: the developer resolves through roles.developer.complex
const taskX3 = createTask(rootX, { name: "feat: llm flags complex", summary: "LLM config smoke", specs: "n/a", complexity: "complex" });
setState(rootX, taskX3, "to-do");

const x = await runDaemon(rootX, join(HERE, "orchestrator.ts"), homeX);
await waitFor(
	() =>
		[taskX, taskX3].every((t) => parseTask(rootX, t.file).state === "done" && parseTask(rootX, t.file).worktree === ""),
	60000,
	"pipelines with llm config",
	x.output,
);
const xSpawns = () => readFileSync(join(rootX, "argv.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { role: string; argv: string[] });
// the prompt carries the task file path, so spawns are attributable per task
const xFlags = (role: string, file: string) => {
	const spawns = xSpawns().filter((s) => s.role === role && (s.argv[s.argv.indexOf("-p") + 1] ?? "").includes(file));
	return llmArgs(spawns[spawns.length - 1].argv);
};
assert.deepEqual(xFlags("developer", taskX.file), ["--model", "dev-model", "--thinking", "low"], "role entry overrides both global fields for a moderate task");
assert.deepEqual(xFlags("developer", taskX3.file), ["--model", "dev-complex-model", "--thinking", "low"], "complexity entry overrides the nested field; unset nested fields keep the role default");
assert.deepEqual(xFlags("reviewer", taskX.file), ["--provider", "prov", "--model", "rev-model", "--thinking", "high"], "role provider+model keeps the global thinking");
assert.deepEqual(xFlags("live-tester", taskX.file), ["--model", "global-model", "--thinking", "high"], "no role entry: the global fields apply");

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
await waitFor(() => xSpawns().some((s) => s.role === "merger" && (s.argv[s.argv.indexOf("-p") + 1] ?? "").includes(taskX2.file)), 30000, "merger spawned under the llm config", x.output);
assert.deepEqual(xFlags("merger", taskX2.file), ["--provider", "mprov", "--model", "merge-model", "--thinking", "high"], "merger role override applies");
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
	JSON.stringify({ agent: argvStub(rootY), pollMinutes: 0.01, provider: "lonely-provider", thinking: "banana", roles: { developer: "not-an-object", reviewer: { thinking: "wild", complex: "not-an-object" } } }),
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
assert.ok(y.output().includes('non-object complexity override "not-an-object" for role "reviewer" complex, ignored'), "non-object complexity override warned about");
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
writeFileSync(join(kanbanDir(rootZ), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootZ), pollMinutes: 0.01 }));
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

// --- part AA: the reviewer successful-run cap: for the default moderate complexity, 2
// successful runs, the 3rd spawn is refused ---
// a reviewer run is successful when it sets the task state itself (back to to-review after
// changes, or forward to to-merge on approval); died runs go through the dead counter
const loopStub = (root: string) => {
	const stub = join(root, "loop-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
if (prompt.includes("Merger agent")) {
	const wt = (readFileSync(file, "utf8").match(/^worktree: "(.*)"$/m) ?? [])[1];
	let merged = false;
	if (wt) {
		try { execSync("git merge --no-edit " + wt, { stdio: "ignore" }); merged = true; }
		catch (e) { try { execSync("git merge --abort", { stdio: "ignore" }); } catch (e2) {} }
	}
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + (merged ? "to-live-test" : "to-merge")));
	process.exit(0);
}
const isReviewer = prompt.includes("Reviewer agent");
// a reviewer must not outrun the daemon's bookkeeping: it waits for the post-spawn armed
// marker (the daemon took over), writes its state, then waits for the next sweep to consume
// the marker with the pidfile still matching (the run was counted). Exiting earlier lets a
// poll tick clear the pidfile between the exit and that sweep, so consumeReviewerRun drops
// the run uncounted and one spawn past the cap happens
const armed = () => join(dirname(file), ".logs", basename(file, ".md") + ".reviewer-armed");
const waitUntil = (cond, ms) => {
	const end = Date.now() + ms;
	while (!cond() && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
};
if (isReviewer) waitUntil(() => existsSync(armed()), 10000);
const next = prompt.includes("Reviewer agent") ? "to-review" : prompt.includes("Live-tester") ? "done" : null;
if (next) writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + next));
if (isReviewer) waitUntil(() => !existsSync(armed()), 10000);
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

const rootAA = fixture();
cleaned.push(rootAA);
mkdirSync(kanbanDir(rootAA), { recursive: true });
writeFileSync(join(kanbanDir(rootAA), "se-llm-team.json"), JSON.stringify({ agent: loopStub(rootAA), pollMinutes: 0.01 }));
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
// two successful reviewer runs (each back to to-review), then the 3rd spawn is refused
await waitFor(() => aa.output().includes(`${taskAA.file}: reviewer succeeded 2+ times, moving to to-merge`), 60000, "reviewer cap refusal logged", aa.output);
assert.equal(aa.output().split("spawned reviewer").length - 1, 2, "exactly two reviewer spawns before the refusal");
assert.equal(runsAA(), 0, "the counter cleared on the forced to-merge advance");
assert.deepEqual(runIdx(rootAA, `${slugAA}.reviewer`), ["0", "1"], "two indexed reviewer run logs, no third");
// the pipeline continues from the forced advance: the live-tester runs and the task completes
await waitFor(() => parseTask(rootAA, taskAA.file).state === "done" && parseTask(rootAA, taskAA.file).worktree === "", 60000, "pipeline after the cap refusal", aa.output);
assert.equal(runsAA(), 0, "counter still cleared after the pipeline completed");
aa.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + reviewer successful-run cap smoke passed");

// --- part AB: the compactor drops the moderate drop list, keeps the read path byte-for-byte ---
// fixture JSONL with one record per rule class; the pi stderr line is a non-JSON passthrough
const compactorFixture = (): string =>
	[
		JSON.stringify({ type: "session", version: 3, id: "s", timestamp: 0, cwd: "/t" }),
		JSON.stringify({ type: "agent_start" }),
		JSON.stringify({ type: "turn_start" }),
		JSON.stringify({ type: "message_start", message: { role: "system", content: "", sections: { preamble: "the ~135 KB system prompt" } } }),
		JSON.stringify({ type: "message_end", message: { role: "system", content: "", sections: { preamble: "the ~135 KB system prompt" } } }),
		JSON.stringify({ type: "message_update", usage: { input: 0, output: 5, cost: { total: 0.01 } }, assistantMessageEvent: { type: "thinking_delta", delta: "héllo→" } }),
		JSON.stringify({ type: "message_update", usage: { output: 6 }, assistantMessageEvent: { type: "toolcall_delta", id: "t1", delta: '{"command"' } }),
		JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }),
		JSON.stringify({ type: "message_start", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "full tool result" }] } }),
		JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "git status" } }),
		JSON.stringify({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: { content: [{ type: "text", text: "Agent ID: a1\nOutput file: sub.log\nfull body" }], isError: false } }),
		JSON.stringify({ type: "message_end", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "full tool result" }] } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
		JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "turn replay" }] } }),
		JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: "the full message replay" }], willRetry: false }),
		"pi stderr diagnostics: not json",
		JSON.stringify({ type: "message_end", message: { role: "user", content: "the prompt" } }),
	].join("\n") + "\n";

// per-rule asserts on the line-level function
assert.equal(compactLogLine(JSON.stringify({ type: "message_start", message: { role: "system", sections: {} } })), null, "system message_start dropped");
assert.equal(compactLogLine(JSON.stringify({ type: "message_end", message: { role: "system", sections: {} } })), null, "system message_end dropped");
assert.equal(compactLogLine(JSON.stringify({ type: "message_start", message: { role: "toolResult", content: [] } })), null, "toolResult message_start dropped");
const turnEndLine = JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [] } });
assert.equal(compactLogLine(turnEndLine), turnEndLine, "turn_end kept verbatim");
assert.equal(compactLogLine("plain stderr line"), "plain stderr line", "non-JSON stderr passthrough");

// the whole fixture line-by-line: compaction is the retro pass now (the fd redirect removed
// the write-time pipe), so each complete line goes through compactLogLine directly, the way
// compactFinishedLogs runs it
const linesAB = compactorFixture().split("\n").map(compactLogLine);
assert.equal(linesAB[linesAB.length - 1], "", "trailing newline preserved");
const recsAB = linesAB.slice(0, -1).filter((l) => l !== null);
assert.equal(recsAB.length, 14, "one line per surviving record, dropped records removed whole");
const parsedAB = recsAB.map((l) => {
	try {
		return JSON.parse(l);
	} catch {
		return l;
	}
});
assert.equal(recsAB[12], "pi stderr diagnostics: not json", "stderr passthrough, position preserved");
assert.ok(!parsedAB.some((p: any) => p.type === "message_start" && p.message?.role === "system"), "system message_start gone");
assert.ok(!parsedAB.some((p: any) => p.type === "message_end" && p.message?.role === "system"), "system message_end gone");
assert.ok(!parsedAB.some((p: any) => p.type === "message_start" && p.message?.role === "toolResult"), "toolResult message_start gone");
assert.ok(parsedAB.some((p: any) => p.type === "message_end" && p.message?.role === "toolResult"), "toolResult message_end kept verbatim");
const muAB = parsedAB.find((p: any) => p.type === "message_update");
assert.deepEqual(muAB.assistantMessageEvent, { type: "thinking_delta", delta: "héllo→" }, "multibyte split reassembled, event verbatim");
assert.deepEqual(Object.keys(muAB).sort(), ["assistantMessageEvent", "type"], "usage envelope stripped");
assert.deepEqual(parsedAB.find((p: any) => p.type === "agent_end"), { type: "agent_end", willRetry: false }, "agent_end messages dropped, the rest kept");
assert.equal(
	parsedAB.find((p: any) => p.type === "tool_execution_end").result.content[0].text.includes("Agent ID: a1"),
	true,
	"full tool result kept for the subagent-log matching",
);
assert.ok(parsedAB.some((p: any) => p.type === "message_end" && p.message?.role === "user"), "the user prompt's message_end kept");
assert.equal(parsedAB.find((p: any) => p.type === "message_update" && p.assistantMessageEvent.type === "toolcall_delta") !== undefined, true, "toolcall deltas survive");
console.log("orchestrator.test.ts: ... + log compactor rules smoke passed");

// --- part AC: every sweep compacts finished logs into .log.gz, never logs with a live pid ---
const rootAC = fixture();
cleaned.push(rootAC);
mkdirSync(join(kanbanDir(rootAC), ".logs"), { recursive: true });
mkdirSync(join(kanbanDir(rootAC), ".pids"), { recursive: true });
const slugDoneAC = "000201_retro_done";
const slugRunAC = "000202_retro_running";
const slugMergAC = "000203_retro_merger";
const logAC = (name: string) => join(kanbanDir(rootAC), ".logs", name);
writeFileSync(logAC(`${slugDoneAC}.developer.0.log`), compactorFixture());
writeFileSync(logAC(`${slugRunAC}.developer.0.log`), compactorFixture());
writeFileSync(logAC(`${slugMergAC}.merger.0.log`), compactorFixture());
writeFileSync(logAC("orchestrator.log"), "daemon log\n");
writeFileSync(logAC(`${slugDoneAC}.reviewer-armed`), "123");
writeFileSync(logAC("push-failures.count"), "3");
writeFileSync(join(kanbanDir(rootAC), ".pids", `${slugRunAC}.pid`), String(process.pid));
writeFileSync(join(kanbanDir(rootAC), ".pids", "merger.pid"), String(process.pid));
const retroAC = compactFinishedLogs(rootAC);
assert.equal(retroAC.files, 1, "only the finished log compacted+gzipped; running and merger logs skipped");
assert.ok(retroAC.after < retroAC.before, "the gzip shrank the log");
assert.ok(!existsSync(logAC(`${slugDoneAC}.developer.0.log`)), "the plain file is replaced by the .log.gz");
const doneAfterAC = gunzipSync(readFileSync(logAC(`${slugDoneAC}.developer.0.log.gz`))).toString();
assert.ok(!doneAfterAC.includes('"usage"') && !doneAfterAC.includes('"sections"'), "gzipped slim");
assert.ok(doneAfterAC.includes('"type":"tool_execution_end"'), "tool results survive the compaction");
assert.equal(doneAfterAC.split("\n").length, compactorFixture().split("\n").length - 3, "exactly the three dead records dropped");
assert.equal(readFileSync(logAC(`${slugRunAC}.developer.0.log`), "utf8"), compactorFixture(), "running log stays plain and appendable");
assert.ok(!existsSync(`${logAC(`${slugRunAC}.developer.0.log`)}.gz`), "no gz for a live agent's log");
assert.equal(readFileSync(logAC(`${slugMergAC}.merger.0.log`), "utf8"), compactorFixture(), "merger log untouched while the merger pidfile exists");
assert.equal(readFileSync(logAC("orchestrator.log"), "utf8"), "daemon log\n", "orchestrator.log skipped");
assert.equal(readFileSync(logAC(`${slugDoneAC}.reviewer-armed`), "utf8"), "123", "armed marker skipped");
assert.equal(readFileSync(logAC("push-failures.count"), "utf8"), "3", "counter skipped");
assert.equal(compactFinishedLogs(rootAC).files, 0, "already-gzipped logs never match: a second pass is a no-op");
assert.equal(nextRunIndex(rootAC, slugDoneAC, "developer"), 1, "a gzipped run still counts, so a fresh spawn never reuses the index");
console.log("orchestrator.test.ts: ... + retro sweep smoke passed");

// --- part AF: a live agent pid defers the sweep spawn, so a to-do rewrite cannot twin it ---
// the bug: the liveness poll requeued a doing task to to-do, the sweep spawned a developer,
// then a second trigger let the next sweep spawn a twin whose writePid overwrote the first
// pid file and orphaned the first agent. The live pid is the guard, the state alone is not.
const rootAF = fixture();
cleaned.push(rootAF);
mkdirSync(kanbanDir(rootAF), { recursive: true });
// developer stub that records the state it reads at startup (the set-before-spawn proof) and
// then lingers alive, so several sweeps run while its pid file is the only live-agent guard
const guardStub = join(rootAF, "guard-agent.cjs");
writeFileSync(
	guardStub,
	`#!/usr/bin/env node
const { readFileSync, appendFileSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!prompt.includes("Developer agent") || !file) process.exit(0);
const state = (readFileSync(file, "utf8").match(/^state: "(.*)"$/m) ?? [])[1] ?? "";
appendFileSync(${JSON.stringify(join(rootAF, "guard.log"))}, JSON.stringify({ pid: process.pid, state }) + "\\n");
setTimeout(() => process.exit(0), 5000);
`,
	{ mode: 0o755 },
);
writeFileSync(join(kanbanDir(rootAF), "se-llm-team.json"), JSON.stringify({ agent: guardStub, pollMinutes: 0.01 }));
const taskAF = createTask(rootAF, { name: "fix: no double spawn", summary: "Double-spawn guard smoke", specs: "n/a" });
setState(rootAF, taskAF, "to-do");
const slugAF = taskAF.file.replace(/\.md$/, "");
const pidFileAF = join(kanbanDir(rootAF), ".pids", `${slugAF}.pid`);
const guardRunsAF = () => {
	try {
		return readFileSync(join(rootAF, "guard.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pid: number; state: string });
	} catch {
		return [];
	}
};

const af = await runDaemon(rootAF);
const spawnedAF = () => af.output().split("spawned developer").length - 1;
await waitFor(() => guardRunsAF().length === 1, 30000, "first developer spawned", af.output);
assert.equal(guardRunsAF()[0].state, "doing", "the state attribute was already set when the agent started");
assert.equal(parseInt(readFileSync(pidFileAF, "utf8").trim(), 10), guardRunsAF()[0].pid, "pid file names the first agent");
// the to-do rewrite that used to twin the agent: several sweeps and a liveness poll later,
// the pid check, not the state, must still keep the second spawn away
writeFileSync(join(kanbanDir(rootAF), taskAF.file), readFileSync(join(kanbanDir(rootAF), taskAF.file), "utf8").replace(/^state: .*/m, 'state: "to-do"'));
await new Promise((r) => setTimeout(r, 1500));
assert.equal(spawnedAF(), 1, "no second developer while the first agent pid is alive");
assert.equal(guardRunsAF().length, 1, "the stub never ran a second time");
assert.equal(parseInt(readFileSync(pidFileAF, "utf8").trim(), 10), guardRunsAF()[0].pid, "pid file still names the first agent");
assert.equal(parseTask(rootAF, taskAF.file).state, "to-do", "the to-do rewrite is left alone while the agent lives");
// the agent exits: the next sweep spawns exactly one replacement and rewrites the pid file
await waitFor(() => guardRunsAF().length === 2, 30000, "single replacement after the first agent died", af.output);
assert.equal(guardRunsAF().length, 2, "exactly one replacement agent");
assert.notEqual(guardRunsAF()[1].pid, guardRunsAF()[0].pid, "the replacement is a new process");
assert.equal(parseInt(readFileSync(pidFileAF, "utf8").trim(), 10), guardRunsAF()[1].pid, "pid file names the single live agent");
af.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + double-spawn live-pid guard smoke passed");
// --- part AG: kanban task removal: the file and the mirror go in one operation ---
// reconcileBoard restores files the working tree lacks whenever the mirror tip still carries
// them, so a removal must reach the mirror itself or the task comes back (the self-heal)
const rootAG = fixture();
cleaned.push(rootAG);
mkdirSync(kanbanDir(rootAG), { recursive: true });
writeFileSync(join(kanbanDir(rootAG), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAG), pollMinutes: 0.01 }));
const taskAG = createTask(rootAG, { name: "fix: mistaken task", summary: "Removal smoke", specs: "n/a" });
const taskAG2 = createTask(rootAG, { name: "fix: keep me", summary: "Stays on the board", specs: "n/a" });

const ag = await runDaemon(rootAG);
// both tasks reach the mirror first: creates run for every file not on the mirror yet
await waitFor(() => showTip(rootAG, taskAG.file) !== null && showTip(rootAG, taskAG2.file) !== null, 30000, "both tasks mirrored", ag.output);

// removal while the daemon runs: the file leaves the tree and the mirror in one operation
assert.equal(await removeTask(rootAG, taskAG.file), null, "removal succeeds");
assert.equal(existsSync(join(kanbanDir(rootAG), taskAG.file)), false, "task file deleted");
assert.equal(showTip(rootAG, taskAG.file), null, "task gone from the mirror tip");
assert.ok(mirrorSubjects(rootAG).includes(`kanban: delete ${taskAG.file}`), "delete commit recorded on the mirror");
assert.ok(showTip(rootAG, taskAG2.file) !== null, "other task untouched on the mirror");
assert.equal(existsSync(join(kanbanDir(rootAG), taskAG2.file)), true, "other task untouched in the tree");

// the running daemon's reconcile self-heal must not restore the removed task
await new Promise((r) => setTimeout(r, 2500));
assert.equal(existsSync(join(kanbanDir(rootAG), taskAG.file)), false, "daemon sweep does not restore the removed task");

// a restart re-materializes from the mirror tip: the removal survives it too
ag.daemon.kill("SIGTERM");
await Promise.race([new Promise((r) => ag.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
const ag2 = await runDaemon(rootAG);
await new Promise((r) => setTimeout(r, 2500));
assert.equal(existsSync(join(kanbanDir(rootAG), taskAG.file)), false, "daemon restart does not restore the removed task");
ag2.daemon.kill("SIGTERM");
await Promise.race([new Promise((r) => ag2.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);

// removing the last task empties the mirror board: the tip no longer carries the file
assert.equal(await removeTask(rootAG, taskAG2.file), null, "last-task removal succeeds");
assert.equal(existsSync(join(kanbanDir(rootAG), taskAG2.file)), false, "last task file deleted");
assert.equal(showTip(rootAG, taskAG2.file), null, "last task gone from the mirror tip");
assert.ok((await removeTask(rootAG, "000999_ghost.md"))!.includes("No task"), "unknown task reported, nothing deleted");

console.log("orchestrator.test.ts: ... + task removal smoke passed");

// --- part AH: the blockedBy gate holds a task with a blocker that still blocks; a ghost ref is
// ignored; when the blocker stops blocking the daemon drops the ref and promotes in the sweep ---
const rootAH = fixture();
cleaned.push(rootAH);
mkdirSync(kanbanDir(rootAH), { recursive: true });
// 0.01min = 600ms poll; the dead stub keeps a promoted task cycling to-do/doing, so the drop
// and the promotion are asserted on the log and the task file
writeFileSync(join(kanbanDir(rootAH), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAH), pollMinutes: 0.01 }));
const taskAH0 = createTask(rootAH, { name: "feat: blocker task", summary: "BlockedBy smoke", specs: "n/a" });
const taskAH1 = createTask(rootAH, { name: "feat: blocked critical", priority: "critical", summary: "BlockedBy smoke", specs: "n/a", blockedBy: `#${parseInt(taskAH0.file, 10)}` });
const taskAH2 = createTask(rootAH, { name: "feat: ghost ref", priority: "critical", summary: "BlockedBy smoke", specs: "n/a", blockedBy: "#999" });

const ah = await runDaemon(rootAH);
const readAH = (file: string) => parseTask(rootAH, file);
// both schedulable tasks promote at once: the ghost ref resolves to no task and does not
// hold, the real ref holds the blocked critical task despite its priority
await waitFor(() => ah.output().includes(`promoting ${taskAH2.file} to to-do`), 30000, "ghost-only task promoted", ah.output);
assert.ok(ah.output().includes(`promoting ${taskAH0.file} to to-do`), "blocker task promoted in the same sweep");
assert.equal(readAH(taskAH1.file).state, "backlog", "blocked critical task not promoted despite priority");
// settle the blocker by hand: the daemon drops the done ref from the held task and promotes
// it in the same sweep
writeFileSync(
	join(kanbanDir(rootAH), taskAH0.file),
	readFileSync(join(kanbanDir(rootAH), taskAH0.file), "utf8").replace(/^state: .*/m, 'state: "done"'),
);
await waitFor(() => ah.output().includes(`promoting ${taskAH1.file} to to-do`), 30000, "blocked task promoted after the blocker is done", ah.output);
assert.notEqual(readAH(taskAH1.file).state, "backlog", "promoted task is active");
assert.equal(readAH(taskAH1.file).blockedBy, "", "satisfied blocker ref dropped from blockedBy");
assert.ok(ah.output().includes(`dropped satisfied blocker ref(s) #${parseInt(taskAH0.file, 10)}`), "ref drop logged");
assert.equal(ah.output().split("promoting ").length - 1, 3, "each schedulable task promoted exactly once");
ah.daemon.kill("SIGTERM");
// full exit before the removal: a sweep mid-flight still writes into the fixture
await Promise.race([new Promise((r) => ah.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
cleanupAll(rootAH);
console.log("orchestrator.test.ts: ... + blockedBy gate and auto-drop smoke passed");

// --- part AH2: a blocker in the live test no longer holds promotion: to-live-test and
// live-testing count as satisfied everywhere blockers are evaluated, not just done ---
const rootAH2 = fixture();
cleaned.push(rootAH2);
mkdirSync(kanbanDir(rootAH2), { recursive: true });
// the dead stub keeps the blocker cycling between to-live-test and live-testing (the spawn
// dies, the poll bounces it back), never done
writeFileSync(join(kanbanDir(rootAH2), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAH2), pollMinutes: 0.01 }));
const blockerAH2 = createTask(rootAH2, { name: "feat: live-test blocker", summary: "Blocker satisfaction smoke", specs: "n/a" });
// a branch at HEAD (merged): a worktree-less to-live-test task would route to to-merge and
// reach done through the nothing-to-merge path, so the blocker needs one to stay cycling
execSync("git branch merged-blocker", { cwd: rootAH2, shell: "/bin/bash" });
setWorktree(rootAH2, blockerAH2, "merged-blocker");
setState(rootAH2, blockerAH2, "to-live-test");
const blockedAH2 = createTask(rootAH2, { name: "feat: blocked by live test", priority: "critical", summary: "Blocker satisfaction smoke", specs: "n/a", blockedBy: `#${parseInt(blockerAH2.file, 10)}` });

const ah2 = await runDaemon(rootAH2);
// the satisfied blocker releases the dependent even though the blocker never reached done
await waitFor(() => ah2.output().includes(`promoting ${blockedAH2.file} to to-do`), 30000, "blocker in the live test released the dependent", ah2.output);
assert.ok(ah2.output().includes(`dropped satisfied blocker ref(s) #${parseInt(blockerAH2.file, 10)}`), "satisfied blocker ref dropped");
assert.notEqual(parseTask(rootAH2, blockedAH2.file).state, "backlog", "dependent promoted");
assert.equal(parseTask(rootAH2, blockedAH2.file).blockedBy, "", "ref cleared from blockedBy");
const blockerStateAH2 = parseTask(rootAH2, blockerAH2.file).state;
assert.ok(blockerStateAH2 === "to-live-test" || blockerStateAH2 === "live-testing", `blocker still in the live test (${blockerStateAH2}), never done`);
ah2.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + live-test blocker satisfaction smoke passed");

// --- part AI: a completed run clears the dead counter, so the cooldown applies to consecutive-death streaks only ---
const rootAI = fixture();
cleaned.push(rootAI);
mkdirSync(join(kanbanDir(rootAI), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootAI), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootAI), pollMinutes: 0.01 }));
const taskAI = createTask(rootAI, { name: "fix: clear dead counter", summary: "Counter clear smoke", specs: "n/a" });
setState(rootAI, taskAI, "to-do");
// a stale death streak from earlier respawns: the next completed run must clear it, else the
// cooldown would gate a fresh streak that never had six deaths
const slugAI = taskAI.file.replace(/\.md$/, "");
writeFileSync(join(kanbanDir(rootAI), ".logs", `${slugAI}.dead.count`), "3");

const ai = await runDaemon(rootAI);
await waitFor(() => ai.output().includes("cleared the dead-agent counter"), 60000, "completed run cleared the dead counter", ai.output);
assert.equal(ai.output().split("cleared the dead-agent counter").length - 1, 1, "counter clear logged once per streak");
assert.equal(readFileSync(join(kanbanDir(rootAI), ".logs", `${slugAI}.dead.count`), "utf8").trim(), "0", "the completed run cleared the death counter");
// the pipeline still completes: the cleared counter does not disturb the normal flow
await waitFor(() => parseTask(rootAI, taskAI.file).state === "done" && parseTask(rootAI, taskAI.file).worktree === "", 60000, "pipeline after the counter clear", ai.output);
assert.equal(readFileSync(join(kanbanDir(rootAI), ".logs", `${slugAI}.dead.count`), "utf8").trim(), "0", "counter stays cleared");
ai.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + dead-counter clear on completed run smoke passed");

// --- part AJ: the reviewer cap follows the task's complexity: simple advances at the default 1,
// a configured override applies, an invalid configured value warns and falls back to the default 3
const rootAJ = fixture();
cleaned.push(rootAJ);
mkdirSync(kanbanDir(rootAJ), { recursive: true });
writeFileSync(
	join(kanbanDir(rootAJ), "se-llm-team.json"),
	JSON.stringify({ agent: loopStub(rootAJ), pollMinutes: 0.01, reviewerCap: { moderate: 1, complex: -1 } }),
);
const taskAJSimple = createTask(rootAJ, { name: "fix: simple cap", summary: "Per-complexity cap smoke", specs: "n/a", complexity: "simple" });
const taskAJMod = createTask(rootAJ, { name: "fix: overridden cap", summary: "Per-complexity cap smoke", specs: "n/a" });
const taskAJComplex = createTask(rootAJ, { name: "fix: complex cap", summary: "Per-complexity cap smoke", specs: "n/a", complexity: "complex" });
for (const t of [taskAJSimple, taskAJMod, taskAJComplex]) setState(rootAJ, t, "to-review");

const aj = await runDaemon(rootAJ);
// invalid reviewerCap.complex warns at load; the cap falls back to the default 3
await waitFor(() => aj.output().includes("invalid reviewerCap.complex -1, ignored (expected an integer >= 0)"), 10000, "invalid reviewerCap warning", aj.output);
// simple: default cap 1; moderate: the configured override 1; complex: fallback to the default 3
await waitFor(() => aj.output().includes(`${taskAJSimple.file}: reviewer succeeded 1+ times, moving to to-merge`), 60000, "simple cap 1", aj.output);
await waitFor(() => aj.output().includes(`${taskAJMod.file}: reviewer succeeded 1+ times, moving to to-merge`), 60000, "configured override cap 1", aj.output);
await waitFor(() => aj.output().includes(`${taskAJComplex.file}: reviewer succeeded 3+ times, moving to to-merge`), 60000, "invalid value fell back to the default 3", aj.output);
const reviewerSpawns = (file: string) => aj.output().split("\n").filter((l) => l.includes("spawned reviewer") && l.includes(`for ${file}`)).length;
assert.equal(reviewerSpawns(taskAJSimple.file), 1, "simple task force-advanced after one successful run");
assert.equal(reviewerSpawns(taskAJMod.file), 1, "configured moderate override applied");
assert.equal(reviewerSpawns(taskAJComplex.file), 3, "invalid configured value fell back to the default 3");
aj.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + per-complexity reviewer cap smoke passed");

// --- part AJ-b: the trivial complexity: cap 0 force-advances to-review -> to-merge on the
// first sweep with no reviewer spawn (no armed marker, no pid), and reviewerCap accepts 0 while
// negative and non-integer values warn and keep the default ---
const rootAJT = fixture();
cleaned.push(rootAJT);
mkdirSync(kanbanDir(rootAJT), { recursive: true });
writeFileSync(
	join(kanbanDir(rootAJT), "se-llm-team.json"),
	JSON.stringify({ agent: loopStub(rootAJT), pollMinutes: 0.05, reviewerCap: { trivial: 0, simple: -1, moderate: 1.5 } }),
);
const taskAJT = createTask(rootAJT, { name: "fix: trivial cap", summary: "Trivial cap smoke", specs: "n/a", complexity: "trivial" });
const taskAJTMod = createTask(rootAJT, { name: "fix: moderate cap", summary: "Trivial cap smoke", specs: "n/a" });
assert.equal(parseTask(rootAJT, taskAJT.file).complexity, "trivial", "trivial round-trips through parseTask");
setState(rootAJT, taskAJT, "to-review");
setState(rootAJT, taskAJTMod, "to-review");

const ajt = await runDaemon(rootAJT);
const slugAJT = taskAJT.file.replace(/\.md$/, "");
// reviewerCap.trivial 0 is accepted; simple -1 and moderate 1.5 warn and keep the defaults
await waitFor(() => ajt.output().includes("invalid reviewerCap.simple -1, ignored (expected an integer >= 0)"), 10000, "negative reviewerCap warning", ajt.output);
await waitFor(() => ajt.output().includes("invalid reviewerCap.moderate 1.5, ignored (expected an integer >= 0)"), 10000, "non-integer reviewerCap warning", ajt.output);
assert.ok(!ajt.output().includes("invalid reviewerCap.trivial"), "reviewerCap.trivial 0 accepted without a warning");
// the trivial task advances straight to to-merge: the first sweep reads reviewer-runs 0
// >= cap 0, so no reviewer spawns
await waitFor(() => ajt.output().includes(`${taskAJT.file}: reviewer succeeded 0+ times, moving to to-merge`), 60000, "trivial forced advance", ajt.output);
assert.ok(!ajt.output().split("\n").some((l) => l.includes("spawned reviewer") && l.includes(taskAJT.file)), "no reviewer spawn for a trivial task");
assert.ok(!existsSync(join(kanbanDir(rootAJT), ".logs", `${slugAJT}.reviewer-armed`)), "no armed marker for a trivial task");
assert.ok(!existsSync(join(kanbanDir(rootAJT), ".pids", `${slugAJT}.pid`)), "no agent pid written for a trivial task");
const runsAJT = () => {
	try {
		return parseInt(readFileSync(join(kanbanDir(rootAJT), ".logs", `${slugAJT}.reviewer-runs.count`), "utf8").trim(), 10) || 0;
	} catch {
		return 0;
	}
};
assert.equal(runsAJT(), 0, "the trivial task never ran a reviewer");
// the warned values keep the default caps: the moderate task advances at the default 2
await waitFor(() => ajt.output().includes(`${taskAJTMod.file}: reviewer succeeded 2+ times, moving to to-merge`), 90000, "warned moderate keeps the default 2", ajt.output);
assert.equal(ajt.output().split("\n").filter((l) => l.includes("spawned reviewer") && l.includes(taskAJTMod.file)).length, 2, "exactly two reviewer spawns for the moderate task");
// the pipeline continues from the forced advance: the live-tester runs and the trivial task completes
await waitFor(() => parseTask(rootAJT, taskAJT.file).state === "done" && parseTask(rootAJT, taskAJT.file).worktree === "", 60000, "trivial task completes", ajt.output);
ajt.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + trivial complexity cap-0 smoke passed");
// --- part AK: a recycled pid (discriminator mismatch) reads dead; a matching one stays alive ---
// unit: pidAlive compares the discriminator when /proc is readable, so a pid reused by
// another process no longer passes the liveness check
const selfStat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
const selfStart = selfStat.slice(selfStat.lastIndexOf(")") + 2).split(" ")[19];
assert.equal(pidAlive(process.pid, selfStart), true, "matching discriminator reads alive");
assert.equal(pidAlive(process.pid, `${Number(selfStart) + 1e9}`), false, "recycled-pid discriminator reads dead");
assert.equal(pidAlive(999999, `${Number(selfStart) + 1e9}`), false, "dead pid with a discriminator reads dead");
const rootAK = fixture();
cleaned.push(rootAK);
mkdirSync(kanbanDir(rootAK), { recursive: true });
writeFileSync(join(kanbanDir(rootAK), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAK), pollMinutes: 0.01 }));
const taskAK = createTask(rootAK, { name: "fix: recycled pid", summary: "Liveness smoke", specs: "n/a" });
setState(rootAK, taskAK, "doing");
const slugAK = taskAK.file.replace(/\.md$/, "");
// the test process stays alive for the whole run, so the old kill(pid, 0) check would read
// this task alive forever; the stale discriminator makes the poll read dead and bounce it
mkdirSync(join(kanbanDir(rootAK), ".pids"), { recursive: true });
writeFileSync(join(kanbanDir(rootAK), ".pids", `${slugAK}.pid`), `${process.pid} ${Number(selfStart) + 1e9}`);
// the control: the same live pid with the matching discriminator never bounces
const taskAD2 = createTask(rootAK, { name: "fix: live pid", summary: "Liveness smoke", specs: "n/a" });
setState(rootAK, taskAD2, "doing");
writeFileSync(join(kanbanDir(rootAK), ".pids", `${taskAD2.file.replace(/\.md$/, "")}.pid`), `${process.pid} ${selfStart}`);

const ak = await runDaemon(rootAK);
await waitFor(() => ak.output().includes(`${slugAK}: agent pid=${process.pid} dead without state update, doing -> to-do`), 30000, "recycled pid bounced", ak.output);
await new Promise((res) => setTimeout(res, 2000));
assert.ok(!ak.output().includes(`${taskAD2.file.replace(/\.md$/, "")}: agent pid=`), "matching discriminator never bounced");
ak.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + recycled-pid liveness smoke passed");

// --- part AL: the merger prompt skips the suites on a clean merge and runs them only after conflicts ---
const rootAL = fixture();
cleaned.push(rootAL);
mkdirSync(kanbanDir(rootAL), { recursive: true });
// the recorder agent writes the rendered prompt out and exits without touching the task, so
// the bounce requeues it and the merge-attempted cooldown holds any second spawn: the
// recorded prompt is the first (clean-merge) merger's
const recorderAL = join(rootAL, "recorder-agent.cjs");
writeFileSync(
	recorderAL,
	`#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
writeFileSync(process.cwd() + "/merger-prompt.txt", prompt);
`,
);
chmodSync(recorderAL, 0o755);
writeFileSync(join(kanbanDir(rootAL), "se-llm-team.json"), JSON.stringify({ agent: recorderAL, pollMinutes: 0.01 }));
const taskAL = createTask(rootAL, { name: "fix: merger prompt", summary: "Prompt smoke", specs: "n/a" });
execSync("git checkout -qb feat/merger-prompt && git commit -q --allow-empty -m x && git checkout -q main", { cwd: rootAL, shell: "/bin/bash" });
setWorktree(rootAL, taskAL, "feat/merger-prompt");
setState(rootAL, taskAL, "to-merge");

const al = await runDaemon(rootAL);
await waitFor(() => existsSync(join(rootAL, "merger-prompt.txt")), 30000, "merger prompt recorded", al.output);
al.daemon.kill("SIGTERM");
const promptAL = readFileSync(join(rootAL, "merger-prompt.txt"), "utf8");
assert.ok(promptAL.includes("Merger agent"), "prompt is the merger's");
assert.ok(promptAL.includes("skip the test suites entirely"), "a clean merge skips the test suites");
assert.ok(promptAL.includes("Only when you had to resolve conflicts"), "the prompt names the conflicted branch");
assert.ok(promptAL.includes("run the project's test suites"), "conflicts still trigger the suites");
assert.ok(promptAL.includes(rootAL), "prompt placeholders are rendered, not literal");
console.log("orchestrator.test.ts: ... + merger prompt conditional smoke passed");

// --- part AM: pushMirror never blocks the sweep: the board commits land while the push hangs ---
const rootAM = fixture();
cleaned.push(rootAM);
mkdirSync(kanbanDir(rootAM), { recursive: true });
// an origin that accepts connections and never responds: the push hangs until its 30s cap
// kills it. A synchronous push would hold every sweep for 30s and the daemon would never
// finish the pipeline while it hangs
const silentOriginSockets = new Set<import("node:net").Socket>();
const silentOrigin = createNetServer((s) => silentOriginSockets.add(s));
await new Promise<void>((r) => silentOrigin.listen(0, "127.0.0.1", r));
const portAM = (silentOrigin.address() as { port: number }).port;
execSync(`git remote add origin git://127.0.0.1:${portAM}/repo.git`, { cwd: rootAM, shell: "/bin/bash" });
writeFileSync(join(kanbanDir(rootAM), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootAM), pollMinutes: 0.01 }));
const taskAM = createTask(rootAM, { name: "fix: push hang", summary: "Non-blocking push smoke", specs: "n/a" });
setState(rootAM, taskAM, "to-do");

const am = await runDaemon(rootAM);
const amClean = () => mirrorSubjects(rootAM).includes(`kanban: done ${taskAM.file}`);
await waitFor(() => parseTask(rootAM, taskAM.file).state === "done" && amClean(), 60000, "pipeline completes while the push hangs", am.output);
// the hanging push resolves at its 30s cap and the failure is still counted and logged
await waitFor(
	() => {
		try {
			return readFileSync(join(kanbanDir(rootAM), ".logs", "push-failures.count"), "utf8").trim() !== "0";
		} catch {
			return false; // count not written yet
		}
	},
	35000,
	"hanging push counted as a failure",
	am.output,
);
assert.ok(am.output().includes("push of refs/heads/meta/kanban failed (non-fatal)"), "failed push logged");
am.daemon.kill("SIGTERM");
silentOrigin.close();
for (const s of silentOriginSockets) s.destroy();
console.log("orchestrator.test.ts: ... + non-blocking push smoke passed");

// --- part AN: a live-but-silent agent (log unchanged for the stall window) is bounced, killed
// and counted. poll() runs directly with an injected clock, so the default 5-minute window is
// tested without waiting out real minutes ---
const rootAN = fixture();
cleaned.push(rootAN);
mkdirSync(join(kanbanDir(rootAN), ".logs"), { recursive: true });
mkdirSync(join(kanbanDir(rootAN), ".pids"), { recursive: true });
// a real live process behind each pid file: the stall bounce must SIGTERM it; 60s bounds the
// leak if the run dies before the cleanup below
const sleeperAN = (ms: number) => spawn(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], { stdio: "ignore" });
const sleepersAN: ChildProcess[] = [];
const stallTask = (name: string, state: string) => {
	const t = createTask(rootAN, { name, summary: "Log stall smoke", specs: "n/a" });
	setState(rootAN, t, state);
	return t;
};
const stallPidFile = (slug: string, pid: number) => {
	const p = join(kanbanDir(rootAN), ".pids", `${slug}.pid`);
	writeFileSync(p, String(pid));
	return p;
};
// task 1: doing, alive pid, a log that never grows -> stalls at the 5-minute edge
const taskAN1 = stallTask("fix: stalled agent", "doing");
const slugAN1 = taskAN1.file.replace(/\.md$/, "");
const sleeperAN1 = sleeperAN(60000);
sleepersAN.push(sleeperAN1);
const pidFileAN1 = stallPidFile(slugAN1, sleeperAN1.pid!);
writeFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN1}.developer.0.log`), "silent\n");
// task 2: doing, alive pid, a log that grows at every poll -> never stalls
const taskAN2 = stallTask("fix: growing log", "doing");
const slugAN2 = taskAN2.file.replace(/\.md$/, "");
const sleeperAN2 = sleeperAN(60000);
sleepersAN.push(sleeperAN2);
stallPidFile(slugAN2, sleeperAN2.pid!);
const logAN2 = join(kanbanDir(rootAN), ".logs", `${slugAN2}.developer.0.log`);
writeFileSync(logAN2, "run\n");
// task 3: doing, alive pid, no log file at all -> the check is skipped
const taskAN3 = stallTask("fix: no log", "doing");
const slugAN3 = taskAN3.file.replace(/\.md$/, "");
const sleeperAN3 = sleeperAN(60000);
sleepersAN.push(sleeperAN3);
stallPidFile(slugAN3, sleeperAN3.pid!);
// task 4: reviewing past RESPAWN_CAP, alive pid, a silent log -> still bounced (and killed)
const taskAN4 = stallTask("fix: stalled past cap", "reviewing");
const slugAN4 = taskAN4.file.replace(/\.md$/, "");
const sleeperAN4 = sleeperAN(60000);
sleepersAN.push(sleeperAN4);
stallPidFile(slugAN4, sleeperAN4.pid!);
writeFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN4}.dead.count`), "6");
writeFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN4}.reviewer.0.log`), "silent\n");
// task 5: merging with a live merger pid, but its old merger log is not the current merger's
// run (mergerLogSlug is null in this process): never sampled, never a false kill
const taskAN5 = stallTask("fix: stale merger task", "merging");
const slugAN5 = taskAN5.file.replace(/\.md$/, "");
const sleeperAN5 = sleeperAN(60000);
sleepersAN.push(sleeperAN5);
writeFileSync(join(kanbanDir(rootAN), ".pids", "merger.pid"), String(sleeperAN5.pid!));
writeFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN5}.merger.0.log`), "old run\n");

const t0AN = Date.now();
poll(rootAN, 5, t0AN); // first samples
// inside the window: no bounce and no kill for the unchanged logs
poll(rootAN, 5, t0AN + 60_000);
poll(rootAN, 5, t0AN + 4 * 60_000);
assert.equal(parseTask(rootAN, taskAN1.file).state, "doing", "no bounce inside the stall window");
assert.ok(pidAlive(sleeperAN1.pid!), "no kill inside the stall window");
assert.equal(parseTask(rootAN, taskAN4.file).state, "reviewing", "no bounce inside the stall window past the cap");
// at the 5-minute edge (>= 5 min unchanged): bounce one state back, kill the agent, count the death.
// The growing log grows at the same poll, so only the two silent logs stall here
appendFileSync(logAN2, "tick 5\n");
poll(rootAN, 5, t0AN + 5 * 60_000);
await waitFor(() => !pidAlive(sleeperAN1.pid!), 5000, "stalled agent killed", () => "");
assert.equal(parseTask(rootAN, taskAN1.file).state, "to-do", "stalled agent bounced doing -> to-do");
assert.ok(!existsSync(pidFileAN1), "pid file cleared on the stall bounce");
assert.equal(readFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN1}.dead.count`), "utf8").trim(), "1", "dead counter bumped on the stall bounce");
await waitFor(() => !pidAlive(sleeperAN4.pid!), 5000, "past-cap stalled agent killed", () => "");
assert.equal(parseTask(rootAN, taskAN4.file).state, "to-review", "stall bounce is unconditional past RESPAWN_CAP");
assert.equal(readFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN4}.dead.count`), "utf8").trim(), "7", "dead counter bumped past the cap");
// a log that grows at every poll resets the window and never bounces, past the window included
for (const at of [6, 7, 8]) {
	appendFileSync(logAN2, `tick ${at}\n`);
	poll(rootAN, 5, t0AN + at * 60_000);
}
assert.equal(parseTask(rootAN, taskAN2.file).state, "doing", "a growing log never bounces");
assert.ok(pidAlive(sleeperAN2.pid!), "a growing log never gets the agent killed");
// no per-run log file: no sample, no check, no bounce
assert.equal(parseTask(rootAN, taskAN3.file).state, "doing", "no log file: the stall check is skipped");
assert.ok(pidAlive(sleeperAN3.pid!), "no log file: the agent is not killed");
// the merging guard: the old merger log is never sampled while the live merger serves another task
assert.equal(parseTask(rootAN, taskAN5.file).state, "merging", "stale merging task never sampled");
assert.ok(pidAlive(sleeperAN5.pid!), "the merger working another task is not killed");
for (const s of sleepersAN) {
	try {
		s.kill("SIGKILL");
	} catch {
		/* already gone */
	}
}
console.log("orchestrator.test.ts: ... + log-stall detection smoke passed");

// --- part AO: a configured logStallMinutes applies: with a 2-minute window the same silent
// log bounces at the 2-minute edge, not before ---
const rootAO = fixture();
cleaned.push(rootAO);
mkdirSync(join(kanbanDir(rootAO), ".logs"), { recursive: true });
mkdirSync(join(kanbanDir(rootAO), ".pids"), { recursive: true });
const taskAO = createTask(rootAO, { name: "fix: stalled on the configured window", summary: "Log stall smoke", specs: "n/a" });
setState(rootAO, taskAO, "doing");
const slugAO = taskAO.file.replace(/\.md$/, "");
const sleeperAO = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
writeFileSync(join(kanbanDir(rootAO), ".pids", `${slugAO}.pid`), String(sleeperAO.pid!));
writeFileSync(join(kanbanDir(rootAO), ".logs", `${slugAO}.developer.0.log`), "silent\n");
const t0AO = Date.now();
poll(rootAO, 2, t0AO);
poll(rootAO, 2, t0AO + 60_000);
assert.equal(parseTask(rootAO, taskAO.file).state, "doing", "no bounce before the configured window");
poll(rootAO, 2, t0AO + 2 * 60_000);
await waitFor(() => !pidAlive(sleeperAO.pid!), 5000, "configured-window stalled agent killed", () => "");
assert.equal(parseTask(rootAO, taskAO.file).state, "to-do", "the configured 2-minute window bounces the stalled agent");
assert.equal(readFileSync(join(kanbanDir(rootAO), ".logs", `${slugAO}.dead.count`), "utf8").trim(), "1", "dead counter bumped on the configured-window bounce");
try {
	sleeperAO.kill("SIGKILL");
} catch {
	/* already gone */
}
console.log("orchestrator.test.ts: ... + configured logStallMinutes smoke passed");

// --- part AP: the logStallMinutes config: a missing key keeps the default 5, a configured
// value applies, an invalid value warns and keeps 5. loadConfig runs directly; the empty
// temp HOME keeps the ambient user-level config out ---
const rootAP = fixture();
cleaned.push(rootAP);
const homeAP = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAP);
mkdirSync(kanbanDir(rootAP), { recursive: true });
const savedHomeAP = process.env.HOME;
process.env.HOME = homeAP;
try {
	assert.equal(loadConfig(rootAP).logStallMinutes, 5, "a missing logStallMinutes key keeps the default 5");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ logStallMinutes: 0.05 }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 0.05, "a configured logStallMinutes applies");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ logStallMinutes: "banana" }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 5, "a non-number logStallMinutes keeps 5");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ logStallMinutes: 0 }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 5, "logStallMinutes <= 0 keeps 5");
} finally {
	process.env.HOME = savedHomeAP;
}
const orchLogAP = () => readFileSync(join(kanbanDir(rootAP), ".logs", "orchestrator.log"), "utf8");
assert.ok(orchLogAP().includes('logStallMinutes "banana" ignored: must be a positive number of minutes'), "a non-number logStallMinutes warned about");
assert.ok(orchLogAP().includes("logStallMinutes 0 ignored: must be a positive number of minutes"), "logStallMinutes <= 0 warned about");
console.log("orchestrator.test.ts: ... + logStallMinutes config smoke passed");

// --- part AQ: killing or restarting the daemon must not kill the spawned agents. The agent's
// stdout/stderr are the log file fd (a pipe read end would live in the daemon and its death
// would EPIPE the agent's next write), so the agent survives a SIGTERM stop, keeps logging,
// and the next daemon picks it up as alive from the pid file instead of spawning a twin ---
const rootAQ = fixture();
cleaned.push(rootAQ);
mkdirSync(kanbanDir(rootAQ), { recursive: true });
// a fake long-running agent: one JSONL delta line every 100ms, never exits, never touches the task
const fakeAQ = join(rootAQ, "fake-agent.cjs");
writeFileSync(
	fakeAQ,
	`#!/usr/bin/env node
setInterval(() => {
	process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: String(process.hrtime.bigint()) } }) + "\\n");
}, 100);
`,
);
chmodSync(fakeAQ, 0o755);
writeFileSync(join(kanbanDir(rootAQ), "se-llm-team.json"), JSON.stringify({ agent: fakeAQ, pollMinutes: 0.01 }));
const taskAQ = createTask(rootAQ, { name: "fix: survive restart", summary: "Restart survival smoke", specs: "n/a" });
setState(rootAQ, taskAQ, "to-do");
const slugAQ = taskAQ.file.replace(/\.md$/, "");
const logAQ = join(kanbanDir(rootAQ), ".logs", `${slugAQ}.developer.0.log`);
const pidFileAQ = join(kanbanDir(rootAQ), ".pids", `${slugAQ}.pid`);

const aq = await runDaemon(rootAQ);
await waitFor(() => existsSync(logAQ) && statSync(logAQ).size > 0, 30000, "fake agent spawned and logging", aq.output);
const agentPidAQ = parseInt(readFileSync(pidFileAQ, "utf8").trim(), 10);
assert.ok(pidAlive(agentPidAQ), "the fake agent runs");

// stop the daemon the way production does: kill <pid>
aq.daemon.kill("SIGTERM");
await Promise.race([new Promise((r) => aq.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
assert.ok(pidAlive(agentPidAQ), "the agent survived the daemon's death");
const sizeAQ = statSync(logAQ).size;
await new Promise((r) => setTimeout(r, 1500));
assert.ok(statSync(logAQ).size > sizeAQ, "the log still grows after the daemon's death");
assert.ok(pidAlive(agentPidAQ), "the agent still runs while logging");

// the restart picks the agent up as alive (pid file + liveness): no twin, the log keeps growing
const aq2 = await runDaemon(rootAQ);
await new Promise((r) => setTimeout(r, 2500));
assert.equal(aq2.output().split("spawned developer").length - 1, 0, "the new daemon spawned no twin");
assert.ok(pidAlive(agentPidAQ), "the agent survived the restart");
const size2AQ = statSync(logAQ).size;
await new Promise((r) => setTimeout(r, 1500));
assert.ok(statSync(logAQ).size > size2AQ, "the log still grows after the restart");
assert.equal(parseTask(rootAQ, taskAQ.file).state, "doing", "the in-flight state survived the restart");
aq2.daemon.kill("SIGTERM");
try {
	process.kill(agentPidAQ, "SIGKILL");
} catch {
	/* already gone */
}
console.log("orchestrator.test.ts: ... + daemon-restart survival smoke passed");

// --- part AR: promotion re-checks its gates on a fresh board read just before setState ---
// the sweep's snapshot can be tens of seconds old (a slow state loop): an edit that lands
// mid-sweep must win, or a done task restarts and a gated task starts ungated
const rootAR = fixture();
cleaned.push(rootAR);
mkdirSync(kanbanDir(rootAR), { recursive: true });
const victimDoneAR = createTask(rootAR, { name: "feat: cancelled mid-sweep", summary: "Fresh-read gates", specs: "n/a" });
const victimQuestionsAR = createTask(rootAR, { name: "feat: questions mid-sweep", summary: "Fresh-read gates", specs: "n/a" });
const victimBlockedAR = createTask(rootAR, { name: "feat: blocked mid-sweep", summary: "Fresh-read gates", specs: "n/a" });
const blockerAR = createTask(rootAR, { name: "feat: fresh blocker", summary: "Fresh-read gates", specs: "n/a" });
const snapshotAR = listAll(rootAR);
// the edits land after the snapshot, before the promotion pass
setState(rootAR, victimDoneAR, "done");
updateTask(rootAR, victimQuestionsAR, { openQuestions: "- [user] Which API?" });
updateTask(rootAR, victimBlockedAR, { blockedBy: `#${parseInt(blockerAR.file, 10)}` });
promoteBacklog(rootAR, snapshotAR);
assert.equal(parseTask(rootAR, victimDoneAR.file).state, "done", "a mid-sweep done rewrite is not promoted back to to-do");
assert.equal(parseTask(rootAR, victimQuestionsAR.file).state, "backlog", "open questions added mid-sweep hold promotion");
assert.equal(parseTask(rootAR, victimQuestionsAR.file).openQuestions, "- [user] Which API?", "the mid-sweep open question survived the promotion pass");
assert.equal(parseTask(rootAR, victimBlockedAR.file).state, "backlog", "a blockedBy ref added mid-sweep holds promotion");
assert.ok(parseTask(rootAR, victimBlockedAR.file).blockedBy.includes(`#${parseInt(blockerAR.file, 10)}`), "the mid-sweep blockedBy ref survived the promotion pass");
// a candidate the gates pass on both reads still promotes
const cleanAR = createTask(rootAR, { name: "feat: clean promote", summary: "Fresh-read gates", specs: "n/a" });
promoteBacklog(rootAR, listAll(rootAR));
assert.equal(parseTask(rootAR, cleanAR.file).state, "to-do", "an unchanged candidate still promotes");
// dropDoneBlockers re-reads the task before the write: a ref the PM added mid-sweep survives
// the drop, and a ref the PM removed mid-sweep stays removed
const doneBlockerAR = createTask(rootAR, { name: "feat: done blocker", summary: "Fresh-read gates", specs: "n/a" });
setState(rootAR, doneBlockerAR, "done");
const doneNumAR = `#${parseInt(doneBlockerAR.file, 10)}`;
const otherBlockerAR = createTask(rootAR, { name: "feat: live blocker", summary: "Fresh-read gates", specs: "n/a" });
const otherNumAR = `#${parseInt(otherBlockerAR.file, 10)}`;
const refHolderAR = createTask(rootAR, { name: "feat: ref holder", summary: "Fresh-read gates", specs: "n/a", blockedBy: doneNumAR });
const refRemoverAR = createTask(rootAR, { name: "feat: ref remover", summary: "Fresh-read gates", specs: "n/a", blockedBy: `${doneNumAR}, ${otherNumAR}` });
const dropSnapshotAR = listAll(rootAR);
// the edits land after the snapshot, before the drop pass
updateTask(rootAR, refHolderAR, { blockedBy: `${doneNumAR}, ${otherNumAR}` });
updateTask(rootAR, refRemoverAR, { blockedBy: otherNumAR });
dropDoneBlockers(rootAR, dropSnapshotAR);
assert.equal(parseTask(rootAR, refHolderAR.file).blockedBy, otherNumAR, "the mid-sweep added ref survives the done-ref drop");
assert.equal(parseTask(rootAR, refHolderAR.file).blockedBy.includes(doneNumAR), false, "the done ref itself is still dropped");
assert.equal(parseTask(rootAR, refRemoverAR.file).blockedBy, otherNumAR, "the mid-sweep removed ref stays removed");
cleanupAll(rootAR);
console.log("orchestrator.test.ts: ... + fresh-read promotion gates smoke passed");

// --- part AS: per-role project notes in .kanban, appended to the system prompt at spawn ---
// every spawn carries --append-system-prompt <root>/.kanban/AGENTS.<role>.md, the daemon
// creates the file when missing, the notes files are not tasks (promoteBacklog cannot turn
// one into a phantom developer run) and ride the board mirror's snapshot commits
const rootAS = fixture();
cleaned.push(rootAS);
// an empty temp HOME keeps the ambient user-level config out of loadConfig, as in part X
const homeAS = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAS);
mkdirSync(kanbanDir(rootAS), { recursive: true });
writeFileSync(join(kanbanDir(rootAS), "se-llm-team.json"), JSON.stringify({ agent: argvStub(rootAS), pollMinutes: 0.01 }));
// a bare AGENTS.md in .kanban (the pi context-file name a user might try here) is board noise
// too: no frontmatter, so without the filter it parses as a phantom backlog task and promotes
writeFileSync(join(kanbanDir(rootAS), "AGENTS.md"), "# notes\n");
const taskAS = createTask(rootAS, { name: "feat: role notes", summary: "Role notes smoke", specs: "n/a" });
setState(rootAS, taskAS, "to-do");
const as = await runDaemon(rootAS, join(HERE, "orchestrator.ts"), homeAS);
await waitFor(
	() => parseTask(rootAS, taskAS.file).state === "done" && parseTask(rootAS, taskAS.file).worktree === "",
	60000,
	"pipeline with role notes",
	as.output,
);
const notesPathAS = (role: string) => join(kanbanDir(rootAS), `AGENTS.${role}.md`);
const asSpawns = () =>
	readFileSync(join(rootAS, "argv.log"), "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as { role: string; argv: string[] });
for (const role of ["developer", "reviewer", "merger", "live-tester"]) {
	const path = notesPathAS(role);
	assert.ok(existsSync(path), `the ${role} notes file was created when missing`);
	assert.ok(readFileSync(path, "utf8").includes(`# ${role}:`), "the starter header names the role");
	const spawns = asSpawns().filter((s) => s.role === role);
	assert.ok(spawns.length > 0, `the ${role} ran`);
	for (const s of spawns) {
		const i = s.argv.indexOf("--append-system-prompt");
		assert.ok(i !== -1, `every ${role} spawn carries --append-system-prompt`);
		assert.equal(s.argv[i + 1], path, "the flag points at the role's notes file");
	}
}
assert.ok(!listAll(rootAS).some((t) => ROLE_NOTES_RE.test(t.file)), "role notes files are not tasks");
assert.ok(!readFileSync(join(kanbanDir(rootAS), "AGENTS.md"), "utf8").match(/^state: /m), "a bare AGENTS.md never parses as a task");
for (const role of ["developer", "reviewer", "merger", "live-tester"]) {
	assert.ok(showTip(rootAS, `AGENTS.${role}.md`) !== null, `the board mirror carries the ${role} notes file`);
}
as.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + per-role project notes smoke passed");
