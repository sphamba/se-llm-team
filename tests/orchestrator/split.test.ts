import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTask, kanbanDir, parseTask, setState, taskNum } from "../../src/kanban.ts";
import { fixture, roleStub, runDaemon, waitFor, cleaned } from "../helpers.ts";

// --- part BA: the split path. A moderate to-do task whose Splitter stub splits: two subtasks
// land in to-do, the parent moves to backlog with the subtask refs in blockedBy and complexity
// simple, and re-promotes once the stubbed subtasks complete ---
const rootBA = fixture();
cleaned.push(rootBA);
mkdirSync(join(kanbanDir(rootBA), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootBA), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBA), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskBA = createTask(rootBA, { name: "feat: split me", summary: "Splitter split smoke", specs: "splitter-split" });
setState(rootBA, taskBA, "to-do");
const ba = await runDaemon(rootBA);
const filesBA = ["999001_piece_one.md", "999002_piece_two.md"];
const subBA = (f: string) => {
	try {
		return parseTask(rootBA, f);
	} catch {
		return undefined;
	}
};
await waitFor(
	() => filesBA.every((f) => subBA(f)?.state === "to-do") && parseTask(rootBA, taskBA.file).state === "backlog",
	30000,
	"the splitter split the parent into to-do subtasks",
	ba.output,
);
assert.ok(ba.output().includes("spawned splitter"), "the splitter ran");
const parentBA = parseTask(rootBA, taskBA.file);
assert.equal(parentBA.blockedBy, "#999001, #999002", "the parent blocks on the two subtask refs");
assert.equal(parentBA.complexity, "simple", "the parent's complexity dropped to simple");
assert.equal(subBA(filesBA[0])?.issuer, `#${taskNum(taskBA.file)}`, "the subtask issuer is the parent number");
// the subtasks run as developers (simple path) and finish; the parent re-promotes once both are done
await waitFor(() => parseTask(rootBA, taskBA.file).state === "done", 90000, "the parent re-promoted and finished after the subtasks", ba.output);
ba.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + splitter split path smoke passed");

// --- part BB: the no-split path. A moderate to-do task whose Splitter stub declines: the
// splitter exits 0 without touching state, and the orchestrator starts the Developer ---
const rootBB = fixture();
cleaned.push(rootBB);
mkdirSync(join(kanbanDir(rootBB), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootBB), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBB), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskBB = createTask(rootBB, { name: "feat: no split", summary: "Splitter no-split smoke", specs: "splitter-nosplit" });
setState(rootBB, taskBB, "to-do");
const bb = await runDaemon(rootBB);
await waitFor(() => parseTask(rootBB, taskBB.file).state === "done", 90000, "the no-split task finished via the developer", bb.output);
const bbOut = bb.output();
assert.ok(bbOut.includes("spawned splitter"), "the splitter ran first");
assert.equal(bbOut.split("spawned splitter").length - 1, 1, "exactly one splitter spawn");
assert.ok(bbOut.includes("spawned developer"), "the developer followed the no-split exit");
assert.equal(parseTask(rootBB, taskBB.file).complexity, "moderate", "the no-split task keeps its complexity");
bb.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + splitter no-split path smoke passed");

// --- part BC: a crashed splitter (exit 1) leaves the task in to-do: the dead splitter pid
// file routes the next sweep straight to the Developer, with no second splitter spawn and no
// dead-counter bump ---
const rootBC = fixture();
cleaned.push(rootBC);
mkdirSync(join(kanbanDir(rootBC), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootBC), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBC), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskBC = createTask(rootBC, { name: "feat: splitter crash", summary: "Splitter crash smoke", specs: "splitter-crash" });
setState(rootBC, taskBC, "to-do");
const bc = await runDaemon(rootBC);
await waitFor(() => parseTask(rootBC, taskBC.file).state === "done", 90000, "the crashed splitter fell back to the developer", bc.output);
const bcOut = bc.output();
assert.equal(bcOut.split("spawned splitter").length - 1, 1, "exactly one splitter spawn, no respawn after the crash");
assert.ok(bcOut.includes("spawned developer"), "the developer followed the crash");
assert.ok(!existsSync(join(kanbanDir(rootBC), ".logs", `${taskBC.file.replace(/\.md$/, "")}.dead.count`)), "the splitter crash bumped no dead counter");
bc.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + crashed splitter fallback smoke passed");

// --- part BD: no double spawn while the Splitter pid is alive. The splitter stub lingers
// 3 s: the next sweep sees the live pid and defers, and only the exit routes the task on ---
const rootBD = fixture();
cleaned.push(rootBD);
mkdirSync(join(kanbanDir(rootBD), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootBD), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBD), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskBD = createTask(rootBD, { name: "feat: splitter lingers", summary: "Splitter linger smoke", specs: "splitter-linger" });
setState(rootBD, taskBD, "to-do");
const bd = await runDaemon(rootBD);
await waitFor(() => bd.output().includes("spawned splitter"), 30000, "the splitter spawned", bd.output);
await new Promise((r) => setTimeout(r, 400));
const bdOut = bd.output();
assert.equal(bdOut.split("spawned splitter").length - 1, 1, "one splitter spawn while it lingers, no second");
assert.equal(parseTask(rootBD, taskBD.file).state, "to-do", "the task stays in to-do while the splitter runs");
await waitFor(() => parseTask(rootBD, taskBD.file).state === "done", 90000, "the lingered splitter fell through to the developer", bd.output);
assert.equal(bd.output().split("spawned splitter").length - 1, 1, "still one splitter spawn after the fallback");
bd.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + splitter linger guard smoke passed");

// --- part BE: a simple task never meets the Splitter: straight to the Developer ---
const rootBE = fixture();
cleaned.push(rootBE);
mkdirSync(join(kanbanDir(rootBE), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootBE), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBE), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskBE = createTask(rootBE, { name: "fix: simple path", summary: "Simple path smoke", specs: "n/a", complexity: "simple" });
setState(rootBE, taskBE, "to-do");
const be = await runDaemon(rootBE);
await waitFor(() => parseTask(rootBE, taskBE.file).state === "done", 90000, "the simple task finished", be.output);
assert.equal(be.output().split("spawned splitter").length - 1, 0, "no splitter spawn for a simple task");
be.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + simple task skips the splitter smoke passed");
