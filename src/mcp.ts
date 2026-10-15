// stdio MCP server exposing the shared kanban/orchestrator tools to Claude Code.
// Hand-rolled JSON-RPC over newline-delimited stdin/stdout, node builtins only, so it
// runs from a bare clone with no install step (no typebox, no node_modules). The project
// root is the process cwd, the same cwd the pi handlers get as ctx.cwd.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnums, TOOLS, type ToolCtx } from "./tools.ts";

// the protocol versions we support, newest first (pi's MCP client uses the same list)
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const serverInfo = {
	name: "se-llm-team",
	// the package.json version, 0.0.0 is the fallback when absent
	version: (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0",
};

const ctx: ToolCtx = {
	cwd: process.cwd(),
	// stdout carries only JSON-RPC messages, diagnostics go to stderr
	notify: (message) => process.stderr.write(`${message}\n`),
	defaultAgent: "claude",
};

function send(message: unknown) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

const reply = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
const replyError = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function dispatch(id: unknown, method: string, params: any) {
	switch (method) {
		case "initialize": {
			const requested = params?.protocolVersion;
			const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
			reply(id, { protocolVersion, capabilities: { tools: {} }, serverInfo });
			return;
		}
		case "ping":
			reply(id, {});
			return;
		case "tools/list":
			reply(id, { tools: Object.entries(TOOLS).map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.parameters })) });
			return;
		case "tools/call": {
			const tool = TOOLS[params?.name];
			if (!tool) {
				replyError(id, -32602, `Unknown tool: ${params?.name}`);
				return;
			}
			try {
				const args = params.arguments ?? {};
				checkEnums(tool, args);
				const result = await tool.run(args, ctx);
				reply(id, { content: [{ type: "text", text: result.text }] });
			} catch (err) {
				reply(id, { content: [{ type: "text", text: (err as Error).message }], isError: true });
			}
			return;
		}
		default:
			replyError(id, -32601, `Method not found: ${method}`);
	}
}

function handle(line: string) {
	let message: unknown;
	try {
		message = JSON.parse(line);
	} catch {
		replyError(null, -32700, "Parse error");
		return;
	}
	if (!message || typeof message !== "object" || Array.isArray(message)) {
		replyError(null, -32600, "Invalid request");
		return;
	}
	const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
	if (typeof method !== "string") {
		if (id !== undefined) replyError(id, -32600, "Invalid request");
		return;
	}
	// a notification (no id) never gets a reply, initialized included
	if (id === undefined) return;
	void dispatch(id, method, params);
}

createInterface({ input: process.stdin }).on("line", handle).on("close", () => process.exit(0));
