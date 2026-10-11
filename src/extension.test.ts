import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTask, getTask, taskNum } from "./kanban.ts";

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
const { default: extension } = await import("../index.ts");
extension({
	registerTool: (def: any) => { tools[def.name] = def; },
	on: (event: string, handler: () => unknown) => { events[event] = handler; },
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

// the board watcher opened by execute is closed through the shutdown handler
await events["session_shutdown"]?.();
rmSync(root, { recursive: true, force: true });
console.log("extension.test.ts: all assertions passed");
