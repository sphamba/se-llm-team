import assert from "node:assert/strict";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, kanbanDir, parseTask, setState, setWorktree, taskSlug } from "../../src/kanban.ts";
import { loadConfig, poll } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import { agentPid, pidAlive, pidPath } from "../../src/pid.ts";
import { exitFilePath, readExitCode, spawnAgent } from "../../src/orchestrator/spawn.ts";
import { fixture, roleStub, deadStub, runDaemon, waitFor, cleaned } from "../helpers.ts";

// --- part B: dead agents bounce unconditionally; past the respawn cap the fresh spawn waits for the idle cooldown ---
const rootB = fixture();
cleaned.push(rootB);
mkdirSync(kanbanDir(rootB), { recursive: true });
writeFileSync(join(rootB, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootB), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskB = createTask(rootB, { name: "fix: dead agent", summary: "Liveness smoke", specs: "n/a" });
setState(rootB, taskB, "to-do");
// a second task in live-testing with an unmerged branch: covers the poll's live-testing ->
// to-live-test bounce, the unmerged-branch requeue to to-merge and the orchestrator merging it
// itself (no merger agent), after which the dead live-tester respawns and bounces again
const taskB2 = createTask(rootB, { name: "fix: dead merger", summary: "Liveness smoke", specs: "n/a" });
execSync("git checkout -qb feat/dead-merger && git commit -q --allow-empty -m x && git checkout -q main", { cwd: rootB, shell: "/bin/bash" });
setWorktree(rootB, taskB2, "feat/dead-merger");
setState(rootB, taskB2, "live-testing");

const b = await runDaemon(rootB);
const slugB = taskB.file.replace(/\.md$/, "");
const bouncesB = () => b.output().split("doing -> to-do").length - 1;
// the live-tester task dies too and logs its own cooldown line, so the counts below are
// slug-scoped: the bare substring spans both tasks and races the live-tester's log
const cooldownB = () =>
	b.output().split("\n").filter((l) => l.includes(`${slugB}: agent died`) && l.includes("respawn waits for the idle cooldown")).length;
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
assert.equal(cooldownB(), 1, "cooldown log fired exactly once");
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
assert.equal(cooldownB(), 1, "still one cooldown log past the cap");
// the dead live-tester bounces live-testing -> to-live-test; the branch is unmerged, so the
// rescan requeues the task to to-merge, where the merge lane hands it to a Merger agent: the
// dead stub dies, and the task bounces merging -> to-merge without ever reaching the live test
await waitFor(() => b.output().includes("live-testing -> to-live-test"), 30000, "poll bounced the dead live-tester to to-live-test", b.output);
await waitFor(() => b.output().includes("not merged yet, moving to to-merge"), 30000, "unmerged branch requeued for the merge", b.output);
await waitFor(() => b.output().includes("merger spawned in feat/dead-merger, set merging"), 30000, "the unmerged branch handed to a merger", b.output);
await waitFor(() => b.output().includes("merging -> to-merge"), 30000, "the dead merger bounced the task back to to-merge", b.output);
const b2State = parseTask(rootB, taskB2.file).state;
assert.ok(b2State === "to-merge" || b2State === "merging", `the dead merger leaves the task in the merge lane (${b2State})`);
// a completed run re-arms the streak: a stale pidfile on a task outside the mapped states
// clears the counter, so a second streak past the cap gets its own cooldown log, not silence.
// done, not backlog: the sweep would promote a backlog task back to to-do mid-check
setState(rootB, taskB, "done");
writeFileSync(join(kanbanDir(rootB), ".pids", `${slugB}.pid`), "999999999");
await waitFor(() => b.output().includes("cleared the dead-agent counter"), 30000, "completed run cleared the dead counter", b.output);
setState(rootB, taskB, "to-do");
await waitFor(() => cooldownB() >= 2, 90000, "second streak cooldown log", b.output);
assert.equal(cooldownB(), 2, "second death streak logged its own cooldown message");
b.daemon.kill("SIGTERM");

// --- part I: pid 0 is dead and a failed spawn writes no pid file, so the poll bounces per DEAD_TRANSITIONS ---
assert.equal(pidAlive(0), false, "pid 0 is the caller's process group, not a live agent");
assert.equal(pidAlive(-1), false, "negative pids are not alive");
assert.equal(pidAlive(process.pid), true, "a live pid is alive");

const rootI = fixture();
cleaned.push(rootI);
mkdirSync(kanbanDir(rootI), { recursive: true });
// missing executable: sh spawns fine and records exit 127 in the exit file
writeFileSync(join(rootI, "se-llm-team.json"), JSON.stringify({ agent: join(rootI, "missing-agent"), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskI = createTask(rootI, { name: "fix: failed spawn", summary: "Missing agent smoke", specs: "n/a", complexity: "simple" });
setState(rootI, taskI, "to-do");

const hi = await runDaemon(rootI);
const readI = () => parseTask(rootI, taskI.file);
const pidsI = () => {
	try {
		return readdirSync(join(kanbanDir(rootI), ".pids"));
	} catch {
		return [];
	}
};
// the sh wrapper records the missing executable as exit 127 in the exit file, so the poll
// reads it as a non-zero exit and bounces doing -> to-do; the rescan retries the spawn
await waitFor(() => hi.output().includes("exited 127 without success, doing -> to-do"), 30000, "spawn failure bounced", hi.output);
await waitFor(() => hi.output().includes("respawn waits for the idle cooldown"), 60000, "cooldown on repeated failed spawns", hi.output);
assert.deepEqual(pidsI(), [], "no pid file after repeated failed spawns");
assert.equal(readI().state, "to-do", "bounced back and parked on the idle cooldown, not frozen in doing");
hi.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard smoke passed");

// --- part AI: a completed run clears the dead counter, so the cooldown applies to consecutive-death streaks only ---
const rootAI = fixture();
cleaned.push(rootAI);
mkdirSync(join(kanbanDir(rootAI), ".logs"), { recursive: true });
writeFileSync(join(rootAI, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootAI), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
writeFileSync(join(rootAK, "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootAK), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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

// --- part AN: a live-but-silent agent (log unchanged for the stall window) is bounced, killed
// and counted. poll() runs directly with an injected clock, so the 5-minute window is
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
// task 5: merging with a live merger pid, but no merger slug recorded for it (another task's
// merger owns the global pid/exit pair): requeued to to-merge, never sampled, never a false kill
const taskAN5 = stallTask("fix: stale merger task", "merging");
const slugAN5 = taskAN5.file.replace(/\.md$/, "");
const sleeperAN5 = sleeperAN(60000);
sleepersAN.push(sleeperAN5);
writeFileSync(join(kanbanDir(rootAN), ".pids", "merger.pid"), String(sleeperAN5.pid!));
writeFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN5}.merger.0.log`), "old run\n");
// task 6: merging and the recorded merger slug names it: the stall check samples its own
// merger log and bounces the merger at the window edge like any other working agent
const taskAN6 = stallTask("fix: recorded merger task", "merging");
const slugAN6 = taskAN6.file.replace(/\.md$/, "");
const sleeperAN6 = sleeperAN(60000);
sleepersAN.push(sleeperAN6);
writeFileSync(join(kanbanDir(rootAN), ".pids", "merger.pid"), String(sleeperAN6.pid!));
writeFileSync(join(kanbanDir(rootAN), ".pids", "merger.slug"), `${slugAN6}\n`);
writeFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN6}.merger.0.log`), "silent\n");

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
// a merging task the slug file does not name requeues without a death record: never sampled,
// never a false kill
assert.equal(parseTask(rootAN, taskAN5.file).state, "to-merge", "a superseded merging task requeues to to-merge");
assert.ok(pidAlive(sleeperAN5.pid!), "the merger working another task is not killed");
assert.ok(!existsSync(join(kanbanDir(rootAN), ".logs", `${slugAN5}.merger.0.dead`)), "no death marker for the requeued merging task");
assert.ok(!existsSync(join(kanbanDir(rootAN), ".logs", `${slugAN5}.dead.count`)), "no dead counter bump for the requeued merging task");
// the recorded merging task's stall check samples its own merger log: bounced at the edge
assert.equal(parseTask(rootAN, taskAN6.file).state, "to-merge", "the recorded merger's stall bounce moves merging -> to-merge");
assert.equal(readFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN6}.dead.count`), "utf8").trim(), "1", "dead counter bumped on the merger stall bounce");
assert.ok(readFileSync(join(kanbanDir(rootAN), ".logs", `${slugAN6}.merger.0.dead`), "utf8").trim() === String(sleeperAN6.pid!), "the merger stall bounce names the dying run in the per-run death marker");
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

// --- part AT: the exit-code file decides a successful finish from a crash. poll driven
// directly: the sh wrapper records the agent's exit code into <slug>.exit, so the code
// survives a daemon restart and one pass tells 0 from a crash ---
const rootAT = fixture();
cleaned.push(rootAT);
const homeAT = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAT);
mkdirSync(kanbanDir(rootAT), { recursive: true });
const savedHomeAT = process.env.HOME;
process.env.HOME = homeAT;
let cfgAT: ReturnType<typeof loadConfig>;
try {
	cfgAT = loadConfig(rootAT);
} finally {
	process.env.HOME = savedHomeAT;
}
// one stub for every case: it exits with the code in <cwd>/exit-code.txt (0 when missing)
const stubAT = join(rootAT, "exit-code-agent.cjs");
writeFileSync(
	stubAT,
	`#!/usr/bin/env node
const { readFileSync } = require("node:fs");
let code = 0;
try {
	code = parseInt(readFileSync(process.cwd() + "/exit-code.txt", "utf8").trim(), 10) || 0;
} catch {}
process.exit(code);
`,
);
chmodSync(stubAT, 0o755);
cfgAT.agent = stubAT;
const taskAT = createTask(rootAT, { name: "feat: exit code file", summary: "Exit-code file smoke", specs: "n/a" });
const slugAT = taskSlug(taskAT.file);
const cwdAT = join(rootAT, "agent-cwd");
mkdirSync(cwdAT, { recursive: true });
const orchLogAT = () => readFileSync(join(kanbanDir(rootAT), ".logs", "orchestrator.log"), "utf8");
const deadCountAT = () => readFileSync(join(kanbanDir(rootAT), ".logs", `${slugAT}.dead.count`), "utf8").trim();
// spawn through spawnAgent and wait until the wrapper wrote its exit code and died: a poll
// while the wrapper still lives would see a live pid and skip the pass
const runAgentAT = async (code: number) => {
	writeFileSync(join(cwdAT, "exit-code.txt"), String(code));
	spawnAgent(rootAT, cfgAT, "developer", taskAT, cwdAT);
	const pid = agentPid(rootAT, slugAT);
	await waitFor(() => readExitCode(rootAT, slugAT) === code && !pidAlive(pid), 15000, `the wrapper recorded exit ${code}`, () => "");
	return pid;
};

// crash with a recorded code: exit 7 bounces doing -> to-do, clears both pid files, bumps
setState(rootAT, taskAT, "doing");
const pid7 = await runAgentAT(7);
poll(rootAT, 5);
assert.ok(orchLogAT().includes(`agent pid=${pid7} exited 7 without success, doing -> to-do`), "a non-zero exit is a crash bounce");
assert.equal(parseTask(rootAT, taskAT.file).state, "to-do");
assert.ok(!existsSync(pidPath(rootAT, slugAT)) && !existsSync(exitFilePath(rootAT, slugAT)), "the bounce clears the pid and exit files");
assert.equal(deadCountAT(), "1");

// crash without a code: a hand-written pid file naming a dead pid, no exit file
setState(rootAT, taskAT, "doing");
writeFileSync(pidPath(rootAT, slugAT), "999999 123");
poll(rootAT, 5);
assert.ok(orchLogAT().includes("agent pid=999999 dead without state update, doing -> to-do"), "a missing exit code is a crash bounce too");
assert.equal(parseTask(rootAT, taskAT.file).state, "to-do");
assert.equal(deadCountAT(), "2");
assert.ok(readFileSync(join(kanbanDir(rootAT), ".logs", `${slugAT}.developer.0.dead`), "utf8").trim() === "999999", "the bounce names the dying run in the per-run death marker");

// success: exit 0 moves the task itself (doing -> to-review), clears both files, resets the
// dead streak
setState(rootAT, taskAT, "doing");
await runAgentAT(0);
poll(rootAT, 5);
assert.ok(orchLogAT().includes(`${slugAT}: agent exited 0, doing -> to-review`), "a successful finish moves the task itself");
assert.equal(parseTask(rootAT, taskAT.file).state, "to-review");
assert.ok(!existsSync(pidPath(rootAT, slugAT)) && !existsSync(exitFilePath(rootAT, slugAT)), "the success clears the pid and exit files");
assert.equal(deadCountAT(), "0", "a completed run clears the dead-agent counter");

// a reviewer that exits 0 without moving the task is a failed run: the poll bounces it to
// to-review under the crash rules, so reviewing never holds a slot with no live agent. The
// exit file clears on every path, so the next pass reads no stale code
setState(rootAT, taskAT, "reviewing");
writeFileSync(join(kanbanDir(rootAT), ".logs", `${slugAT}.reviewer.0.log`), JSON.stringify({ type: "message_end", message: { role: "assistant", content: "review done" } }) + "\n");
writeFileSync(exitFilePath(rootAT, slugAT), "0");
poll(rootAT, 5);
assert.ok(
	orchLogAT().includes(`${slugAT}: reviewer exited 0 with the task still in reviewing, reviewing -> to-review`),
	"the reviewer's exit 0 with the task still reviewing is a bounce, not a PM hand-off",
);
assert.equal(parseTask(rootAT, taskAT.file).state, "to-review");
assert.ok(existsSync(join(kanbanDir(rootAT), ".logs", `${slugAT}.reviewer.0.dead`)), "the no-move run carries its .dead marker");
assert.equal(deadCountAT(), "1", "the no-move bounce bumps the dead-agent counter");
assert.ok(!existsSync(exitFilePath(rootAT, slugAT)), "the bounce clears the exit file");
poll(rootAT, 5);
assert.equal(parseTask(rootAT, taskAT.file).state, "to-review", "the second poll in to-review does not bounce again");
assert.ok(!orchLogAT().includes("agent pid=0 dead without state update"), "no spurious dead-pid bounce for the pid-less to-review task");
console.log("orchestrator.test.ts: ... + exit-code file smoke passed");
