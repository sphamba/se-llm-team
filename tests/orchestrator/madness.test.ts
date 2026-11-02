import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTask, kanbanDir, parseTask, setState } from "../../src/kanban.ts";
import { poll } from "../../src/orchestrator.ts";
import { MADNESS_CAP, MADNESS_REPS, MADNESS_TAIL, MADNESS_UNIT, madnessLoop } from "../../src/orchestrator/liveness.ts";
import { readCounter } from "../../src/orchestrator/log.ts";
import { pidAlive } from "../../src/pid.ts";
import { cleaned, fixture, waitFor } from "../helpers.ts";

// --- the detector: a pure function over the log tail ---
assert.deepEqual(madnessLoop("a".repeat(MADNESS_REPS)), { unit: "a", repeats: MADNESS_REPS }, "unit length 1 fires at the cap");
assert.deepEqual(madnessLoop("abc".repeat(MADNESS_REPS)), { unit: "abc", repeats: MADNESS_REPS }, "unit length 3 fires at the cap");
const longUnit = "0123456789abcdefghij";
assert.equal(longUnit.length, MADNESS_UNIT, "the long unit is exactly MADNESS_UNIT chars");
assert.deepEqual(madnessLoop(longUnit.repeat(MADNESS_REPS)), { unit: longUnit, repeats: MADNESS_REPS }, "unit length MADNESS_UNIT fires");
assert.equal(madnessLoop("ab".repeat(MADNESS_REPS - 1)), null, "one repetition short does not fire");
assert.equal(madnessLoop(`${"=".repeat(20)}\n`), null, "a twenty-equals banner line does not fire");
assert.equal(
	madnessLoop('{"type":"message","role":"assistant","text":"reading src/index.ts"}\n{"type":"agent_end"}\n'),
	null,
	"a normal JSON tail does not fire",
);
const pastWindow = `${"note line\n".repeat(MADNESS_TAIL / 5)}${"ab".repeat(MADNESS_REPS)}`;
assert.ok(pastWindow.length > MADNESS_TAIL, "the long tail exceeds the read window");
assert.deepEqual(madnessLoop(pastWindow), { unit: "ab", repeats: MADNESS_REPS }, "a tail longer than the window still detects the loop");

// --- the sweep: a live pid whose newest run log ends degenerate is killed, bounced and counted;
// the MADNESS_CAP-th strike bounces too but holds the task on an open question ---
const root = fixture();
cleaned.push(root);
mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
const task = createTask(root, { name: "fix: looping agent", summary: "Madness smoke", specs: "n/a" });
setState(root, task, "doing");
const slug = task.file.replace(/\.md$/, "");
const pidFile = join(kanbanDir(root), ".pids", `${slug}.pid`);
const orchestratorLog = join(kanbanDir(root), ".logs", "orchestrator.log");
const sleepers: ChildProcess[] = [];
// each strike walks the same path: a fresh live agent behind the pid file (60s bounds the leak
// if the run dies before the cleanup below) and a fresh degenerate run log
const arm = (run: number) => {
	setState(root, parseTask(root, task.file), "doing");
	const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
	sleepers.push(sleeper);
	writeFileSync(pidFile, String(sleeper.pid!));
	writeFileSync(join(kanbanDir(root), ".logs", `${slug}.developer.${run}.log`), `{"type":"message","text":"working"}\n${"z".repeat(MADNESS_REPS * 3)}\n`);
	return sleeper;
};

const first = arm(0);
poll(root, 5, Date.now());
await waitFor(() => !pidAlive(first.pid!), 5000, "looping agent killed", () => "");
assert.equal(parseTask(root, task.file).state, "to-do", "the loop bounced doing -> to-do");
assert.ok(!existsSync(pidFile), "the madness bounce cleared the pid file");
assert.equal(readCounter(root, `${slug}.madness`), 1, "the madness counter bumped");
const madnessLine = readFileSync(orchestratorLog, "utf8").split("\n").find((l) => l.includes("agent log loops"));
assert.ok(madnessLine, "the madness line reached the orchestrator log");
assert.ok(madnessLine.includes(`${slug}: agent log loops (developer run 0,`), "the madness line names task, role and run");
assert.ok(madnessLine.includes(`"z" x${MADNESS_REPS * 3}`), "the madness line names the unit and the repeat count");

const second = arm(1);
poll(root, 5, Date.now());
await waitFor(() => !pidAlive(second.pid!), 5000, "second looping agent killed", () => "");
assert.equal(parseTask(root, task.file).state, "to-do", "the second loop bounced doing -> to-do");
assert.equal(readCounter(root, `${slug}.madness`), 2, "the second strike bumped the madness counter");

const third = arm(2);
poll(root, 5, Date.now());
await waitFor(() => !pidAlive(third.pid!), 5000, "third looping agent killed", () => "");
const held = parseTask(root, task.file);
assert.equal(held.state, "to-do", "the third strike bounces to working.next as usual");
assert.ok(held.blockedBy.toLowerCase().split(",").map((p) => p.trim()).includes("question"), "the third strike set the question hold token");
assert.match(held.openQuestions, /agent output looped 3 times/, "the third strike wrote the open question in the task body");
assert.equal(readCounter(root, `${slug}.madness`), 0, "the third strike cleared the madness counter");
assert.ok(readFileSync(orchestratorLog, "utf8").includes(`${slug}: agent output looped ${MADNESS_CAP} times`), "the third strike logged loudly");

for (const s of sleepers) {
	try {
		s.kill("SIGKILL");
	} catch {
		/* already gone */
	}
}
console.log("orchestrator.test.ts: + madness detection smoke passed");
