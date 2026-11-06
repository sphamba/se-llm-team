import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, kanbanDir, parseTask, setState, taskNum, taskSlug, updateTask } from "../../src/kanban.ts";
import { loadConfig } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline/index.ts";
import { pidPath } from "../../src/pid.ts";
import { fixture, roleStub, deadStub, runDaemon, waitFor, cleaned } from "../helpers.ts";

// --- part BA: the split path. A moderate to-do task whose Splitter stub splits: two subtasks
// land in to-do, the parent moves to backlog with the subtask refs in blockedBy and complexity
// simple, and re-promotes once the stubbed subtasks complete ---
const rootBA = fixture();
cleaned.push(rootBA);
mkdirSync(join(kanbanDir(rootBA), ".logs"), { recursive: true });
writeFileSync(join(rootBA, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBA), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
assert.ok(!existsSync(join(rootBA, "TASK.md")), "the splitter path leaves no root TASK.md link");
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
writeFileSync(join(rootBB, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBB), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
writeFileSync(join(rootBC, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBC), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
writeFileSync(join(rootBD, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBD), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
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
writeFileSync(join(rootBE, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBE), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskBE = createTask(rootBE, { name: "fix: simple path", summary: "Simple path smoke", specs: "n/a", complexity: "simple" });
setState(rootBE, taskBE, "to-do");
const be = await runDaemon(rootBE);
await waitFor(() => parseTask(rootBE, taskBE.file).state === "done", 90000, "the simple task finished", be.output);
assert.equal(be.output().split("spawned splitter").length - 1, 0, "no splitter spawn for a simple task");
be.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + simple task skips the splitter smoke passed");

// --- part BF: maxParallel caps the developer start: at the cap the to-do task stays in to-do
// for the next rescan, below the cap it starts. rescan driven directly (part AW harness): the
// slot holder is a doing task the rescan loop never touches, and poll is not driven ---
const rootBF = fixture();
cleaned.push(rootBF);
const homeBF = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeBF);
mkdirSync(kanbanDir(rootBF), { recursive: true });
const savedHomeBF = process.env.HOME;
process.env.HOME = homeBF;
let cfgBF: ReturnType<typeof loadConfig>;
try {
	cfgBF = loadConfig(rootBF);
} finally {
	process.env.HOME = savedHomeBF;
}
cfgBF.backlogIdleMinutes = 0;
cfgBF.maxParallel = 1;
cfgBF.agent = deadStub(rootBF);
const holderBF = createTask(rootBF, { name: "fix: working slot", summary: "MaxParallel smoke", specs: "n/a" });
setState(rootBF, holderBF, "doing");
const taskBF = createTask(rootBF, { name: "feat: capped start", summary: "MaxParallel smoke", specs: "n/a", complexity: "simple" });
setState(rootBF, taskBF, "to-do");
rescan(rootBF, cfgBF);
assert.equal(parseTask(rootBF, taskBF.file).state, "to-do", "at the cap the to-do task stays in to-do");
assert.ok(!existsSync(pidPath(rootBF, taskSlug(taskBF.file))), "at the cap no developer spawned");
setState(rootBF, holderBF, "done");
rescan(rootBF, cfgBF);
assert.equal(parseTask(rootBF, taskBF.file).state, "doing", "below the cap the developer started");
assert.ok(existsSync(pidPath(rootBF, taskSlug(taskBF.file))), "below the cap the developer pid file exists");
console.log("orchestrator.test.ts: ... + maxParallel developer cap smoke passed");

// --- part BG: a user hold skips the whole to-do lane: no splitter marker, no worktree and no
// developer spawn, and removing the token restarts the path with the splitter first ---
const rootBG = fixture();
cleaned.push(rootBG);
const homeBG = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeBG);
mkdirSync(kanbanDir(rootBG), { recursive: true });
const savedHomeBG = process.env.HOME;
process.env.HOME = homeBG;
let cfgBG: ReturnType<typeof loadConfig>;
try {
	cfgBG = loadConfig(rootBG);
} finally {
	process.env.HOME = savedHomeBG;
}
cfgBG.backlogIdleMinutes = 0;
cfgBG.agent = deadStub(rootBG);
// a moderate task takes the splitter branch, a simple one the developer fallthrough
const heldSplitBG = createTask(rootBG, { name: "feat: held splitter", summary: "User hold smoke", specs: "n/a", blockedBy: "user" });
setState(rootBG, heldSplitBG, "to-do");
const heldDevBG = createTask(rootBG, { name: "fix: held developer", summary: "User hold smoke", specs: "n/a", complexity: "simple", blockedBy: "USER, #999" });
setState(rootBG, heldDevBG, "to-do");
rescan(rootBG, cfgBG);
assert.equal(parseTask(rootBG, heldSplitBG.file).state, "to-do", "the held moderate task stays in to-do");
assert.equal(parseTask(rootBG, heldDevBG.file).state, "to-do", "the held simple task stays in to-do");
assert.equal(existsSync(pidPath(rootBG, `${taskSlug(heldSplitBG.file)}.splitter`)), false, "no splitter marker file for a held task");
assert.equal(existsSync(pidPath(rootBG, taskSlug(heldSplitBG.file))), false, "no developer pid file for a held moderate task");
assert.equal(existsSync(pidPath(rootBG, taskSlug(heldDevBG.file))), false, "no developer pid file for a held simple task");
updateTask(rootBG, heldSplitBG, { blockedBy: "" });
rescan(rootBG, cfgBG);
assert.equal(parseTask(rootBG, heldSplitBG.file).state, "to-do", "the released task stays to-do while the splitter runs");
assert.ok(existsSync(pidPath(rootBG, `${taskSlug(heldSplitBG.file)}.splitter`)), "the released task restarted with the splitter");
console.log("orchestrator.test.ts: ... + user hold skips the to-do lane smoke passed");

// --- part BH: splitting off. A moderate to-do task skips the Splitter and starts its
// Developer directly, with one log line for the skip ---
const rootBH = fixture();
cleaned.push(rootBH);
const homeBH = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeBH);
mkdirSync(kanbanDir(rootBH), { recursive: true });
const savedHomeBH = process.env.HOME;
process.env.HOME = homeBH;
let cfgBH: ReturnType<typeof loadConfig>;
try {
	cfgBH = loadConfig(rootBH);
} finally {
	process.env.HOME = savedHomeBH;
}
cfgBH.backlogIdleMinutes = 0;
cfgBH.agent = deadStub(rootBH);
cfgBH.splitting = false;
const taskBH = createTask(rootBH, { name: "feat: no splitter", summary: "Splitting off smoke", specs: "n/a" });
setState(rootBH, taskBH, "to-do");
rescan(rootBH, cfgBH);
assert.equal(parseTask(rootBH, taskBH.file).state, "doing", "splitting off starts the developer");
assert.equal(existsSync(pidPath(rootBH, `${taskSlug(taskBH.file)}.splitter`)), false, "splitting off spawns no splitter");
assert.ok(existsSync(pidPath(rootBH, taskSlug(taskBH.file))), "splitting off spawns the developer");
const bhLog = readFileSync(join(kanbanDir(rootBH), ".logs", "orchestrator.log"), "utf8");
assert.ok(bhLog.includes(`${taskBH.file}: splitting is off, moving to the developer`), "the skip is logged");
console.log("orchestrator.test.ts: ... + splitting off skips the splitter smoke passed");

// --- part BI: the splitter-ran attr. A Splitter that declines leaves the task in to-do; the
// daemon writes the marker on the successful exit, and a bounce back to to-do goes straight to
// the Developer with no second splitter spawn ---
const rootBI = fixture();
cleaned.push(rootBI);
mkdirSync(join(kanbanDir(rootBI), ".logs"), { recursive: true });
writeFileSync(join(rootBI, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBI), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskBI = createTask(rootBI, { name: "feat: no split twice", summary: "Splitter marker smoke", specs: "splitter-nosplit" });
setState(rootBI, taskBI, "to-do");
const bi = await runDaemon(rootBI);
await waitFor(() => bi.output().includes("spawned developer"), 30000, "the declined split fell through to the developer", bi.output);
await waitFor(() => parseTask(rootBI, taskBI.file).splitter === "done", 10000, "the daemon marked the completed splitter run", bi.output);
setState(rootBI, parseTask(rootBI, taskBI.file), "to-do");
await waitFor(() => bi.output().split("spawned developer").length - 1 >= 2, 90000, "the marked task went straight to a second developer run", bi.output);
assert.equal(bi.output().split("spawned splitter").length - 1, 1, "exactly one splitter spawn across the bounce-back");
bi.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + splitter marker bounce-back smoke passed");

// --- part BJ: a crashed splitter (exit 1) writes no marker, so a bounce back to to-do retries
// the Splitter once ---
const rootBJ = fixture();
cleaned.push(rootBJ);
mkdirSync(join(kanbanDir(rootBJ), ".logs"), { recursive: true });
writeFileSync(join(rootBJ, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootBJ), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskBJ = createTask(rootBJ, { name: "feat: splitter crash again", summary: "Splitter crash retry smoke", specs: "splitter-crash" });
setState(rootBJ, taskBJ, "to-do");
const bj = await runDaemon(rootBJ);
await waitFor(() => bj.output().includes("spawned developer"), 30000, "the crashed splitter fell back to the developer", bj.output);
await waitFor(() => parseTask(rootBJ, taskBJ.file).state === "done", 90000, "the crash fallback task finished", bj.output);
assert.equal(parseTask(rootBJ, taskBJ.file).splitter, "", "a crashed splitter writes no marker");
assert.equal(bj.output().split("spawned splitter").length - 1, 1, "one splitter run before the bounce-back");
setState(rootBJ, parseTask(rootBJ, taskBJ.file), "to-do");
await waitFor(() => bj.output().split("spawned splitter").length - 1 === 2, 30000, "the unmarked task retried the splitter", bj.output);
bj.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + crashed splitter retry smoke passed");
