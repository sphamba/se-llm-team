import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, kanbanDir, listAll, parseTask, setState, setWorktree, taskSlug } from "../../src/kanban.ts";
import { loadConfig } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import { armedPath } from "../../src/orchestrator/log.ts";
import { readMergerSlug } from "../../src/orchestrator/spawn.ts";
import { pidPath } from "../../src/pid.ts";
import { cleaned, deadStub, fixture } from "../helpers.ts";

// the stage toggles: reviews, liveTesting, and integrationTesting. All default on, and each
// one off removes its stage from the pipeline without touching the others. Direct-drive
// rescan on fixture roots: the dead stub proves no agent was spawned.

// the project config for one part, loaded with an empty temp HOME so the ambient user config
// never leaks in
const cfgFor = (root: string, extra: Record<string, unknown>) => {
	mkdirSync(kanbanDir(root), { recursive: true });
	writeFileSync(join(root, "se-llm-team.json"), JSON.stringify({ agent: deadStub(root), backlogIdleMinutes: 0, ...extra }));
	const home = mkdtempSync(join(tmpdir(), "orch-home-"));
	cleaned.push(home);
	const saved = process.env.HOME;
	process.env.HOME = home;
	try {
		return loadConfig(root);
	} finally {
		if (saved === undefined) delete process.env.HOME;
		else process.env.HOME = saved;
	}
};
const orchLog = (root: string) => readFileSync(join(kanbanDir(root), ".logs", "orchestrator.log"), "utf8");
const integrationTasks = (root: string) => listAll(root).filter((t) => t.name.startsWith("test: integration of "));

// --- part 1: all three stages are on by default, an explicit false turns one off, and a
// non-boolean value warns and keeps the default ---
const root1 = fixture();
cleaned.push(root1);
const default1 = cfgFor(root1, {});
assert.equal(default1.reviews, true, "reviews default on");
assert.equal(default1.liveTesting, true, "liveTesting default on");
assert.equal(default1.integrationTesting, true, "integrationTesting default on");
const off1 = cfgFor(root1, { reviews: false, liveTesting: false, integrationTesting: false });
assert.equal(off1.reviews, false, "a configured reviews false applies");
assert.equal(off1.liveTesting, false, "a configured liveTesting false applies");
assert.equal(off1.integrationTesting, false, "a configured integrationTesting false applies");
const invalid1 = cfgFor(root1, { reviews: "no" });
assert.equal(invalid1.reviews, true, "a non-boolean reviews keeps the default on");
assert.ok(orchLog(root1).includes('reviews "no" ignored: must be a boolean'), "a non-boolean reviews warned about");
console.log("stages.test.ts: ... + stage flag config passed");

// --- part 2: reviews off sends a to-review task straight to to-merge, with no reviewer spawn
// and no armed marker ---
const root2 = fixture();
cleaned.push(root2);
const cfg2 = cfgFor(root2, { reviews: false });
const task2 = createTask(root2, { name: "feat: no review", summary: "Reviews off.", specs: "n/a" });
setState(root2, task2, "to-review");
rescan(root2, cfg2);
assert.equal(parseTask(root2, task2.file).state, "to-merge", "reviews off moves to-review straight to to-merge");
assert.equal(existsSync(pidPath(root2, taskSlug(task2.file))), false, "reviews off spawns no reviewer");
assert.equal(existsSync(armedPath(root2, taskSlug(task2.file))), false, "reviews off arms no reviewer run");
assert.ok(orchLog(root2).includes(`${task2.file}: reviews are off, moving to to-merge`), "the skip is logged");
console.log("stages.test.ts: ... + reviews off skips the reviewer passed");

// --- part 3: live-testing off sends a merged to-live-test task straight to done, with no
// live-tester spawn ---
const root3 = fixture();
cleaned.push(root3);
const cfg3 = cfgFor(root3, { liveTesting: false });
execSync("git branch stage-live-off", { cwd: root3, shell: "/bin/bash" });
const task3 = createTask(root3, { name: "feat: no live test", summary: "Live testing off.", specs: "n/a" });
setWorktree(root3, task3, "stage-live-off");
setState(root3, task3, "to-live-test");
rescan(root3, cfg3);
assert.equal(parseTask(root3, task3.file).state, "done", "live testing off moves to-live-test straight to done");
assert.equal(existsSync(pidPath(root3, taskSlug(task3.file))), false, "live testing off spawns no live-tester");
assert.ok(orchLog(root3).includes(`${task3.file}: live testing is off, set done`), "the skip is logged");
console.log("stages.test.ts: ... + live testing off skips the live-tester passed");

// --- part 4: integration-testing off still merges the branch but opens no integration task ---
const root4 = fixture();
cleaned.push(root4);
const cfg4 = cfgFor(root4, { integrationTesting: false });
execSync("git checkout -qb feat/stage-off && git commit -q --allow-empty -m off && git checkout -q main", { cwd: root4, shell: "/bin/bash" });
const task4 = createTask(root4, { name: "feat: no integration task", summary: "Integration testing off.", specs: "n/a" });
setWorktree(root4, task4, "feat/stage-off");
setState(root4, task4, "to-merge");
rescan(root4, cfg4);
assert.equal(parseTask(root4, task4.file).state, "to-live-test", "the merge still fast-forwards and sets to-live-test");
assert.equal(integrationTasks(root4).length, 0, "no integration task is created");
assert.equal(listAll(root4).length, 1, "the board holds only the merged task");
assert.ok(orchLog(root4).includes(`${task4.file}: integration testing is off, no integration task queued`), "the skip is logged");
console.log("stages.test.ts: ... + integration testing off skips the integration task passed");

// --- part 5: with integration testing off the integration sweep holds a waiting task in
// to-integration-test: no state move, no merger slug, no integration-tester pid or armed file,
// and no log line per rescan. With the flag on the same seed starts the run ---
const root5 = fixture();
cleaned.push(root5);
const cfg5 = cfgFor(root5, { integrationTesting: false });
const task5 = createTask(root5, { name: "test: integration of #5", summary: "Held.", specs: "n/a" });
setState(root5, task5, "to-integration-test");
rescan(root5, cfg5);
assert.equal(parseTask(root5, task5.file).state, "to-integration-test", "integration testing off holds the waiting task in to-integration-test");
assert.equal(readMergerSlug(root5, "integration-tester"), null, "the hold writes no integration-tester slug");
assert.equal(existsSync(pidPath(root5, "integration-tester")), false, "the hold spawns no integration-tester");
assert.equal(existsSync(armedPath(root5, taskSlug(task5.file))), false, "the hold arms no integration run");
rescan(root5, cfg5);
assert.equal(parseTask(root5, task5.file).state, "to-integration-test", "the hold survives the next rescan");
const log5Path = join(kanbanDir(root5), ".logs", "orchestrator.log");
assert.ok(!existsSync(log5Path) || !readFileSync(log5Path, "utf8").split("\n").some((l) => l.includes(task5.file)), "the hold writes no log line for the held task");
const root5b = fixture();
cleaned.push(root5b);
const cfg5b = cfgFor(root5b, { integrationTesting: true });
const task5b = createTask(root5b, { name: "test: integration of #6", summary: "Runs.", specs: "n/a" });
setState(root5b, task5b, "to-integration-test");
rescan(root5b, cfg5b);
assert.equal(parseTask(root5b, task5b.file).state, "integration-testing", "with integration testing on the same seed starts the run");
assert.equal(readMergerSlug(root5b, "integration-tester"), taskSlug(task5b.file), "the on case records the integration-tester slug");
console.log("stages.test.ts: ... + the integration gate holds a waiting task passed");

console.log("stages.test.ts: stage toggle smoke passed (defaults, reviews off, live testing off, integration testing off, integration gate hold)");
