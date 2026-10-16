import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SYNTHETIC = [
	'{"type":"session","version":3,"timestamp":"2026-01-01T00:00:00.000Z"}',
	'{"type":"message_start","message":{"role":"assistant"}}',
	'{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"junk "}}',
	'{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"junk text"}}',
	'{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"I should look at the file."},{"type":"toolCall","id":"tc1","name":"read","arguments":{"path":"/x/foo.ts"}},{"type":"text","text":"Reading the file now."}]}}',
	'{"type":"tool_execution_start","toolCallId":"tc1","toolName":"read","args":{"path":"/x/foo.ts"}}',
	'{"type":"tool_execution_end","toolCallId":"tc1","toolName":"read","isError":true,"result":{"content":[{"type":"text","text":"from end"}]}}',
	'{"type":"message_end","message":{"role":"toolResult","toolCallId":"tc1","toolName":"read","isError":true,"content":[{"type":"text","text":"from message"}]}}',
	'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"The read failed."}]}}',
	"this line is not json",
	'{"type":"message_end","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"sidechain text that must be skipped"}]}}',
].join("\n");

const dirs: string[] = [];

function fixtureDir(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), `eff-an-${name}-`));
	dirs.push(dir);
	return dir;
}

export function cleanupDirs(): void {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
// one assistant message_end record with one content part
function textEnd(text: string): string {
	return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
}

function thinkingEnd(text: string): string {
	return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: text }] } });
}

function toolCallEnd(id: string, name: string, args: unknown): string {
	return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] } });
}

// the last argv element of a buildAnalystCommand call is the prompt
function promptRecorder(prompts: string[]): (argv: string[]) => Promise<string | null> {
	return async (argv) => {
		prompts.push(argv[argv.length - 1]);
		return "S";
	};
}

// an argv recorder stub: pushes every received argv and returns a fixed answer
function argvRecorder(calls: string[][], answer: string): (argv: string[]) => Promise<string | null> {
	return async (argv) => {
		calls.push(argv);
		return answer;
	};
}

export { SYNTHETIC, fixtureDir, textEnd, thinkingEnd, toolCallEnd, promptRecorder, argvRecorder };
