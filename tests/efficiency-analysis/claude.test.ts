import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyseLog, analystAnswer, parseLogBlocks } from "../../src/efficiency-analysis.ts";
import { cleanupDirs, fixtureDir, SYNTHETIC } from "./helpers.ts";

try {
async function testClaudeAnalystPipeline() {
	// the claude backend swaps pi's isolation flags for --bare, stream-json output and
	// bypassPermissions; the model and thinking pass through as --model/--effort
	const dir = fixtureDir("claude");
	try {
		const logPath = join(dir, "foo.developer.0.log");
		writeFileSync(logPath, SYNTHETIC);
		const calls: string[][] = [];
		const doctorCalls: string[][] = [];
		await analyseLog(logPath, {
			agent: "claude",
			backend: "claude",
			llm: { model: "cc-model", thinking: "high" },
			mergeThreshold: 10,
			runAnalyst: async (argv) => {
				calls.push(argv);
				return "Summary: done.\nStruggle: none";
			},
			runDoctor: async (argv) => {
				doctorCalls.push(argv);
				return "Summary: done.\nStruggle: none";
			},
		});
		assert.equal(calls.length, 5, "one analyst call per kept block");
		const head = ["claude", "--bare", "--no-session-persistence", "-p"];
		assert.deepEqual(calls[0].slice(0, 4), head);
		assert.ok(calls[0][4].startsWith("Block 1 of type thinking"), "the prompt travels as the -p positional");
		assert.deepEqual(calls[0].slice(5), ["--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose", "--model", "cc-model", "--effort", "high"]);
		// pass 2 uses the claude doctor argv: the stream-json shape without --bare
		assert.equal(doctorCalls.length, 1);
		assert.deepEqual(doctorCalls[0].slice(0, 3), ["claude", "--no-session-persistence", "-p"]);
		assert.equal(doctorCalls[0].indexOf("--bare"), -1, "--bare stays out of the doctor argv");
		// no pi flags in the claude argv
		for (const flag of ["--approve", "--mode", "--thinking", "--provider", "--no-tools"]) assert.equal(calls[0].indexOf(flag), -1, `${flag} stays out of the claude analyst argv`);
		// no model and no thinking: no model/effort flags; off and minimal have no claude effort, both map to low
		const seen: string[][] = [];
		await analyseLog(logPath, { agent: "claude", backend: "claude", llm: {}, runAnalyst: async (argv) => (seen.push(argv), "S: x\nStruggle: none"), runDoctor: async () => "S: x\nStruggle: none" });
		assert.deepEqual(seen[0].slice(5), ["--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose"]);
		const seenOff: string[][] = [];
		await analyseLog(logPath, { agent: "claude", backend: "claude", llm: { thinking: "off" }, runAnalyst: async (argv) => (seenOff.push(argv), "S: x\nStruggle: none"), runDoctor: async () => "S: x\nStruggle: none" });
		assert.deepEqual(seenOff[0].slice(-2), ["--effort", "low"]);
		const seenMin: string[][] = [];
		await analyseLog(logPath, { agent: "claude", backend: "claude", llm: { thinking: "minimal" }, runAnalyst: async (argv) => (seenMin.push(argv), "S: x\nStruggle: none"), runDoctor: async () => "S: x\nStruggle: none" });
		assert.deepEqual(seenMin[0].slice(-2), ["--effort", "low"]);
		const seenMax: string[][] = [];
		await analyseLog(logPath, { agent: "claude", backend: "claude", llm: { thinking: "max" }, runAnalyst: async (argv) => (seenMax.push(argv), "S: x\nStruggle: none"), runDoctor: async () => "S: x\nStruggle: none" });
		assert.deepEqual(seenMax[0].slice(-2), ["--effort", "max"]);
		// the pi backend stays the default: no backend and no llm gives the byte-identical pi argv
		const piCalls: string[][] = [];
		await analyseLog(logPath, { runAnalyst: async (argv) => (piCalls.push(argv), "S: x\nStruggle: none"), runDoctor: async () => "S: x\nStruggle: none" });
		assert.deepEqual(piCalls[0].slice(0, 9), ["pi", "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --- claude stream-json logs: assistant records carry the authoritative blocks like pi's
// message_end, user records carry the tool results, and the result record carries the
// final answer. Parented records are subagent activity and stream_event plus result
// records contribute no blocks. ---

// one synthetic claude log: a system init, an assistant record with thinking then text then
// tool_use, the tool_result user record, a parented subagent record, a second turn with an
// array-content tool result, a stream_event delta and a result record
const CLAUDE_SYNTHETIC = [
	JSON.stringify({ type: "system", subtype: "init" }),
	JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "thinking", thinking: "claude plans" }, { type: "text", text: "starting" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } }),
	JSON.stringify({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false, content: "out" }] } }),
	JSON.stringify({ type: "assistant", parent_tool_use_id: "toolu_1", message: { role: "assistant", content: [{ type: "text", text: "subagent text" }] } }),
	JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "text", text: "done" }, { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "/f" } }] } }),
	JSON.stringify({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", is_error: false, content: [{ type: "text", text: "file body" }] }] } }),
	JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "DELTAONLY" } } }),
	JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "DELTAONLY2" }),
].join("\n");

function testClaudeBlockExtraction() {
	const blocks = parseLogBlocks(CLAUDE_SYNTHETIC);
	assert.equal(blocks.length, 5);
	assert.deepEqual(blocks.map((b) => b.type), ["thinking", "text", "toolCall", "text", "toolCall"]);
	assert.equal(blocks[0].index, 1);
	assert.equal(blocks[4].index, 5);
	assert.equal(blocks[0].text, "claude plans");
	assert.equal(blocks[1].text, "starting");
	assert.equal(blocks[2].toolName, "Bash");
	assert.equal(blocks[2].text, JSON.stringify({ command: "ls" }));
	assert.equal(blocks[2].result, "out");
	assert.equal(blocks[2].isError, false);
	assert.equal(blocks[3].text, "done");
	assert.equal(blocks[4].toolName, "Read");
	assert.equal(blocks[4].text, JSON.stringify({ file_path: "/f" }));
	assert.equal(blocks[4].result, "file body");
	// the parented subagent record adds no block, and the stream_event delta plus the result
	// record are ignored
	assert.ok(!blocks.some((b) => b.text.includes("subagent text")));
	assert.ok(!blocks.some((b) => b.text.includes("DELTAONLY")));
}

function testClaudeAnalystAnswer() {
	// a claude stdout ending in a result record: the result field is the final answer
	const withResult = [
		JSON.stringify({ type: "system", subtype: "init" }),
		JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "working" }] } }),
		'{"type":"result","subtype":"success","is_error":false,"result":"final answer"}',
	].join("\n");
	assert.equal(analystAnswer(withResult), "final answer");
	// an error result record has no answer, with or without a result field
	const errorResult = [
		JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "working" }] } }),
		'{"type":"result","is_error":true}',
	].join("\n");
	assert.equal(analystAnswer(errorResult), null);
	// assistant records with no result record still carry the answer, the last one wins
	const assistantOnly = [
		JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "earlier" }] } }),
		JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "latest" }] } }),
	].join("\n");
	assert.equal(analystAnswer(assistantOnly), "latest");
}

	testClaudeBlockExtraction();
	testClaudeAnalystAnswer();
	await testClaudeAnalystPipeline();
	console.log("efficiency-analysis: claude backend tests passed");
} finally {
	cleanupDirs();
}
