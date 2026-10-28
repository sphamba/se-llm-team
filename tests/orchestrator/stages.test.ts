import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, kanbanDir, parseTask, setState, setWorktree, taskSlug } from "../../src/kanban.ts";
import { loadConfig } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import { armedPath } from "../../src/orchestrator/log.ts";
import { pidPath } from "../../src/pid.ts";
import { cleaned, deadStub, fixture } from "../helpers.ts";

// the stage toggles: reviews and liveTesting. Both default on, and each
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

// --- part 1: both stages are on by default, an explicit false turns one off, and a
// non-boolean value warns and keeps the default ---
const root1 = fixture();
cleaned.push(root1);
const default1 = cfgFor(root1, {});
assert.equal(default1.reviews, true, "reviews default on");
assert.equal(default1.liveTesting, true, "liveTesting default on");
const off1 = cfgFor(root1, { reviews: false, liveTesting: false });
assert.equal(off1.reviews, false, "a configured reviews false applies");
assert.equal(off1.liveTesting, false, "a configured liveTesting false applies");
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

// --- part 4: autoMerge defaults on, a string value warns and keeps the default, and a project
// false overrides a global true ---
const root4 = fixture();
cleaned.push(root4);
const default4 = cfgFor(root4, {});
assert.equal(default4.autoMerge, true, "autoMerge defaults on");
const invalid4 = cfgFor(root4, { autoMerge: "false" });
assert.equal(invalid4.autoMerge, true, "a string autoMerge keeps the default on");
assert.ok(orchLog(root4).includes('autoMerge "false" ignored: must be a boolean'), "a string autoMerge warned about");
const home4 = mkdtempSync(join(tmpdir(), "orch-home-automerge-"));
cleaned.push(home4);
mkdirSync(join(home4, ".se-llm-team"), { recursive: true });
writeFileSync(join(home4, ".se-llm-team", "config.json"), JSON.stringify({ autoMerge: true }));
mkdirSync(kanbanDir(root4), { recursive: true });
writeFileSync(join(root4, "se-llm-team.json"), JSON.stringify({ agent: deadStub(root4), autoMerge: false }));
const saved4 = process.env.HOME;
process.env.HOME = home4;
try {
	assert.equal(loadConfig(root4).autoMerge, false, "a project autoMerge false overrides a global true");
} finally {
	if (saved4 === undefined) delete process.env.HOME;
	else process.env.HOME = saved4;
}
console.log("stages.test.ts: ... + autoMerge flag config passed");

console.log("stages.test.ts: stage toggle smoke passed (defaults, reviews off, live testing off)");
