import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { registerHooks } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { REPORT_MAX_AGE_MS } from "../src/orchestrator/report.ts";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTask, getTask, taskNum } from "../src/kanban.ts";

// pi loads the extension with jiti aliases into its own install (loader.js);
// mirror that resolution so plain node can import the real index.ts
const piRoot = join(dirname(dirname(process.execPath)), "lib", "node_modules", "@earendil-works", "pi-coding-agent");
if (!existsSync(piRoot)) {
	console.log("skip: no pi-coding-agent install, extension tool checks not run");
	process.exit(0);
}
const piIndexUrl = pathToFileURL(join(piRoot, "index.js")).href;

const root = mkdtempSync(join(tmpdir(), "extension-test-"));
const fail = (msg: string) => {
	rmSync(root, { recursive: true, force: true });
	console.error(msg);
	process.exit(1);
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "typebox" || specifier === "typebox/compile" || specifier === "@earendil-works/pi-ai") {
			return nextResolve(specifier, { ...context, parentURL: piIndexUrl });
		}
		return nextResolve(specifier, context);
	},
});

const tools: Record<string, any> = {};
const events: Record<string, () => unknown> = {};
const sent: Array<{ message: any; options: any }> = [];
const { default: extension } = await import("../index.ts");
extension({
	registerTool: (def: any) => { tools[def.name] = def; },
	on: (event: string, handler: () => unknown) => { events[event] = handler; },
	sendMessage: (message: any, options: any) => { sent.push({ message, options }); },
} as any);

const ctx = { cwd: root, hasUI: false, ui: { notify: () => {} } } as any;
const taskFile = (file: string) => join(root, ".kanban", file);
const run = (def: any, params: any) => def.execute("t1", params, undefined, undefined, ctx);

// kanban_update is registered and rejects unknown fields at the schema level,
// the validator pi runs before execute (typebox Compile) fails the call, so an
// unrecognized parameter (e.g. notes) errors instead of a false "Updated"
const update = tools["kanban_update"];
if (!update) fail("kanban_update not registered");
assert.equal(update.parameters.additionalProperties, false);
const { Compile } = await import("typebox/compile");
const validator = Compile(update.parameters);
assert.equal(validator.Check({ file: "000001_x.md", notes: "anything" }), false, "unknown field must fail validation");
assert.ok([...validator.Errors({ file: "000001_x.md", notes: "anything" })].some((e: any) => e.keyword === "additionalProperties"));
assert.equal(validator.Check({ file: "000001_x.md", summary: "s", notes: "anything" }), false, "mixed call must fail validation too");

// kanban_create gets the same guard: an unsupported field (e.g. notes) must fail
// pi's validator instead of being dropped while the tool reports "Created"
const create = tools["kanban_create"];
if (!create) fail("kanban_create not registered");
assert.equal(create.parameters.additionalProperties, false);
const createValidator = Compile(create.parameters);
assert.equal(createValidator.Check({ name: "feat: x", summary: "s", notes: "anything" }), false, "unknown field must fail validation");
assert.ok([...createValidator.Errors({ name: "feat: x", summary: "s", notes: "anything" })].some((e: any) => e.keyword === "additionalProperties"));
assert.equal(createValidator.Check({ name: "feat: x", summary: "s", priority: "high", complexity: "complex", issuer: "#42", specs: "s", openQuestions: "q", blockedBy: "#42" }), true, "all supported fields must pass validation");
assert.equal(createValidator.Check({ name: "feat: x", summary: "s", complexity: "trivial" }), true, "trivial complexity passes validation");
assert.equal(createValidator.Check({ name: "feat: x", summary: "s", complexity: "nope" }), false, "unknown complexity fails validation");

// execute with all supported fields keeps the "Created <file> (#N)" response
const created = await run(create, { name: "feat: create guard", summary: "s", priority: "high", complexity: "complex", issuer: "#42", specs: "s", openQuestions: "q", blockedBy: "#42" });
assert.equal(created.content[0].text, `Created ${created.details.file} (#${taskNum(created.details.file)})`, "all-supported call must keep the Created response");
assert.equal(getTask(root, created.details.file)?.issuer, "#42", "supported fields must still be written");

// kanban_set_state and kanban_set_worktree are strict too, an unrecognized
// field errors before execute instead of a dropped, silently-ignored param
const strict = (name: string) => {
	const tool = tools[name];
	if (!tool) fail(`${name} not registered`);
	assert.equal(tool.parameters.additionalProperties, false, `${name} must reject unknown fields`);
	const v = Compile(tool.parameters);
	const bad = { file: "000001_x.md", notes: "anything" } as any;
	assert.equal(v.Check(bad), false, `${name} unknown field must fail validation`);
	assert.ok([...v.Errors(bad)].some((e: any) => e.keyword === "additionalProperties"), `${name} must name the offending field`);
	return v;
};
const stateValidator = strict("kanban_set_state");
const worktreeValidator = strict("kanban_set_worktree");

// valid calls keep the current behavior and response, including the empty-string worktree clear
const t2 = createTask(root, { name: "feat: strict setters", summary: "before" });
assert.equal(stateValidator.Check({ file: t2.file, state: "doing" }), true);
assert.equal(worktreeValidator.Check({ file: t2.file, worktree: "" }), true);
const setStateTool = tools["kanban_set_state"];
const setWorktreeTool = tools["kanban_set_worktree"];
assert.equal((await run(setStateTool, { file: t2.file, state: "doing" })).content[0].text, `${t2.file} (#${taskNum(t2.file)}): state -> doing`);
assert.equal(getTask(root, t2.file)?.state, "doing");
assert.equal((await run(setWorktreeTool, { file: t2.file, worktree: "feat/1-x" })).content[0].text, `${t2.file} (#${taskNum(t2.file)}): worktree -> feat/1-x`);
assert.equal(getTask(root, t2.file)?.worktree, "feat/1-x");
await run(setWorktreeTool, { file: t2.file, worktree: "" });
assert.equal(getTask(root, t2.file)?.worktree ?? "", "", "empty worktree must clear the attribute");

// kanban_set_state and kanban_get resolve the task from the cwd SPECS.md symlink when the
// file is omitted, and report no task without one
assert.equal(stateValidator.Check({ state: "doing" }), true, "file is optional on kanban_set_state");
assert.equal((await run(setStateTool, { state: "to-review" })).content[0].text, "no task; pass the file name or run from a worktree with SPECS.md");
symlinkSync(join(".kanban", t2.file), join(root, "SPECS.md"));
assert.equal((await run(setStateTool, { state: "to-review" })).content[0].text, `${t2.file} (#${taskNum(t2.file)}): state -> to-review`);
assert.equal(getTask(root, t2.file)?.state, "to-review");
assert.equal(JSON.parse((await run(tools["kanban_get"], {})).content[0].text).file, t2.file, "kanban_get resolves from the cwd symlink");

// a call with only file updates nothing and says so instead of claiming an update
const t1 = createTask(root, { name: "feat: update guard", summary: "before" });
const before = readFileSync(taskFile(t1.file), "utf8");
const empty = await run(update, { file: t1.file });
assert.equal(empty.content[0].text, `Nothing to update in ${t1.file}`);
assert.equal(readFileSync(taskFile(t1.file), "utf8"), before, "empty patch must not touch the file");

// recognized fields keep the "Updated <file> (#NN)" response and write the change
const updated = await run(update, { file: t1.file, summary: "after" });
assert.equal(updated.content[0].text, `Updated ${t1.file} (#${taskNum(t1.file)})`);
assert.notEqual(readFileSync(taskFile(t1.file), "utf8"), before);
assert.equal(getTask(root, t1.file)?.summary, "after");

// PM report queue: a repo-root session drains .kanban/.reports oldest first and deletes
// each delivered report, a stale one is discarded at startup, a busy session gets the
// report as a follow-up, and a linked-worktree session never consumes (git-topology gate)
const reportsRoot = mkdtempSync(join(tmpdir(), "extension-reports-"));
execSync("git init -q", { cwd: reportsRoot });
execSync("git config user.email t@t && git config user.name t && git config commit.gpgsign false", {
	cwd: reportsRoot,
	shell: "/bin/bash",
});
writeFileSync(join(reportsRoot, "README.md"), "x\n");
execSync("git add -A && git commit -qm init", { cwd: reportsRoot, shell: "/bin/bash" });
const reportsPath = join(reportsRoot, ".kanban", ".reports");
mkdirSync(reportsPath, { recursive: true });
const reportOld = join(reportsPath, "2020-01-01T00-00-00-000Z.md");
const reportNew = join(reportsPath, "2020-01-02T00-00-00-000Z.md");
writeFileSync(reportOld, "# Board report\nfirst\n");
writeFileSync(reportNew, "# Board report\nsecond\n");
const staleReport = join(reportsPath, "2019-12-31T00-00-00-000Z.md");
writeFileSync(staleReport, "# Board report\nstale\n");
const aged = new Date(Date.now() - REPORT_MAX_AGE_MS - 60_000);
utimesSync(staleReport, aged, aged);
const idleCtx = { cwd: reportsRoot, hasUI: true, isIdle: () => true, ui: { notify: () => {} } } as any;
await events["session_start"]?.({ type: "session_start", reason: "startup" }, idleCtx);
assert.equal(sent.length, 2, "the root session drains the queue oldest first");
assert.equal(sent[0].message.customType, "board-report");
assert.match(sent[0].message.content, /first/);
assert.match(sent[1].message.content, /second/);
assert.deepEqual(sent[0].options, { triggerTurn: true }, "an idle session gets the report as its next turn");
assert.ok(!existsSync(reportOld) && !existsSync(reportNew), "delivered reports are deleted");
assert.ok(!existsSync(staleReport), "a stale report is discarded at startup");
// drop the dir so the later scenarios run without a live reports watcher interfering
rmSync(reportsPath, { recursive: true, force: true });
// a busy session gets the report as a follow-up instead of a turn trigger
mkdirSync(reportsPath, { recursive: true });
writeFileSync(reportOld, "# Board report\nbusy\n");
sent.length = 0;
await events["session_start"]?.({ type: "session_start", reason: "new" }, { ...idleCtx, isIdle: () => false } as any);
assert.equal(sent.length, 1, "the busy session consumes the report");
assert.deepEqual(sent[0].options, { deliverAs: "followUp" }, "a busy session gets the report as a follow-up");
// a linked-worktree session shares the board through the symlink but never consumes
execSync("git worktree add -q -b feat/session .worktrees/feat/session", { cwd: reportsRoot, shell: "/bin/bash" });
const wtReports = join(reportsRoot, ".worktrees", "feat/session");
symlinkSync(join(reportsRoot, ".kanban"), join(wtReports, ".kanban"));
writeFileSync(reportNew, "# Board report\nqueued\n");
sent.length = 0;
await events["session_start"]?.({ type: "session_start", reason: "new" }, { ...idleCtx, cwd: wtReports } as any);
assert.equal(sent.length, 0, "a worktree session never consumes reports");
assert.ok(existsSync(reportNew), "the report stays queued for the root session");
rmSync(reportsRoot, { recursive: true, force: true });

// the board watcher opened by execute is closed through the shutdown handler
await events["session_shutdown"]?.();
rmSync(root, { recursive: true, force: true });
console.log("extension.test.ts: all assertions passed");
