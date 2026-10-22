import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, kanbanDir, parseTask, setState, setWorktree, taskNum, taskSlug, updateTask } from "../../src/kanban.ts";
import { armedPath } from "../../src/orchestrator/log.ts";
import { REPORT_MAX_AGE_MS, reportsDir } from "../../src/orchestrator/report.ts";
import { loadConfig, poll, removeTask } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import { pidPath } from "../../src/pid.ts";
import { fixture, mirrorSubjects, showTip, roleStub, deadStub, runDaemon, waitFor, cleaned } from "../helpers.ts";

// --- part N: the PM report: one report per done sweep, queued for the PM session ---
const rootN = fixture();
cleaned.push(rootN);
mkdirSync(kanbanDir(rootN), { recursive: true });
writeFileSync(join(rootN, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootN), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
// both tasks reach done inside one sweep: created in to-merge with nothing to merge
// (no worktree, no branch), sweepToMerge sets them done directly
const doneN1 = createTask(rootN, { name: "fix: merged task", summary: "Merged", specs: "n/a" });
const doneN2 = createTask(rootN, { name: "fix: merged task two", summary: "Merged too", specs: "n/a" });
setState(rootN, doneN1, "to-merge");
setState(rootN, doneN2, "to-merge");
// a finding task from the first task's live test: held unpromoted by its open questions,
// so the report must list it under the finished task's findings for the PM to unblock
const findingN = createTask(rootN, { name: "fix: regression found in live test", summary: "Finding", specs: "n/a", issuer: `#${taskNum(doneN1.file)}`, openQuestions: "- [user] Keep the flag?" });
// a plain schedulable task: promoted this sweep, listed in the Scheduled section
const schedN = createTask(rootN, { name: "feat: scheduled next", summary: "Promoted", specs: "n/a" });
rescan(rootN, loadConfig(rootN));
const reportsN = readdirSync(reportsDir(rootN)).filter((f) => f.endsWith(".md")).sort();
assert.equal(reportsN.length, 1, "exactly one report for the done sweep");
const reportN = readFileSync(join(reportsDir(rootN), reportsN[0]), "utf8");
assert.match(reportN, /^# Board report\n/);
assert.ok(reportN.includes(doneN1.file) && reportN.includes(doneN2.file), "the Done section covers both finished tasks");
assert.ok(reportN.includes(`- ${schedN.name} (${schedN.file}): to-do`), "the Scheduled section lists the promoted task with its new state");
assert.ok(reportN.includes(`## Live-test findings for ${doneN1.name} (#${taskNum(doneN1.file)})`), "findings are grouped under the finished task");
assert.ok(reportN.includes(findingN.file) && reportN.includes("Keep the flag?"), "the finding task and its open questions are listed");
assert.match(reportN.slice(reportN.indexOf(`## Live-test findings for ${doneN2.name}`)), /^## Live-test findings for[^\n]*\nnone\n/, "a finished task without findings lists none");
assert.ok(reportN.includes("## Instructions for the Project manager"), "the report ends with the PM instructions");
assert.ok(reportN.includes("kanban_mark_processed"), "the PM instructions teach the mark flow");
// a second sweep: already-seen done tasks do not re-report
rescan(rootN, loadConfig(rootN));
assert.equal(readdirSync(reportsDir(rootN)).filter((f) => f.endsWith(".md")).length, 1, "already-seen done tasks do not re-report");
// the sweep prunes stale reports and stale claims by mtime, fresh ones survive
const staleReportN = join(reportsDir(rootN), "2020-01-01T00-00-00-000Z.md");
writeFileSync(staleReportN, "# Board report\nstale\n");
const staleClaimN = join(reportsDir(rootN), `${reportsN[0]}.claiming`);
writeFileSync(staleClaimN, "half-written");
const oldN = new Date(Date.now() - REPORT_MAX_AGE_MS - 60_000);
utimesSync(staleReportN, oldN, oldN);
utimesSync(staleClaimN, oldN, oldN);
rescan(rootN, loadConfig(rootN));
assert.ok(!existsSync(staleReportN), "a stale report is pruned");
assert.ok(!existsSync(staleClaimN), "a stale claim is pruned");
assert.ok(existsSync(join(reportsDir(rootN), reportsN[0])), "the fresh report survives the prune");

// daemon-start catch-up: done tasks left unmarked while the daemon was dead are reported at
// the first sweep; a task carrying the marker #269 writes is not re-reported
const rootN2 = fixture();
cleaned.push(rootN2);
mkdirSync(join(kanbanDir(rootN2), ".logs"), { recursive: true });
writeFileSync(join(rootN2, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootN2), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const unmarkedN = createTask(rootN2, { name: "fix: unmarked done", summary: "Catch-up", specs: "n/a" });
setState(rootN2, unmarkedN, "done");
const markedN = createTask(rootN2, { name: "fix: marked done", summary: "Catch-up", specs: "n/a" });
setState(rootN2, markedN, "done");
writeFileSync(join(kanbanDir(rootN2), ".logs", `${markedN.file.replace(/\.md$/, "")}.pm-processed`), "");
rescan(rootN2, loadConfig(rootN2));
const catchupReportsN = readdirSync(reportsDir(rootN2)).filter((f) => f.endsWith(".md"));
assert.equal(catchupReportsN.length, 1, "the daemon-start sweep queues one catch-up report");
const catchupN = readFileSync(join(reportsDir(rootN2), catchupReportsN[0]), "utf8");
assert.ok(catchupN.includes(unmarkedN.file), "a done task with no marker is reported at daemon start");
assert.ok(!catchupN.includes(markedN.file), "a done task with a marker is not reported");
// the next sweep stays silent: lastDone holds the catch-up task, only a new transition reports
rescan(rootN2, loadConfig(rootN2));
assert.equal(readdirSync(reportsDir(rootN2)).filter((f) => f.endsWith(".md")).length, 1, "the catch-up task is not re-reported on later sweeps");

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cooldown + mirror board + bootstrap + fresh-clone bootstrap + PM report queue passed");

// --- part O: a settled done task without a worktree must not swallow create events ---
// the old code issued a "kanban: done" commit every sweep for such a task; commitKanban
// rebuilds the tree from the whole board, so the first of those folded a newly created
// task's file in under the done label and the create commit became a no-op
const rootO = fixture();
cleaned.push(rootO);
mkdirSync(kanbanDir(rootO), { recursive: true });
writeFileSync(join(rootO, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootO), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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

// --- part T: 3 consecutive failed pushes log the warning once ---
const rootT = fixture();
cleaned.push(rootT);
// origin points at a non-repo path: every push fails fast, no SSH involved
execSync("git remote add origin /nonexistent/se-llm-team.git", { cwd: rootT, shell: "/bin/bash" });
mkdirSync(kanbanDir(rootT), { recursive: true });
writeFileSync(join(rootT, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootT), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
writeFileSync(join(rootT2, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootT2), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
let front = "";
try { front = readFileSync("SPECS.md", "utf8"); } catch {}
if (!prompt.includes("Developer agent") || !front.match(/^state: /m)) process.exit(0);
const state = (front.match(/^state: "(.*)"$/m) ?? [])[1] ?? "";
appendFileSync(${JSON.stringify(join(rootAF, "guard.log"))}, JSON.stringify({ pid: process.pid, wrapper: process.ppid, state }) + "\\n");
// exit 1: a crash exit reads as a bounce (the to-do rewrite survives), while exit 0 would
// read as a successful finish and move the task out of doing before the rewrite check
setTimeout(() => process.exit(1), 5000);
`,
	{ mode: 0o755 },
);
writeFileSync(join(rootAF, "se-llm-team.json"), JSON.stringify({ agent: guardStub, pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
assert.equal(parseInt(readFileSync(pidFileAF, "utf8").trim(), 10), guardRunsAF()[0].wrapper, "pid file names the first agent's wrapper");
// the to-do rewrite that used to twin the agent: several sweeps and a liveness poll later,
// the pid check, not the state, must still keep the second spawn away
writeFileSync(join(kanbanDir(rootAF), taskAF.file), readFileSync(join(kanbanDir(rootAF), taskAF.file), "utf8").replace(/^state: .*/m, 'state: "to-do"'));
await new Promise((r) => setTimeout(r, 1500));
assert.equal(spawnedAF(), 1, "no second developer while the first agent pid is alive");
assert.equal(guardRunsAF().length, 1, "the stub never ran a second time");
assert.equal(parseInt(readFileSync(pidFileAF, "utf8").trim(), 10), guardRunsAF()[0].wrapper, "pid file still names the first agent's wrapper");
assert.equal(parseTask(rootAF, taskAF.file).state, "to-do", "the to-do rewrite is left alone while the agent lives");
// the agent exits: the next sweep spawns exactly one replacement and rewrites the pid file
await waitFor(() => guardRunsAF().length === 2, 30000, "single replacement after the first agent died", af.output);
assert.equal(guardRunsAF().length, 2, "exactly one replacement agent");
assert.notEqual(guardRunsAF()[1].pid, guardRunsAF()[0].pid, "the replacement is a new process");
assert.equal(parseInt(readFileSync(pidFileAF, "utf8").trim(), 10), guardRunsAF()[1].wrapper, "pid file names the single live agent's wrapper");
af.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + double-spawn live-pid guard smoke passed");
// --- part AG: kanban task removal: the file and the mirror go in one operation ---
// reconcileBoard restores files the working tree lacks whenever the mirror tip still carries
// them, so a removal must reach the mirror itself or the task comes back (the self-heal)
const rootAG = fixture();
cleaned.push(rootAG);
mkdirSync(kanbanDir(rootAG), { recursive: true });
writeFileSync(join(rootAG, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAG), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskAG = createTask(rootAG, { name: "fix: mistaken task", summary: "Removal smoke", specs: "n/a" });
const taskAG2 = createTask(rootAG, { name: "fix: keep me", summary: "Stays on the board", specs: "n/a" });

const ag = await runDaemon(rootAG);
// both tasks reach the mirror first: creates run for every file not on the mirror yet
await waitFor(() => showTip(rootAG, taskAG.file) !== null && showTip(rootAG, taskAG2.file) !== null, 30000, "both tasks mirrored", ag.output);

const markerAG = join(kanbanDir(rootAG), ".logs", `${taskAG.file.replace(/\.md$/, "")}.pm-processed`);
mkdirSync(join(kanbanDir(rootAG), ".logs"), { recursive: true });
writeFileSync(markerAG, "");
// removal while the daemon runs: the file leaves the tree and the mirror in one operation
assert.equal(await removeTask(rootAG, taskAG.file), null, "removal succeeds");
assert.equal(existsSync(join(kanbanDir(rootAG), taskAG.file)), false, "task file deleted");
assert.equal(existsSync(markerAG), false, "the removed task's pm-processed marker is deleted");
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
writeFileSync(join(rootAM, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootAM), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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

// --- part AP: the .pids janitor sweeps dead pid files once their reader is done with them ---
// generic pids accumulate: nothing clears a splitter pid after the task leaves to-do, a killed
// analysis leaves its pid behind (the wrapper self-removes only on a clean exit), and a task
// removed mid-run leaves its per-task pid. A live process's file always stays, and so does a
// board task's per-task pid: the poll reads it in every state (exit code, armed reviewer
// marker, dead-streak clear) and clears the file itself. A to-do task's splitter pid also
// stays: its dead file is the splitter-ran marker that routes the fallback to the Developer
const rootAP = fixture();
cleaned.push(rootAP);
mkdirSync(join(kanbanDir(rootAP), ".pids"), { recursive: true });
writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAP), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const pidsAP = join(kanbanDir(rootAP), ".pids");
const pidAP = (name: string) => join(pidsAP, `${name}.pid`);
const doneAP = createTask(rootAP, { name: "fix: done leftovers", summary: "Janitor smoke", specs: "n/a" });
const doneSlugAP = doneAP.file.replace(/\.md$/, "");
setState(rootAP, doneAP, "done");
const doingAP = createTask(rootAP, { name: "fix: working agent", summary: "Janitor smoke", specs: "n/a" });
const doingSlugAP = doingAP.file.replace(/\.md$/, "");
setState(rootAP, doingAP, "doing");
// simple: the sweep starts a Developer, not a splitter, so the seeded marker is not overwritten
const todoAP = createTask(rootAP, { name: "fix: splitter marker", summary: "Janitor smoke", specs: "n/a", complexity: "simple" });
const todoSlugAP = todoAP.file.replace(/\.md$/, "");
setState(rootAP, todoAP, "to-do");
// dead pids: 999999999 never existed; the live orphan names a real sleeper
writeFileSync(pidAP("000999_gone_task"), "999999999");
writeFileSync(pidAP("000999_gone_task.reviewer.0.analysis"), "999999999");
writeFileSync(pidAP(`${doneSlugAP}.splitter`), "999999999");
writeFileSync(pidAP(`${doneSlugAP}.developer.0.analysis`), "999999999");
writeFileSync(pidAP(doneSlugAP), "999999999");
writeFileSync(pidAP(doingSlugAP), "999999999");
writeFileSync(pidAP(`${todoSlugAP}.splitter`), "999999999");
const sleeperAP = spawn("sleep", ["30"], { stdio: "ignore" });
writeFileSync(pidAP("000999_gone_live"), String(sleeperAP.pid));
rescan(rootAP, loadConfig(rootAP));
assert.ok(!existsSync(pidAP("000999_gone_task")), "a dead orphan per-task pid is swept");
assert.ok(!existsSync(pidAP("000999_gone_task.reviewer.0.analysis")), "a dead orphan analysis pid is swept");
assert.ok(!existsSync(pidAP(`${doneSlugAP}.splitter`)), "a splitter pid is swept once its task left to-do");
assert.ok(!existsSync(pidAP(`${doneSlugAP}.developer.0.analysis`)), "a done task's dead analysis pid is swept");
assert.ok(existsSync(pidAP("000999_gone_live")), "a live process keeps its pid file even when its task is gone");
assert.ok(existsSync(pidAP(doneSlugAP)), "a board task's per-task pid survives: the poll consumes it and clears it itself");
assert.ok(existsSync(pidAP(doingSlugAP)), "a keep-state task's per-task pid survives");
assert.ok(existsSync(pidAP(`${todoSlugAP}.splitter`)), "a to-do task's splitter pid survives as the splitter-ran marker");
sleeperAP.kill("SIGKILL");
console.log("orchestrator.test.ts: ... + .pids dead-pid janitor smoke passed");

// --- part AZ: maxParallel caps the live-tester spawn: at the cap a to-live-test task stays
// put, below the cap it starts. Direct-drive rescan (part AW harness), poll is not driven ---
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
cfgAZ.backlogIdleMinutes = 0;
cfgAZ.maxParallel = 1;
cfgAZ.agent = deadStub(rootAZ);
const holderAZ = createTask(rootAZ, { name: "fix: working slot", summary: "MaxParallel smoke", specs: "n/a" });
setState(rootAZ, holderAZ, "doing");
// a branch at HEAD (merged): the to-live-test branch requires the worktree branch merged
execSync("git branch cap-live", { cwd: rootAZ, shell: "/bin/bash" });
const taskAZ = createTask(rootAZ, { name: "feat: capped live test", summary: "MaxParallel smoke", specs: "n/a" });
setWorktree(rootAZ, taskAZ, "cap-live");
setState(rootAZ, taskAZ, "to-live-test");
rescan(rootAZ, cfgAZ);
assert.equal(parseTask(rootAZ, taskAZ.file).state, "to-live-test", "at the cap the live-tester spawn waits");
assert.ok(!existsSync(pidPath(rootAZ, taskSlug(taskAZ.file))), "at the cap no live-tester spawned");
setState(rootAZ, holderAZ, "done");
rescan(rootAZ, cfgAZ);
assert.equal(parseTask(rootAZ, taskAZ.file).state, "live-testing", "below the cap the live-tester spawned");
assert.ok(existsSync(pidPath(rootAZ, taskSlug(taskAZ.file))), "below the cap the live-tester pid file exists");
console.log("orchestrator.test.ts: ... + maxParallel live-test cap smoke passed");

// --- part UH1: a user hold skips the reviewer spawn: the task stays in to-review and no armed
// marker is written, so releasing the hold starts the review with no stale run on record ---
const rootUH1 = fixture();
cleaned.push(rootUH1);
const homeUH1 = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeUH1);
mkdirSync(kanbanDir(rootUH1), { recursive: true });
const savedHomeUH1 = process.env.HOME;
process.env.HOME = homeUH1;
let cfgUH1: ReturnType<typeof loadConfig>;
try {
	cfgUH1 = loadConfig(rootUH1);
} finally {
	process.env.HOME = savedHomeUH1;
}
cfgUH1.backlogIdleMinutes = 0;
cfgUH1.agent = deadStub(rootUH1);
const heldUH1 = createTask(rootUH1, { name: "feat: held in review", summary: "User hold smoke", specs: "n/a", blockedBy: "user" });
setState(rootUH1, heldUH1, "to-review");
rescan(rootUH1, cfgUH1);
assert.equal(parseTask(rootUH1, heldUH1.file).state, "to-review", "the held task stays in to-review");
assert.equal(existsSync(pidPath(rootUH1, taskSlug(heldUH1.file))), false, "no reviewer pid file for a held task");
assert.equal(existsSync(armedPath(rootUH1, taskSlug(heldUH1.file))), false, "no reviewer armed marker for a held task");
updateTask(rootUH1, heldUH1, { blockedBy: "" });
rescan(rootUH1, cfgUH1);
assert.equal(parseTask(rootUH1, heldUH1.file).state, "reviewing", "the released task spawned the reviewer");
assert.ok(existsSync(armedPath(rootUH1, taskSlug(heldUH1.file))), "the released task armed the reviewer run");
console.log("orchestrator.test.ts: ... + user hold skips the reviewer spawn smoke passed");

// --- part UH2: a user hold skips the live-tester spawn and the scan moves on: the held task
// keeps to-live-test, the next eligible task starts its run ---
const rootUH2 = fixture();
cleaned.push(rootUH2);
const homeUH2 = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeUH2);
mkdirSync(kanbanDir(rootUH2), { recursive: true });
const savedHomeUH2 = process.env.HOME;
process.env.HOME = homeUH2;
let cfgUH2: ReturnType<typeof loadConfig>;
try {
	cfgUH2 = loadConfig(rootUH2);
} finally {
	process.env.HOME = savedHomeUH2;
}
cfgUH2.backlogIdleMinutes = 0;
cfgUH2.agent = deadStub(rootUH2);
// two branches at HEAD (merged): the to-live-test branch requires the worktree branch merged
execSync("git branch held-live && git branch next-live", { cwd: rootUH2, shell: "/bin/bash" });
const heldUH2 = createTask(rootUH2, { name: "feat: held live test", priority: "critical", summary: "User hold smoke", specs: "n/a", blockedBy: "user" });
setWorktree(rootUH2, heldUH2, "held-live");
setState(rootUH2, heldUH2, "to-live-test");
const nextUH2 = createTask(rootUH2, { name: "feat: next live test", priority: "low", summary: "User hold smoke", specs: "n/a" });
setWorktree(rootUH2, nextUH2, "next-live");
setState(rootUH2, nextUH2, "to-live-test");
rescan(rootUH2, cfgUH2);
assert.equal(parseTask(rootUH2, heldUH2.file).state, "to-live-test", "the held task stays in to-live-test");
assert.equal(existsSync(pidPath(rootUH2, taskSlug(heldUH2.file))), false, "no live-tester pid file for a held task");
assert.equal(parseTask(rootUH2, nextUH2.file).state, "live-testing", "the next eligible task started its live test");
assert.ok(existsSync(pidPath(rootUH2, taskSlug(nextUH2.file))), "the next eligible task's live-tester pid file exists");
updateTask(rootUH2, heldUH2, { blockedBy: "" });
rescan(rootUH2, cfgUH2);
assert.equal(parseTask(rootUH2, heldUH2.file).state, "live-testing", "the released task spawned the live-tester");
assert.ok(existsSync(pidPath(rootUH2, taskSlug(heldUH2.file))), "the released task's live-tester pid file exists");
console.log("orchestrator.test.ts: ... + user hold skips the live-tester spawn smoke passed");
