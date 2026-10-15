import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// pi loads index.ts with jiti, which resolves @earendil-works/* and typebox from pi's own
// install; the shared handlers import neither, but a plain node import of src/tools.ts
// still needs a spawn stub so the in-process orchestrator_start records its call instead
// of launching a daemon. Installed before the first import, so the named binding of the
// fresh module resolution picks the patch up.
const stubs: Record<string, string> = {
	"node:child_process": `export * from "node:child_process";
export function spawn(cmd, args, opts) {
	(globalThis.__spawnCalls ??= []).push({ cmd, args, opts });
	return { pid: 4242, on() { return this; }, unref() {} };
}`,
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		const code = stubs[specifier];
		if (code && !context.parentURL?.startsWith("data:")) return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});

const root = realpathSync(mkdtempSync(join(tmpdir(), "mcp-test-")));
const fail = (err: unknown) => {
	try { child?.kill(); } catch { /* already gone */ }
	rmSync(root, { recursive: true, force: true });
	throw err;
};

execFileSync("git", ["init", "-q"], { cwd: root });
const child = spawn(process.execPath, [join(import.meta.dirname, "..", "src", "mcp.ts")], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });

let buffer = "";
let received = 0;
const pending = new Map<number, (message: any) => void>();
const nullIdReplies: any[] = [];
let stderr = "";
child.stdout.on("data", (chunk: Buffer) => {
	buffer += chunk.toString("utf8");
	for (;;) {
		const nl = buffer.indexOf("\n");
		if (nl < 0) return;
		const line = buffer.slice(0, nl);
		buffer = buffer.slice(nl + 1);
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		if (message.id === null && message.error) nullIdReplies.push(message);
		received++;
		const resolve = pending.get(message.id);
		if (resolve) {
			pending.delete(message.id);
			resolve(message);
		}
	}
});
child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

let nextId = 1;
const request = (method: string, params?: unknown) =>
	new Promise<any>((resolve, reject) => {
		const id = nextId++;
		pending.set(id, resolve);
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
		setTimeout(() => {
			if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}; stderr: ${stderr}`));
		}, 10_000).unref();
	});
const raw = (line: string) => child.stdin.write(`${line}\n`);

try {
	// initialize: a supported protocol version is echoed back
	const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
	assert.equal(init.result.protocolVersion, "2025-06-18", "a supported version is echoed");
	assert.equal(init.result.serverInfo.name, "se-llm-team");
	assert.equal(typeof init.result.serverInfo.version, "string", "serverInfo.version is a string");
	assert.ok(init.result.capabilities && typeof init.result.capabilities.tools === "object", "the server declares the tools capability");

	// an unsupported version gets the latest we support
	const initFallback = await request("initialize", { protocolVersion: "1999-01-01" });
	assert.equal(initFallback.result.protocolVersion, "2025-11-25", "an unsupported version gets the latest we support");

	// notifications (initialized and others) get no reply: only the ping response arrives
	const before = received;
	raw(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
	const ping = await request("ping");
	assert.deepEqual(ping.result, {});
	assert.equal(received, before + 1, "a notification gets no reply");

	// tools/list: the 12 shared tools with name, description and an object inputSchema
	const list = await request("tools/list");
	const names: string[] = list.result.tools.map((t: any) => t.name).sort();
	assert.deepEqual(names, [
		"efficiency_analysis",
		"kanban_create",
		"kanban_delete",
		"kanban_get",
		"kanban_list",
		"kanban_set_state",
		"kanban_set_worktree",
		"kanban_update",
		"orchestrator_poke",
		"orchestrator_start",
		"orchestrator_status",
		"orchestrator_stop",
	]);
	assert.ok(list.result.tools.every((t: any) => typeof t.description === "string" && t.inputSchema?.type === "object"), "every tool carries a description and an object inputSchema");

	// tools/call kanban_create writes into the cwd repo, kanban_list reads it back
	const created = await request("tools/call", { name: "kanban_create", arguments: { name: "feat: mcp probe", summary: "created through the mcp server" } });
	assert.match(created.result.content[0].text, /^Created 000001_[a-z0-9_]+\.md \(#1\)$/);
	assert.ok(!created.result.isError, "a successful call has no error flag");
	const listed = await request("tools/call", { name: "kanban_list", arguments: { scope: "backlog" } });
	const refs = JSON.parse(listed.result.content[0].text);
	assert.equal(refs.length, 1);
	assert.equal(refs[0].name, "feat: mcp probe");

	// a throwing call sets isError true with the message
	const bad = await request("tools/call", { name: "kanban_create", arguments: { name: "feat: bad slug", summary: "s", shortName: "INVALID SLUG" } });
	assert.equal(bad.result.isError, true, "a failed call sets isError");
	assert.match(bad.result.content[0].text, /invalid shortName/);

	// an unknown tool is an invalid-params error
	const unknownTool = await request("tools/call", { name: "nope" });
	assert.equal(unknownTool.error.code, -32602);

	// an unknown method is -32601
	const unknown = await request("resources/list");
	assert.equal(unknown.error.code, -32601);
	assert.match(unknown.error.message, /resources\/list/);

	// malformed JSON is -32700 with a null id
	raw("{not json");
	await request("ping");
	assert.equal(nullIdReplies.length, 1, "exactly one parse-error reply");
	assert.equal(nullIdReplies[0].id, null);
	assert.equal(nullIdReplies[0].error.code, -32700);
} catch (err) {
	fail(err);
}

child.kill();
await new Promise<void>((resolve) => child.on("exit", () => resolve()));

// the MCP host default: orchestrator_start passes --default-agent claude to the daemon.
// In-process with the spawn stub, the handler records the call
const { TOOLS } = await import("../src/tools.ts");
(globalThis as any).__spawnCalls = [];
const started = await TOOLS.orchestrator_start.run({}, { cwd: root, defaultAgent: "claude" });
const calls = (globalThis as any).__spawnCalls as Array<{ cmd: string; args: string[] }>;
assert.equal(calls.length, 1);
assert.ok(calls[0].args[0] === "--watch", "the daemon runs under node --watch");
assert.ok(calls[0].args[1].endsWith(join("src", "orchestrator.ts")));
assert.deepEqual(calls[0].args.slice(2, 4), ["--root", root]);
assert.deepEqual(calls[0].args.slice(-2), ["--default-agent", "claude"], "the MCP server passes claude as the default agent");
assert.match(started.text, /^Orchestrator starting \(pid 4242\)/);

rmSync(root, { recursive: true, force: true });
console.log("mcp.test.ts: all assertions passed");
