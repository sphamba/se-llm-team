import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTask, listTasks, setState, taskSlug } from "../src/kanban.ts";
import { TOOLS } from "../src/tools.ts";
import { cleaned, fixture } from "./helpers.ts";

const root = fixture();
cleaned.push(root);

const done1 = createTask(root, { name: "feat: processed thing", summary: "s" });
setState(root, done1, "done");
const done2 = createTask(root, { name: "fix: unprocessed thing", summary: "s" });
setState(root, done2, "done");
const wip = createTask(root, { name: "chore: wip thing", summary: "s" });
// the marker path pinned verbatim from the contract, not read back from src
const marker = (file: string) => join(root, ".kanban", ".logs", taskSlug(file) + ".pm-processed");
const ctx = { cwd: root, defaultAgent: "pi" };

// scope=unprocessed: done tasks with no marker, not-done tasks never returned
assert.deepEqual(listTasks(root, "unprocessed").map((t) => t.file).sort(), [done1.file, done2.file].sort());
assert.ok(!listTasks(root, "unprocessed").some((t) => t.file === wip.file), "not-done tasks never match unprocessed");

// the tool marks a done task: empty marker file at the pinned .logs path, result names it
const marked = await TOOLS.kanban_mark_processed.run({ files: [done1.file] }, ctx);
assert.ok(existsSync(marker(done1.file)), "marker written at .kanban/.logs/<slug>.pm-processed");
assert.equal(statSync(marker(done1.file)).size, 0, "the marker is an empty file");
assert.ok(marked.text.includes(done1.file), "the result names the marked task");

// the marked task leaves the unprocessed scope
assert.deepEqual(listTasks(root, "unprocessed").map((t) => t.file), [done2.file]);

// scope=unprocessed through the kanban_list tool
const listed = await TOOLS.kanban_list.run({ scope: "unprocessed" }, ctx);
const refs = JSON.parse(listed.text);
assert.deepEqual(refs.map((t: any) => t.file), [done2.file]);

// a not-done task and a missing task are skipped and named, no marker written
const mixed = await TOOLS.kanban_mark_processed.run({ files: [wip.file, done2.file, "999999_missing.md"] }, ctx);
assert.ok(!existsSync(marker(wip.file)), "no marker for a not-done task");
assert.ok(!existsSync(marker("999999_missing.md")), "no marker for a missing task");
assert.ok(mixed.text.includes(wip.file), "the result names the skipped not-done task");
assert.ok(mixed.text.includes("999999_missing.md"), "the result names the skipped missing task");
assert.ok(mixed.text.includes(done2.file), "the result names the marked task");

// every done task marked: the unprocessed scope is empty, done keeps both
assert.deepEqual(listTasks(root, "unprocessed").map((t) => t.file), []);
assert.deepEqual(listTasks(root, "done").map((t) => t.file).sort(), [done1.file, done2.file].sort());

// idempotent re-mark
await TOOLS.kanban_mark_processed.run({ files: [done1.file] }, ctx);
assert.ok(existsSync(marker(done1.file)), "re-marking is idempotent");

console.log("tools.test.ts: all assertions passed");
