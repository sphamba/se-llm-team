// #457 the integrated changes-map trigger: the flag the backend serves (/api/task-changes) and the
// Map row the page renders agree across the run window (idle, in flight, landed, run died with no
// map), so neither half can drift from the other without a red suite
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, taskSlug, updateAttrs } from "../../src/kanban.ts";
import { clearPid, writePid } from "../../src/pid.ts";
import { PAGE } from "../../src/webui.ts";
import { taskChangesPayload } from "../../src/webui/payload.ts";
import { esc } from "../../src/webui/logpane.ts";

const root = mkdtempSync(join(tmpdir(), "webui-map-trigger-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

const task = createTask(root, { name: "feat: map trigger", summary: "s" });
updateAttrs(root, task, { worktree: "feat/1-map" });
const num = parseInt(task.file, 10);
const slug = taskSlug(task.file);
const row = { ...getTask(root, task.file), worktree: "feat/1-map" };
const mapSection = {
	files: [{ path: "src/hub.ts", symbols: [{ name: "taskMap", kind: "fn", ins: 3, del: 0, isNew: true }] }],
	flows: [{ from: "src/hub.ts", to: "src/webui/payload.ts", what: "the map flag" }],
	role: "developer", run: 2, model: "gpt-5.1-codex", at: new Date().toISOString(), head: "abc1234",
};

// the page's Map row, extracted from the served template exactly like the page suite does
const factsSrc = PAGE.slice(PAGE.indexOf("// the changes block"), PAGE.indexOf("// the actions:"));
const makeRow = (payload: any, fetchLog: string[] = []) => {
	const el: any = { __html: undefined, querySelectorAll: () => [] };
	const api = new Function("esc", "numOf", "issuerCell", "blockedRow", "document", "fetch", "projectParam", "visible", "openTask", "writeGated",
		"let openDetail = null;\n" + factsSrc +
		"\n; return { factsHtml: factsHtml, loadChanges: loadChanges, cache: changesCache, set open(v) { openDetail = v; } };")(
		esc, (f: string) => parseInt(f.slice(0, 6), 10), () => "user", () => "",
		{ getElementById: (id: string) => (id === "p-facts" ? el : null) },
		(u: string) => { fetchLog.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }); },
		() => "", () => true, () => {}, () => true,
	);
	api.open = row;
	return api;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const render = async (payload: any) => {
	const fetchLog: string[] = [];
	const api = makeRow(payload, fetchLog);
	api.loadChanges(task.file);
	await tick();
	assert.deepEqual(fetchLog, [`/api/task-changes?num=${num}`], "the row reads the same endpoint the backend serves");
	return api.factsHtml(row);
};

// idle: no branch data, no map, no live run -> the idle row with the trigger
assert.match(await render(await taskChangesPayload(root, num)), /<span class='k'>map<\/span><span class='chg-none'>not computed<\/span> <button class='m-action m-map' onclick='computeMap\(this\)'>compute<\/button>/, "a fresh task with a branch and no map shows not computed and the compute button");

// in flight: a live map-run pid flips mapRunning true and the row pulses without dropping the map
updateAttrs(root, task, { map: JSON.stringify(mapSection) });
writePid(root, `${slug}.mapper.0.analysis`, process.pid);
const livePayload = await taskChangesPayload(root, num);
assert.equal(livePayload.mapRunning, true, "the backend serves mapRunning true while the map run's pid is alive");
assert.equal(livePayload.map.files[0].symbols[0].name, "taskMap", "the in-flight payload still carries the ledger");
const updating = await render(await taskChangesPayload(root, num));
assert.match(updating, /<span class='spin'><\/span><span class='chg-upd'>updating\u2026<\/span>/, "a recompute in flight shows the pulse and updating");
assert.ok(updating.includes("chg-map") && updating.includes("1 symbol"), "the old ledger survives the updating pulse");
assert.ok(!updating.includes("compute</button>"), "the pulse replaces the button, so a second trigger is impossible");

// landed: the pid clears with the map written -> no pulse, the ledger renders from the new payload
clearPid(root, `${slug}.mapper.0.analysis`);
const landed = await taskChangesPayload(root, num);
assert.equal(landed.mapRunning, false, "mapRunning reads false once the run exits");
const landedHtml = await render(landed);
assert.ok(!landedHtml.includes("updating\u2026") && landedHtml.includes("1 symbol"), "the landed map renders with no pulse and no reload");

// the run died without writing a map -> the row falls back to the idle state
const deadTask = createTask(root, { name: "feat: dead map run", summary: "s" });
updateAttrs(root, deadTask, { worktree: "feat/2-map" });
const deadSlug = taskSlug(deadTask.file);
writePid(root, `${deadSlug}.mapper.1.analysis`, 999999);
const dead = await taskChangesPayload(root, parseInt(deadTask.file, 10));
assert.equal(dead.mapRunning, false, "a dead run pid reads as idle");
assert.equal(dead.map, undefined, "a failed run writes no map");
const deadRow = { ...getTask(root, deadTask.file), worktree: "feat/2-map" };
const deadHtml = await (async () => {
	const api = makeRow(dead);
	api.open = deadRow;
	api.loadChanges(deadTask.file);
	await tick();
	return api.factsHtml(deadRow);
})();
assert.match(deadHtml, /not computed<\/span> <button class='m-action m-map'/, "a failed run without a map falls back to not computed with the compute button");
clearPid(root, `${deadSlug}.mapper.1.analysis`);

// a done task without a branch offers no button, whatever the payload says
const done = makeRow({ ...landed, mapRunning: false });
assert.ok(!done.factsHtml({ ...row, state: "done", worktree: "" }).includes("compute</button>"), "a done task without a branch renders no compute button");

console.log("changes-map-trigger.test.ts: all assertions passed");
