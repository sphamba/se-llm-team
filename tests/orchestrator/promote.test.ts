import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createTask, kanbanDir, listAll, parseTask, setState, setWorktree, taskNum, taskSlug, updateTask } from "../../src/kanban.ts";
import { reportsDir } from "../../src/orchestrator/report.ts";
import { dropDoneBlockers, loadConfig, poll, promoteBacklog } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import { pidPath } from "../../src/pid.ts";
import { fixture, roleStub, deadStub, runDaemon, waitFor, runIdx, cleanupAll, cleaned } from "../helpers.ts";

// --- part R: promotion is event-driven: every schedulable backlog task promotes on the
// sweep, in parallel lanes, even while other tasks run; open questions hold a task ---
const rootR = fixture();
cleaned.push(rootR);
mkdirSync(kanbanDir(rootR), { recursive: true });
// the working stub completes every promoted task, so the board is never idle: promotion
// must not wait for idle (the old failsafe did)
writeFileSync(join(kanbanDir(rootR), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootR), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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

// --- part AA: the reviewer successful-run cap: for the default moderate complexity, 2
// successful runs, the 3rd spawn is refused ---
// a reviewer run is successful when it sets the task state itself (back to to-review after
// changes, or forward to to-merge on approval); died runs go through the dead counter
const loopStub = (root: string) => {
	const stub = join(root, "loop-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync, existsSync, readlinkSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
// the task comes from the cwd SPECS.md symlink, which the orchestrator re-points at spawn
const file = "SPECS.md";
let front = "";
let taskFile = "";
try {
	front = readFileSync(file, "utf8");
	taskFile = readlinkSync(file); // ".kanban/<taskFile>", the real task file through the board
} catch {}
if (!front.match(/^state: /m)) process.exit(0);
const isReviewer = prompt.includes("Reviewer agent");
// a reviewer must not outrun the daemon's bookkeeping: it waits for the post-spawn armed
// marker (the daemon took over), writes its state, then waits for the next sweep to consume
// the marker with the pidfile still matching (the run was counted). Exiting earlier lets a
// poll tick clear the pidfile between the exit and that sweep, so consumeReviewerRun drops
// the run uncounted and one spawn past the cap happens
const armed = () => join(dirname(taskFile), ".logs", basename(taskFile, ".md") + ".reviewer-armed");
const waitUntil = (cond, ms) => {
	const end = Date.now() + ms;
	while (!cond() && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
};
if (isReviewer) waitUntil(() => existsSync(armed()), 10000);
// only the reviewer sets a state itself (back to to-review for another run); the developer
// and the live-tester just finish and the orchestrator moves the task on their exit 0
if (isReviewer) writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: to-review"));
if (isReviewer) waitUntil(() => !existsSync(armed()), 10000);
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

const rootAA = fixture();
cleaned.push(rootAA);
mkdirSync(kanbanDir(rootAA), { recursive: true });
writeFileSync(join(kanbanDir(rootAA), "se-llm-team.json"), JSON.stringify({ agent: loopStub(rootAA), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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

// --- part AA2: a to-do arrival starts a fresh review streak: a stale reviewer-runs count on
// a to-do task resets, so the next to-review arrival gets a real reviewer spawn instead of
// the stale-count force-merge ---
const rootAA2 = fixture();
cleaned.push(rootAA2);
mkdirSync(kanbanDir(rootAA2), { recursive: true });
writeFileSync(join(kanbanDir(rootAA2), "se-llm-team.json"), JSON.stringify({ agent: loopStub(rootAA2), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskAA2 = createTask(rootAA2, { name: "fix: re-entered to-do", summary: "Review counter reset smoke", specs: "n/a", complexity: "simple" });
setState(rootAA2, taskAA2, "to-do");
const slugAA2 = taskAA2.file.replace(/\.md$/, "");
// a stale streak at the simple cap 1: without the reset the first to-review arrival force-merges
mkdirSync(join(kanbanDir(rootAA2), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootAA2), ".logs", `${slugAA2}.reviewer-runs.count`), "1");
const aa2 = await runDaemon(rootAA2);
await waitFor(() => parseTask(rootAA2, taskAA2.file).state === "done", 90000, "re-entered task completed", aa2.output);
assert.ok(aa2.output().includes(`${taskAA2.file}: back in to-do, review counter reset`), "to-do arrival resets the streak with one log line");
assert.equal(
	aa2.output().split("\n").filter((l) => l.includes("spawned reviewer") && l.includes(taskAA2.file)).length,
	1,
	"the re-entered task got a real reviewer spawn, not the stale-count force-merge",
);
aa2.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + to-do re-entry review counter reset smoke passed");

// --- part AA3: a reviewer bounce to to-do respawns the developer on the existing worktree and
// branch: the to-do arrival runs startTodo, ensureWorktree reuses the ensured worktree (no
// re-checkout), and the pipeline completes through the second reviewer's approval ---
const rootAA3 = fixture();
cleaned.push(rootAA3);
mkdirSync(kanbanDir(rootAA3), { recursive: true });
// stub: the developer drops an untracked marker into its worktree (no commit), the reviewer
// bounces the task to to-do on its first run and approves on the second; the approve run
// snapshots the untracked marker outside the worktree: only a reused worktree carries the
// first developer's untracked file plus the second one's append into that snapshot (a
// re-checkout would lose the untracked file)
const bounceStub = join(rootAA3, "bounce-agent.cjs");
writeFileSync(
	bounceStub,
	`#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = "SPECS.md";
let front = "";
try { front = readFileSync(file, "utf8"); } catch {}
if (!front.match(/^state: /m)) process.exit(0);
if (prompt.includes("Reviewer agent")) {
	if (!existsSync(".bounced")) {
		writeFileSync(".bounced", "1");
		writeFileSync(file, front.replace(/^state: .*/m, 'state: "to-do"'));
	} else {
		appendFileSync(${JSON.stringify(join(rootAA3, "marker-snapshot.txt"))}, readFileSync(".marker", "utf8"));
		writeFileSync(file, front.replace(/^state: .*/m, 'state: "to-merge"'));
	}
	process.exit(0);
}
if (prompt.includes("Developer agent")) appendFileSync(".marker", "dev\\n");
`,
);
chmodSync(bounceStub, 0o755);
writeFileSync(join(kanbanDir(rootAA3), "se-llm-team.json"), JSON.stringify({ agent: bounceStub, pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskAA3 = createTask(rootAA3, { name: "feat: bounce back", summary: "Reviewer bounce respawn smoke", specs: "n/a", complexity: "simple" });
setState(rootAA3, taskAA3, "to-do");
const aa3 = await runDaemon(rootAA3);
await waitFor(() => parseTask(rootAA3, taskAA3.file).state === "done", 90000, "the bounced task completed on its reused worktree", aa3.output);
assert.equal(aa3.output().split("spawned developer").length - 1, 2, "the developer respawned after the reviewer bounce");
const wtAA3 = `feat/${parseInt(taskAA3.file, 10)}-bounce-back`;
for (const line of aa3.output().split("\n").filter((l) => l.includes("spawned developer") && l.includes(taskAA3.file))) {
	assert.ok(line.includes(`(cwd=${join(rootAA3, ".worktrees", wtAA3)})`), "each developer run used the task's worktree dir");
}
assert.equal(readFileSync(join(rootAA3, "marker-snapshot.txt"), "utf8"), "dev\ndev\n", "the approve-time snapshot holds both developers' markers: the worktree was reused, not recreated");
await waitFor(() => aa3.output().includes(`merged ${wtAA3} for ${taskAA3.file}`), 15000, "the reused branch carried the task through the merge", aa3.output);
aa3.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + reviewer to-do bounce respawn smoke passed");

// --- part AH: the blockedBy gate holds a task with a blocker that still blocks; a ghost ref is
// ignored; when the blocker stops blocking the daemon drops the ref and promotes in the sweep ---
const rootAH = fixture();
cleaned.push(rootAH);
mkdirSync(kanbanDir(rootAH), { recursive: true });
// 0.01min = 600ms poll; the dead stub keeps a promoted task cycling to-do/doing, so the drop
// and the promotion are asserted on the log and the task file
writeFileSync(join(kanbanDir(rootAH), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAH), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
writeFileSync(join(kanbanDir(rootAH2), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAH2), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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

// --- part AJ: the reviewer cap follows the task's complexity: simple advances at the default 1,
// a configured override applies, an invalid configured value warns and falls back to the default 3
const rootAJ = fixture();
cleaned.push(rootAJ);
mkdirSync(kanbanDir(rootAJ), { recursive: true });
writeFileSync(
	join(kanbanDir(rootAJ), "se-llm-team.json"),
	JSON.stringify({ agent: loopStub(rootAJ), pollMinutes: 0.01, backlogIdleMinutes: 0, reviewerCap: { moderate: 1, complex: -1 } }),
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
	JSON.stringify({ agent: loopStub(rootAJT), pollMinutes: 0.05, backlogIdleMinutes: 0, reviewerCap: { trivial: 0, simple: -1, moderate: 1.5 } }),
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

// --- part AR2: the board-wide backlog idle gate (backlogIdleMinutes): any fresh task-file
// mtime defers all promotion until the board sits idle; 0 disables the wait ---
const rootAR2 = fixture();
cleaned.push(rootAR2);
mkdirSync(kanbanDir(rootAR2), { recursive: true });
const gatedAR2 = createTask(rootAR2, { name: "feat: gated task", summary: "Backlog idle gate", specs: "n/a" });
// a 5 min window: no test-runner stall can age the freshly written task file past it, so
// promotion defers (#305, #307: a 3 s window lost this race under load). The mtime is pinned
// 1 s back: the gate skips a sub-millisecond mtime above its floored Date.now() (clock-skew
// guard, part BC), so a file written in the current millisecond would read as future and open
// the gate
const freshAR2 = new Date(Date.now() - 1_000);
utimesSync(join(kanbanDir(rootAR2), gatedAR2.file), freshAR2, freshAR2);
assert.equal(promoteBacklog(rootAR2, listAll(rootAR2), 5).length, 0, "a fresh task file defers promotion within the window");
assert.equal(parseTask(rootAR2, gatedAR2.file).state, "backlog", "the gated task stays in backlog");
// aging the task file past the window: promotion fires (5 min < 10 min)
const agedAR2 = new Date(Date.now() - 600_000);
utimesSync(join(kanbanDir(rootAR2), gatedAR2.file), agedAR2, agedAR2);
assert.equal(promoteBacklog(rootAR2, listAll(rootAR2), 5).length, 1, "the aged task promotes past the window");
assert.equal(parseTask(rootAR2, gatedAR2.file).state, "to-do", "the gated task promoted after the window");
// a window of 0 disables the wait: a just-created task promotes immediately
const nowAR2 = createTask(rootAR2, { name: "feat: zero-window task", summary: "Backlog idle gate", specs: "n/a" });
assert.equal(promoteBacklog(rootAR2, listAll(rootAR2), 0).length, 1, "a window of 0 promotes immediately");
assert.equal(parseTask(rootAR2, nowAR2.file).state, "to-do", "the zero-window task promoted");
// the daemon's own writes are not board activity (211): a setState rewrite (a state transition,
// a blocker drop) must not re-arm the gate, or every done move defers its dependents by a window
setState(rootAR2, nowAR2, "backlog");
assert.equal(promoteBacklog(rootAR2, listAll(rootAR2), 5).length, 1, "a self-write does not re-arm the gate");
assert.equal(parseTask(rootAR2, nowAR2.file).state, "to-do", "the task with only self-written files promoted");
cleanupAll(rootAR2);
console.log("orchestrator.test.ts: ... + backlog idle gate smoke passed");

// --- part AR3 (#212): the idle gate ignores role notes. AGENTS.<role>.md is written by the
// daemon's own ensureRoleNotes at the first agent spawn, so a fresh note must not count as
// board activity and defer every backlog promotion for another window ---
const rootAR3 = fixture();
cleaned.push(rootAR3);
mkdirSync(kanbanDir(rootAR3), { recursive: true });
const gatedAR3 = createTask(rootAR3, { name: "feat: aged behind a role note", summary: "Role notes are not activity", specs: "n/a" });
const agedAR3 = new Date(Date.now() - 600_000);
utimesSync(join(kanbanDir(rootAR3), gatedAR3.file), agedAR3, agedAR3);
writeFileSync(join(kanbanDir(rootAR3), "AGENTS.developer.md"), "# developer:\n");
assert.equal(promoteBacklog(rootAR3, listAll(rootAR3), 5).length, 1, "a fresh role note does not defer promotion");
assert.equal(parseTask(rootAR3, gatedAR3.file).state, "to-do", "the aged task promoted despite the fresh role note");
// a fresh real task file beside the same role note still defers: the gate skips notes only
const freshAR3 = createTask(rootAR3, { name: "feat: fresh beside a role note", summary: "Role notes are not activity", specs: "n/a" });
// pinned just back from now, as in part AR2: a same-millisecond mtime would read as future
const freshAtAR3 = new Date(Date.now() - 1_000);
utimesSync(join(kanbanDir(rootAR3), freshAR3.file), freshAtAR3, freshAtAR3);
assert.equal(promoteBacklog(rootAR3, listAll(rootAR3), 5).length, 0, "a fresh task file still defers promotion within the window");
assert.equal(parseTask(rootAR3, freshAR3.file).state, "backlog", "the fresh task stays gated");
cleanupAll(rootAR3);
console.log("orchestrator.test.ts: ... + role notes are not idle-gate activity smoke passed");
// --- part AR4: the gate ignores the daemon's own writes (#211): with a real sweep and a
// nonzero window, a blocker reaching done still promotes its dependents in the same sweep
// and the sweep's report lists them under Scheduled; a genuinely external (PM) board edit
// still defers promotion for the window ---
const rootAR4 = fixture();
cleaned.push(rootAR4);
mkdirSync(kanbanDir(rootAR4), { recursive: true });
writeFileSync(join(kanbanDir(rootAR4), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAR4), pollMinutes: 0.01, backlogIdleMinutes: 5 }));
// an empty temp HOME keeps the ambient user-level config out of loadConfig, as in part AP
const homeAR4 = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAR4);
const savedHomeAR4 = process.env.HOME;
process.env.HOME = homeAR4;
const cfgAR4 = loadConfig(rootAR4);
process.env.HOME = savedHomeAR4;
assert.equal(cfgAR4.backlogIdleMinutes, 5, "the fixture config carries the nonzero window");
// the #197 fixture: a to-merge task with nothing to merge (no worktree, no branch) plus a
// dependent backlog task; sweepToMerge sets the blocker done and dropDoneBlockers drops the
// dependent's satisfied ref in the same sweep
const blockerAR4 = createTask(rootAR4, { name: "fix: merged task", summary: "Merged", specs: "n/a" });
setState(rootAR4, blockerAR4, "to-merge");
const dependentAR4 = createTask(rootAR4, { name: "feat: unblocked next", summary: "Unblocked", specs: "n/a", blockedBy: `#${taskNum(blockerAR4.file)}` });
// the setup writes are PM writes: age them past the window, so the only fresh mtimes the
// sweep leaves behind are the daemon's own (5 min < 10 min)
const agedAR4 = new Date(Date.now() - 600_000);
for (const f of [blockerAR4.file, dependentAR4.file]) utimesSync(join(kanbanDir(rootAR4), f), agedAR4, agedAR4);
rescan(rootAR4, cfgAR4);
assert.equal(parseTask(rootAR4, blockerAR4.file).state, "done", "the to-merge task with nothing to merge went done");
assert.equal(parseTask(rootAR4, dependentAR4.file).state, "to-do", "the dependent promoted in the same sweep despite the daemon's own writes");
assert.equal(parseTask(rootAR4, dependentAR4.file).blockedBy, "", "the satisfied blocker ref was dropped");
const reportsAR4 = readdirSync(reportsDir(rootAR4)).filter((f) => f.endsWith(".md")).sort();
assert.equal(reportsAR4.length, 1, "one report for the done sweep");
const reportAR4 = readFileSync(join(reportsDir(rootAR4), reportsAR4[0]), "utf8");
assert.ok(reportAR4.includes(`- ${dependentAR4.name} (${dependentAR4.file}): to-do`), "the report lists the same-sweep promotion under Scheduled");
// a genuinely external (PM) board edit still defers promotion: a raw write, as a hand edit
// or another process would make it, re-arms the gate
const candidateAR4 = createTask(rootAR4, { name: "feat: gated next", summary: "Gated", specs: "n/a" });
const agedCandidateAR4 = new Date(Date.now() - 600_000);
utimesSync(join(kanbanDir(rootAR4), candidateAR4.file), agedCandidateAR4, agedCandidateAR4);
writeFileSync(join(kanbanDir(rootAR4), candidateAR4.file), readFileSync(join(kanbanDir(rootAR4), candidateAR4.file), "utf8").replace("# Notes\n", "# Notes\n\nPM note.\n"));
// pinned just back from now, as in part AR2: a same-millisecond mtime would read as future
const freshAtAR4 = new Date(Date.now() - 1_000);
utimesSync(join(kanbanDir(rootAR4), candidateAR4.file), freshAtAR4, freshAtAR4);
assert.equal(promoteBacklog(rootAR4, listAll(rootAR4), 5).length, 0, "an external PM edit defers promotion within the window");
assert.equal(parseTask(rootAR4, candidateAR4.file).state, "backlog", "the externally edited task stays in backlog");
// aged past the window, the poll path promotes too (the gate's second call site)
const agedAgainAR4 = new Date(Date.now() - 600_000);
utimesSync(join(kanbanDir(rootAR4), candidateAR4.file), agedAgainAR4, agedAgainAR4);
poll(rootAR4, cfgAR4.logStallMinutes, Date.now(), cfgAR4.backlogIdleMinutes);
assert.equal(parseTask(rootAR4, candidateAR4.file).state, "to-do", "the poll path promotes past the window");
cleanupAll(rootAR4);
console.log("orchestrator.test.ts: ... + gate ignores the daemon's own writes smoke passed");

// --- part AW: 000197 a done move the sweep itself makes unblocks the dependent in the same
// sweep. The state loop lands the done move (to-merge with nothing to merge): blocker
// decisions from the pre-loop snapshot would defer the drop and the promotion one sweep, and
// the promotion would ride no report (a sweep without a done transition queues none) ---
const rootAW = fixture();
cleaned.push(rootAW);
const homeAW = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAW);
mkdirSync(kanbanDir(rootAW), { recursive: true });
// the new board-wide gate off: the promotion this part asserts must not wait out a window
writeFileSync(join(kanbanDir(rootAW), "se-llm-team.json"), JSON.stringify({ backlogIdleMinutes: 0 }));
const savedHomeAW = process.env.HOME;
process.env.HOME = homeAW;
let cfgAW: ReturnType<typeof loadConfig>;
try {
	cfgAW = loadConfig(rootAW);
} finally {
	process.env.HOME = savedHomeAW;
}
const blockerAW = createTask(rootAW, { name: "feat: same-sweep blocker", summary: "Same-sweep unblock", specs: "n/a" });
setState(rootAW, blockerAW, "to-merge"); // no worktree: nothing to merge, the sweep sets done
const dependentAW = createTask(rootAW, { name: "feat: same-sweep dependent", summary: "Same-sweep unblock", specs: "n/a", blockedBy: `#${taskNum(blockerAW.file)}` });
const plainAW = createTask(rootAW, { name: "feat: same-sweep plain", summary: "Same-sweep unblock", specs: "n/a" });
rescan(rootAW, cfgAW);
assert.equal(parseTask(rootAW, blockerAW.file).state, "done", "nothing to merge: the sweep set the blocker done");
assert.equal(parseTask(rootAW, dependentAW.file).state, "to-do", "the dependent promoted in the same sweep as the done move");
assert.equal(parseTask(rootAW, dependentAW.file).blockedBy, "", "the satisfied blocker ref dropped in the same sweep");
assert.equal(parseTask(rootAW, plainAW.file).state, "to-do", "the already-unblocked task promoted as usual");
const reportsAW = readdirSync(reportsDir(rootAW)).filter((f) => f.endsWith(".md")).sort();
assert.equal(reportsAW.length, 1, "the sweep queued one report");
const reportAW = readFileSync(join(reportsDir(rootAW), reportsAW[0]), "utf8");
assert.ok(reportAW.includes(blockerAW.name), "the report's Done section names the blocker");
assert.ok(reportAW.includes(dependentAW.name), "the report's Scheduled section names the same-sweep promotion");
cleanupAll(rootAW);
console.log("orchestrator.test.ts: ... + same-sweep unblock smoke passed");

// --- part AX: maxParallel caps the reviewer spawn: at the cap a to-review task stays in
// to-review, below the cap it starts. Direct-drive rescan (part AW harness): the slot
// holders are reviewing/merging tasks the rescan loop never touches, poll is not driven ---
const rootAX = fixture();
cleaned.push(rootAX);
const homeAX = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAX);
mkdirSync(kanbanDir(rootAX), { recursive: true });
const savedHomeAX = process.env.HOME;
process.env.HOME = homeAX;
let cfgAX: ReturnType<typeof loadConfig>;
try {
	cfgAX = loadConfig(rootAX);
} finally {
	process.env.HOME = savedHomeAX;
}
cfgAX.backlogIdleMinutes = 0;
cfgAX.maxParallel = 2;
cfgAX.agent = deadStub(rootAX);
const holderAX = createTask(rootAX, { name: "fix: reviewing slot", summary: "MaxParallel smoke", specs: "n/a" });
setState(rootAX, holderAX, "reviewing");
const holderAX2 = createTask(rootAX, { name: "fix: merging slot", summary: "MaxParallel smoke", specs: "n/a" });
setState(rootAX, holderAX2, "merging");
const taskAX = createTask(rootAX, { name: "feat: capped review", summary: "MaxParallel smoke", specs: "n/a" });
setState(rootAX, taskAX, "to-review");
rescan(rootAX, cfgAX);
assert.equal(parseTask(rootAX, taskAX.file).state, "to-review", "at the cap the to-review task stays in to-review");
assert.ok(!existsSync(pidPath(rootAX, taskSlug(taskAX.file))), "at the cap no reviewer spawned");
setState(rootAX, holderAX2, "done");
rescan(rootAX, cfgAX);
assert.equal(parseTask(rootAX, taskAX.file).state, "reviewing", "below the cap the reviewer spawned");
assert.ok(existsSync(pidPath(rootAX, taskSlug(taskAX.file))), "below the cap the reviewer pid file exists");
cleanupAll(rootAX);
console.log("orchestrator.test.ts: ... + maxParallel reviewer cap smoke passed");

// --- part AY: backlog promotion is not gated by maxParallel: a ready backlog task promotes
// to to-do while the cap holds and queues there instead of starting ---
const rootAY = fixture();
cleaned.push(rootAY);
const homeAY = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAY);
mkdirSync(kanbanDir(rootAY), { recursive: true });
const savedHomeAY = process.env.HOME;
process.env.HOME = homeAY;
let cfgAY: ReturnType<typeof loadConfig>;
try {
	cfgAY = loadConfig(rootAY);
} finally {
	process.env.HOME = savedHomeAY;
}
cfgAY.backlogIdleMinutes = 0;
cfgAY.maxParallel = 1;
cfgAY.agent = deadStub(rootAY);
const holderAY = createTask(rootAY, { name: "fix: working slot", summary: "MaxParallel smoke", specs: "n/a" });
setState(rootAY, holderAY, "doing");
const queuedAY = createTask(rootAY, { name: "feat: queued next", summary: "MaxParallel smoke", specs: "n/a", complexity: "simple" });
rescan(rootAY, cfgAY);
assert.equal(parseTask(rootAY, queuedAY.file).state, "to-do", "the ready backlog task promoted despite the cap");
assert.ok(!existsSync(pidPath(rootAY, taskSlug(queuedAY.file))), "the promoted task did not start under the cap");
rescan(rootAY, cfgAY);
assert.equal(parseTask(rootAY, queuedAY.file).state, "to-do", "the queued task stays to-do while the cap holds");
cleanupAll(rootAY);
console.log("orchestrator.test.ts: ... + maxParallel backlog queue smoke passed");

// --- part AZ (295): a poke-forced sweep bypasses the board-wide quiet gate, a plain sweep
// keeps it, and the deferral logs once per episode, not once per sweep ---
const rootAZ = fixture();
cleaned.push(rootAZ);
const homeAZ = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAZ);
mkdirSync(kanbanDir(rootAZ), { recursive: true });
const savedHomeAZ = process.env.HOME;
process.env.HOME = homeAZ;
let cfgAZ: ReturnType<typeof loadConfig>;
try {
	cfgAZ = loadConfig(rootAZ);
} finally {
	process.env.HOME = savedHomeAZ;
}
cfgAZ.backlogIdleMinutes = 1;
cfgAZ.agent = deadStub(rootAZ);
const gatedAZ = createTask(rootAZ, { name: "feat: poked task", summary: "Poke forces promotion", specs: "n/a" });
const orchLogAZ = () => readFileSync(join(kanbanDir(rootAZ), ".logs", "orchestrator.log"), "utf8");
rescan(rootAZ, cfgAZ);
assert.equal(parseTask(rootAZ, gatedAZ.file).state, "backlog", "a plain sweep after the fresh PM write defers");
assert.match(orchLogAZ(), new RegExp(`promotion deferred, newest task write \\d+s ago \\(${gatedAZ.file}\\)`), "the deferral log names the newest task file and its age");
rescan(rootAZ, cfgAZ);
assert.equal(orchLogAZ().split("promotion deferred").length - 1, 1, "the deferral logs once per episode, not once per sweep");
rescan(rootAZ, cfgAZ, true);
assert.equal(parseTask(rootAZ, gatedAZ.file).state, "to-do", "the forced sweep promotes past the window");
assert.ok(orchLogAZ().includes(`promoting ${gatedAZ.file} to to-do`), "the forced promotion logs");
// the gate opening ends the episode: a fresh PM write after it logs a new deferral
const secondAZ = createTask(rootAZ, { name: "feat: poked task two", summary: "Poke forces promotion", specs: "n/a" });
rescan(rootAZ, cfgAZ);
assert.equal(parseTask(rootAZ, secondAZ.file).state, "backlog", "the new fresh write defers again");
assert.equal(orchLogAZ().split("promotion deferred").length - 1, 2, "the second episode logs its own deferral");
cleanupAll(rootAZ);
console.log("orchestrator.test.ts: ... + poke-forced promotion past the quiet gate smoke passed");

// --- part BA (295): daemon path: a PM create followed by a poke promotes in seconds, not
// after the whole one minute gate window the sweep timer would wait out ---
const rootBA = fixture();
cleaned.push(rootBA);
mkdirSync(kanbanDir(rootBA), { recursive: true });
writeFileSync(join(kanbanDir(rootBA), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootBA), pollMinutes: 0.01, backlogIdleMinutes: 1 }));
const pokedBA = createTask(rootBA, { name: "feat: poked from the daemon", summary: "Poke forces promotion", specs: "n/a" });
const ba = await runDaemon(rootBA);
await waitFor(() => ba.output().includes("promotion deferred"), 30000, "the daemon defers the fresh PM write", ba.output);
// the poke exactly as orchestrator_poke makes it: rm then create, so fs.watch fires
const pokeBA = join(kanbanDir(rootBA), ".poke");
try {
	unlinkSync(pokeBA);
} catch {
	/* first poke */
}
closeSync(openSync(pokeBA, "a"));
const pokedAtBA = Date.now();
await waitFor(() => ba.output().includes(`promoting ${pokedBA.file} to to-do`), 20000, "the poke forces the promotion", ba.output);
assert.ok(Date.now() - pokedAtBA < 30_000, "the poke promoted well inside the one minute gate window");
assert.equal(ba.output().split("promotion deferred").length - 1, 1, "the deferral logged once for the episode, not per one second sweep");
assert.notEqual(parseTask(rootBA, pokedBA.file).state, "backlog", "the poked task left backlog");
ba.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + daemon poke-forced promotion smoke passed");

// --- part BB (295 bug 2 probe): with the gate open and no further board activity at all, a
// schedulable backlog task promotes on the daemon's own sweep; the fixture attempt at the
// 20 hour stall (#293) ---
const rootBB = fixture();
cleaned.push(rootBB);
mkdirSync(kanbanDir(rootBB), { recursive: true });
writeFileSync(join(kanbanDir(rootBB), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootBB), pollMinutes: 0.01, backlogIdleMinutes: 1 }));
const idleBB = createTask(rootBB, { name: "feat: idle board task", summary: "Stall probe", specs: "n/a" });
const agedBB = new Date(Date.now() - 120_000);
utimesSync(join(kanbanDir(rootBB), idleBB.file), agedBB, agedBB);
const bb = await runDaemon(rootBB);
await waitFor(() => bb.output().includes(`promoting ${idleBB.file} to to-do`), 30000, "an idle board with an open gate promotes", bb.output);
assert.ok(!bb.output().includes("promotion deferred"), "the open gate logged no deferral");
assert.notEqual(parseTask(rootBB, idleBB.file).state, "backlog", "the idle board task left backlog");
bb.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + idle board stall probe smoke passed");

// --- part BC (296): a future task-file mtime (clock skew) must not hold the quiet gate shut.
// A future mtime is not board activity: clamping it to Date.now() every sweep would keep
// reading as fresh and never open, so the gate skips future files when it finds the newest ---
const rootBC = fixture();
cleaned.push(rootBC);
mkdirSync(kanbanDir(rootBC), { recursive: true });
const skewedBC = createTask(rootBC, { name: "feat: skewed mtime", summary: "Clamp gate mtime", specs: "n/a" });
const futureBC = new Date(Date.now() + 3_600_000);
utimesSync(join(kanbanDir(rootBC), skewedBC.file), futureBC, futureBC);
assert.equal(promoteBacklog(rootBC, listAll(rootBC), 0.01).length, 1, "a future mtime does not defer promotion past the window");
assert.equal(parseTask(rootBC, skewedBC.file).state, "to-do", "the future-mtime task promoted on the next sweep");
const logBCPath = join(kanbanDir(rootBC), ".logs", "orchestrator.log");
const logBC = existsSync(logBCPath) ? readFileSync(logBCPath, "utf8") : "";
assert.ok(!/promotion deferred, newest task write -\d+s ago/.test(logBC), "the defer log shows no negative age");
cleanupAll(rootBC);
console.log("orchestrator.test.ts: ... + future gate mtime smoke passed");

// --- part BD (300): priority orders the state pass under the cap. Cap 1 with a low-priority
// to-review task created first and a critical to-do task created second: the critical
// developer takes the slot, the low reviewer waits, and it starts once the slot frees ---
const rootBD = fixture();
cleaned.push(rootBD);
const homeBD = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeBD);
mkdirSync(kanbanDir(rootBD), { recursive: true });
const savedHomeBD = process.env.HOME;
process.env.HOME = homeBD;
let cfgBD: ReturnType<typeof loadConfig>;
try {
	cfgBD = loadConfig(rootBD);
} finally {
	process.env.HOME = savedHomeBD;
}
cfgBD.backlogIdleMinutes = 0;
cfgBD.maxParallel = 1;
cfgBD.agent = deadStub(rootBD);
// low first by name, moderate so the reviewer spawn is not skipped by the simple cap
const lowBD = createTask(rootBD, { name: "fix: low review waits", priority: "low", complexity: "moderate", summary: "Priority order smoke", specs: "n/a" });
setState(rootBD, lowBD, "to-review");
// critical second by name, simple so the developer starts without a Splitter pass
const criticalBD = createTask(rootBD, { name: "feat: critical todo first", priority: "critical", complexity: "simple", summary: "Priority order smoke", specs: "n/a" });
setState(rootBD, criticalBD, "to-do");
rescan(rootBD, cfgBD);
assert.equal(parseTask(rootBD, criticalBD.file).state, "doing", "the critical developer took the only slot");
assert.ok(existsSync(pidPath(rootBD, taskSlug(criticalBD.file))), "the critical developer pid file exists");
assert.equal(parseTask(rootBD, lowBD.file).state, "to-review", "the low-priority reviewer waits at the cap");
assert.ok(!existsSync(pidPath(rootBD, taskSlug(lowBD.file))), "the low-priority reviewer did not spawn at the cap");
setState(rootBD, criticalBD, "done");
rescan(rootBD, cfgBD);
assert.equal(parseTask(rootBD, lowBD.file).state, "reviewing", "the low-priority reviewer starts once the slot frees");
assert.ok(existsSync(pidPath(rootBD, taskSlug(lowBD.file))), "the low-priority reviewer pid file exists");
cleanupAll(rootBD);
console.log("orchestrator.test.ts: ... + priority orders the pipeline under the cap smoke passed");

// --- part BE (300): equal priorities keep creation order: two same-priority to-do tasks at
// cap 1, the older one starts first, the younger waits for the free slot ---
const rootBE = fixture();
cleaned.push(rootBE);
const homeBE = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeBE);
mkdirSync(kanbanDir(rootBE), { recursive: true });
const savedHomeBE = process.env.HOME;
process.env.HOME = homeBE;
let cfgBE: ReturnType<typeof loadConfig>;
try {
	cfgBE = loadConfig(rootBE);
} finally {
	process.env.HOME = savedHomeBE;
}
cfgBE.backlogIdleMinutes = 0;
cfgBE.maxParallel = 1;
cfgBE.agent = deadStub(rootBE);
const olderBE = createTask(rootBE, { name: "feat: older same tier", priority: "high", complexity: "simple", summary: "Priority tie smoke", specs: "n/a" });
setState(rootBE, olderBE, "to-do");
const youngerBE = createTask(rootBE, { name: "feat: younger same tier", priority: "high", complexity: "simple", summary: "Priority tie smoke", specs: "n/a" });
setState(rootBE, youngerBE, "to-do");
rescan(rootBE, cfgBE);
assert.equal(parseTask(rootBE, olderBE.file).state, "doing", "the older same-priority task took the slot");
assert.ok(existsSync(pidPath(rootBE, taskSlug(olderBE.file))), "the older same-priority developer pid file exists");
assert.equal(parseTask(rootBE, youngerBE.file).state, "to-do", "the younger same-priority task waits at the cap");
assert.ok(!existsSync(pidPath(rootBE, taskSlug(youngerBE.file))), "the younger same-priority developer did not spawn at the cap");
setState(rootBE, olderBE, "done");
rescan(rootBE, cfgBE);
assert.equal(parseTask(rootBE, youngerBE.file).state, "doing", "the younger same-priority task starts once the slot frees");
cleanupAll(rootBE);
console.log("orchestrator.test.ts: ... + same-priority creation order smoke passed");

// --- part BI: the user hold token holds a backlog task until the PM removes it, and the
// auto-drop keeps the token while it drops a satisfied ref ---
const rootBI = fixture();
cleaned.push(rootBI);
mkdirSync(kanbanDir(rootBI), { recursive: true });
const heldBI = createTask(rootBI, { name: "feat: held in backlog", summary: "User hold smoke", specs: "n/a", blockedBy: "user" });
const runningBI = createTask(rootBI, { name: "feat: blocker still running", summary: "User hold smoke", specs: "n/a" });
setState(rootBI, runningBI, "doing");
const doneBI = createTask(rootBI, { name: "feat: blocker done", summary: "User hold smoke", specs: "n/a" });
setState(rootBI, doneBI, "done");
// the token mixes with a task ref: the task waits for the user AND for the ref
const mixedBI = createTask(rootBI, { name: "feat: held with an unfinished ref", summary: "User hold smoke", specs: "n/a", blockedBy: `user, #${taskNum(runningBI.file)}` });
// the token survives the auto-drop of a satisfied ref
const droppedBI = createTask(rootBI, { name: "feat: held over a done ref", summary: "User hold smoke", specs: "n/a", blockedBy: `user, #${taskNum(doneBI.file)}` });
assert.equal(promoteBacklog(rootBI, listAll(rootBI)).length, 0, "a user hold holds every promotion");
assert.equal(parseTask(rootBI, heldBI.file).state, "backlog", "the bare hold keeps the task in backlog");
assert.equal(parseTask(rootBI, mixedBI.file).state, "backlog", "the hold keeps the task in backlog beside an unfinished ref");
dropDoneBlockers(rootBI, listAll(rootBI));
assert.equal(parseTask(rootBI, droppedBI.file).blockedBy, "user", "the auto-drop keeps the user hold and drops the done ref");
assert.equal(parseTask(rootBI, droppedBI.file).state, "backlog", "the held task stays in backlog after the auto-drop");
// kanban_update removes only the token: the task promotes on the next pass
updateTask(rootBI, heldBI, { blockedBy: "" });
assert.deepEqual(promoteBacklog(rootBI, listAll(rootBI)).map((t) => t.file), [heldBI.file], "only the released task promotes");
assert.equal(parseTask(rootBI, heldBI.file).state, "to-do", "the released task reached to-do");
cleanupAll(rootBI);
console.log("orchestrator.test.ts: ... + user hold on a backlog task smoke passed");
