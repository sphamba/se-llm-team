import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { analyseLog, analystAnswer, buildAnalystCommand, buildDoctorCommand, parseLogBlocks, readLogFile } from "../src/efficiency-analysis.ts";
import { claudeAnalystArgs, claudeDoctorArgs } from "../src/orchestrator/backends.ts";
import { TOOLS } from "../src/tools.ts";

// one synthetic log with the record shapes the orchestrator logs: a session record, an
// assistant message_end with thinking then toolCall then text, the tool execution records,
// a toolResult message_end, deltas that the authoritative end must discard, a sidechain
// record and a non-JSON line
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

function testBlockExtraction() {
	const blocks = parseLogBlocks(SYNTHETIC);
	assert.equal(blocks.length, 5);
	assert.deepEqual(blocks.map((b) => b.type), ["thinking", "toolCall", "text", "text", "text"]);
	assert.equal(blocks[0].index, 1);
	assert.equal(blocks[4].index, 5);
	assert.equal(blocks[0].text, "I should look at the file.");
	assert.equal(blocks[1].toolName, "read");
	assert.equal(blocks[1].text, JSON.stringify({ path: "/x/foo.ts" }));
	assert.equal(blocks[1].result, "from end");
	assert.equal(blocks[1].isError, true);
	assert.equal(blocks[2].text, "Reading the file now.");
	assert.equal(blocks[3].text, "The read failed.");
	assert.equal(blocks[4].text, "this line is not json");
	// the message_start plus deltas before the authoritative message_end add no extra blocks
	assert.ok(!blocks.some((b) => b.text.includes("junk")));
	assert.ok(!blocks.some((b) => b.text.includes("sidechain")));
}

function testDeltaFallback() {
	// a message_start with deltas but no message_end: the deltas are the only content
	const deltasOnly = [
		'{"type":"message_start","message":{"role":"assistant"}}',
		'{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"think part"}}',
		'{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"text part"}}',
	].join("\n");
	const blocks = parseLogBlocks(deltasOnly);
	assert.deepEqual(blocks.map((b) => b.type), ["thinking", "text"]);
	assert.equal(blocks[0].text, "think part");
	assert.equal(blocks[1].text, "text part");
}

function testGzipHandling() {
	const dir = fixtureDir("gzip");
	try {
		const gzPath = join(dir, "run.log.gz");
		writeFileSync(gzPath, gzipSync(Buffer.from(SYNTHETIC)));
		assert.equal(readLogFile(gzPath), SYNTHETIC);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function testPlainTextFallback() {
	const blocks = parseLogBlocks("hello\nworld\n");
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].type, "text");
	assert.equal(blocks[0].text, "hello\nworld");
	// a log whose only record yields no block becomes one text block with the whole content
	const onlySession = '{"type":"session","version":3}';
	const sessionBlocks = parseLogBlocks(onlySession);
	assert.equal(sessionBlocks.length, 1);
	assert.equal(sessionBlocks[0].type, "text");
	assert.equal(sessionBlocks[0].text, onlySession);
	// a leading BOM does not turn the first record into a junk text block (line trim strips it)
	const bomLog = "\uFEFF" + '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"after bom"}]}}';
	const bomBlocks = parseLogBlocks(bomLog);
	assert.equal(bomBlocks.length, 1);
	assert.equal(bomBlocks[0].type, "text");
	assert.equal(bomBlocks[0].text, "after bom");
}

function testPlainOrderBeforeFallbackCall() {
	// plain text before a fallback tool start keeps its log position: the text block
	// precedes the toolCall block
	const log = [
		"a stderr noise line",
		'{"type":"tool_execution_start","toolCallId":"tc9","toolName":"read","args":{"path":"/x"}}',
	].join("\n");
	const blocks = parseLogBlocks(log);
	assert.deepEqual(blocks.map((b) => b.type), ["text", "toolCall"]);
	assert.equal(blocks[0].text, "a stderr noise line");
	assert.equal(blocks[1].toolName, "read");
}

async function testReportPipeline() {
	const dir = fixtureDir("report");
	try {
		const logPath = join(dir, "foo.developer.0.log");
		writeFileSync(logPath, SYNTHETIC);
		const calls: string[][] = [];
		const doctorCalls: string[][] = [];
		// the fixture blocks are short lead-ins, so a threshold of 10 keeps them all standalone
		const result = await analyseLog(logPath, {
			mergeThreshold: 10,
			runAnalyst: async (argv) => {
				calls.push(argv);
				return "FIXED ANALYSIS TEXT";
			},
			runDoctor: async (argv) => {
				doctorCalls.push(argv);
				return "FIXED ANALYSIS TEXT";
			},
		});
		assert.equal(result.reportPath, join(dir, "foo.developer.0.analysis.md"));
		assert.ok(existsSync(result.reportPath));
		const report = readFileSync(result.reportPath, "utf8");
		assert.ok(report.startsWith("# Efficiency analysis"));
		assert.ok(report.includes(`Source log: ${logPath}`));
		assert.ok(report.includes("Date: "));
		assert.ok(report.includes("1. [thinking] FIXED ANALYSIS TEXT"));
		assert.ok(report.includes("2. [toolCall read] FIXED ANALYSIS TEXT"));
		assert.ok(report.includes("Struggle: none"));
		assert.ok(report.includes("## Analysis"));
		assert.equal(result.blockCount, 5);
		assert.equal(result.analysis, "FIXED ANALYSIS TEXT");
		assert.equal(result.blocks.length, 5);
		assert.equal(result.blocks[0].summary, "FIXED ANALYSIS TEXT");
		assert.equal(result.blocks[0].struggle, "");
		// one analyst call per kept block plus one doctor call, with the default agent and
		// the fixed argv shape
		assert.equal(calls.length, 5);
		assert.equal(doctorCalls.length, 1);
		assert.deepEqual(calls[0].slice(0, 9), ["pi", "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json"]);
		assert.equal(calls[0][9], "-p");
		// the gz log writes the report under the same name minus the .log.gz suffix
		const gzPath = join(dir, "bar.developer.0.log.gz");
		writeFileSync(gzPath, gzipSync(Buffer.from(SYNTHETIC)));
		const gzResult = await analyseLog(gzPath, { runAnalyst: async () => "GZ ANALYSIS", runDoctor: async () => "GZ ANALYSIS" });
		assert.equal(gzResult.reportPath, join(dir, "bar.developer.0.analysis.md"));
		assert.ok(existsSync(gzResult.reportPath));
		assert.ok(readFileSync(gzResult.reportPath, "utf8").includes("GZ ANALYSIS"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function testAnalystCommandBuilder() {
	assert.deepEqual(
		buildAnalystCommand("pi", ["--model", "m1"], "summarize this"),
		["pi", "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json", "--model", "m1", "-p", "summarize this"],
	);
	assert.deepEqual(
		buildAnalystCommand("other-agent", [], "p"),
		["other-agent", "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json", "-p", "p"],
	);
}

function testDoctorCommandBuilder() {
	// the doctor argv is the analyst argv minus --no-mcp and --no-tools: the headless
	// shape stays, the doctor may edit files
	assert.deepEqual(
		buildDoctorCommand("pi", ["--model", "m1"], "analyze this"),
		["pi", "--approve", "--no-session", "--no-extensions", "--no-skills", "--mode", "json", "--model", "m1", "-p", "analyze this"],
	);
	assert.deepEqual(
		buildDoctorCommand("other-agent", [], "p"),
		["other-agent", "--approve", "--no-session", "--no-extensions", "--no-skills", "--mode", "json", "-p", "p"],
	);
}

function testClaudeArgBuilders() {
	// the claude analyst argv prepends --bare to the doctor args, so the analyst reads no
	// files; the doctor args keep the stream-json shape without --bare
	assert.deepEqual(
		claudeAnalystArgs({ model: "cc-model", thinking: "high" }, "analyze"),
		["--bare", "--no-session-persistence", "-p", "analyze", "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose", "--model", "cc-model", "--effort", "high"],
	);
	assert.deepEqual(
		claudeDoctorArgs({ model: "cc-model" }, "analyze"),
		["--no-session-persistence", "-p", "analyze", "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose", "--model", "cc-model"],
	);
}

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

function testAnalystAnswerEmptyParts() {
	// a message_end with an empty text part: the joined text is empty, so no answer
	const emptyText = '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":""}]}}';
	assert.equal(analystAnswer(emptyText), null);
	// whitespace-only text: also no answer
	const wsText = '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"  \\n\\t "}]}}';
	assert.equal(analystAnswer(wsText), null);
	// missing text parts: no content, an empty content array, a text part without text,
	// and content with only a thinking part
	assert.equal(analystAnswer('{"type":"message_end","message":{"role":"assistant"}}'), null);
	assert.equal(analystAnswer('{"type":"message_end","message":{"role":"assistant","content":[]}}'), null);
	assert.equal(analystAnswer('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text"}]}}'), null);
	assert.equal(analystAnswer('{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"}]}}'), null);
	// the last assistant message_end wins: a trailing empty text discards an earlier answer
	const lastWins = [
		'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"earlier answer"}]}}',
		'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":" "}]}}',
	].join("\n");
	assert.equal(analystAnswer(lastWins), null);
	// a non-empty answer still comes back unchanged, without trimming
	const real = '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"  padded  "}]}}';
	assert.equal(analystAnswer(real), "  padded  ");
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

async function testFailedAnalyst() {
	const dir = fixtureDir("failed");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		const delays: number[] = [];
		// the fixture blocks are short lead-ins, so a threshold of 10 keeps them all standalone
		const result = await analyseLog(logPath, {
			mergeThreshold: 10,
			runAnalyst: async () => null,
			runDoctor: async () => null,
			delay: async (ms) => {
				delays.push(ms);
			},
		});
		assert.ok(existsSync(result.reportPath));
		for (const block of result.blocks) {
			assert.ok(block.summary.startsWith("Block analysis failed after 3 attempts"));
			assert.equal(block.struggle, "");
		}
		assert.ok(result.analysis.startsWith("Analysis failed after 3 attempts"));
		const report = readFileSync(result.reportPath, "utf8");
		assert.ok(report.includes("Block analysis failed after 3 attempts"));
		// 5 pass 1 calls plus pass 2, each exhausted call waits 5000 ms before attempts 2 and 3
		assert.equal(delays.length, 12);
		assert.ok(delays.every((ms) => ms === 5000), `expected 5000 ms waits, got ${delays.join(",")}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testRetryRecovers() {
	const dir = fixtureDir("retry");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}');
		let calls = 0;
		let doctorCalls = 0;
		const delays: number[] = [];
		const run = async () => {
			calls++;
			if (calls === 1) throw new Error("boom");
			return "RECOVERED";
		};
		const result = await analyseLog(logPath, {
			runAnalyst: run,
			runDoctor: async () => {
				doctorCalls++;
				return "RECOVERED";
			},
			delay: async (ms) => {
				delays.push(ms);
			},
		});
		// the thrown pass 1 call waits 5000 ms, retries and succeeds, then the doctor runs once
		assert.equal(calls, 2);
		assert.equal(doctorCalls, 1);
		assert.deepEqual(delays, [5000]);
		assert.equal(result.blocks[0].summary, "RECOVERED");
		assert.equal(result.analysis, "RECOVERED");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testRetryExhaustion() {
	const dir = fixtureDir("exhaustion");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}');
		let calls = 0;
		const delays: number[] = [];
		const run = async () => {
			calls++;
			if (calls <= 3) return null;
			return "RECOVERED";
		};
		const result = await analyseLog(logPath, {
			runAnalyst: run,
			runDoctor: async () => "RECOVERED",
			delay: async (ms) => {
				delays.push(ms);
			},
		});
		// pass 1 uses 3 attempts with two 5000 ms waits, then the doctor succeeds first try
		assert.equal(calls, 3);
		assert.deepEqual(delays, [5000, 5000]);
		assert.equal(result.blocks[0].summary, "Block analysis failed after 3 attempts: the analyst returned no answer");
		assert.equal(result.analysis, "RECOVERED");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testEmptyAnswerRetried() {
	const dir = fixtureDir("empty");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}');
		// a stub analyst whose only answer is an empty string: the empty answer must
		// count as no answer, so each call retries all 3 attempts. The stub appends one
		// character per run to a file in its cwd, so the test can count the runs. No
		// runner stubs: the default runners spawn the stub in both passes.
		const stubPath = join(dir, "empty-stub.js");
		const stub = [
			"#!/usr/bin/env node",
			'require("fs").appendFileSync("calls", "1");',
			'process.stdout.write(\'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":""}]}}\\n\');',
		].join("\n");
		writeFileSync(stubPath, stub);
		chmodSync(stubPath, 0o755);
		const delays: number[] = [];
		const result = await analyseLog(logPath, { agent: stubPath, delay: async (ms) => { delays.push(ms); } });
		// one block plus pass 2, each call runs the stub 3 times with two 5000 ms waits
		assert.equal(readFileSync(join(dir, "calls"), "utf8").length, 6);
		assert.deepEqual(delays, [5000, 5000, 5000, 5000]);
		assert.equal(result.blocks[0].summary, "Block analysis failed after 3 attempts: the analyst returned no answer");
		assert.ok(result.analysis.startsWith("Analysis failed after 3 attempts"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testConcurrencyLimit() {
	const dir = fixtureDir("concurrency");
	try {
		const lines: string[] = [];
		for (let i = 0; i < 20; i++) {
			lines.push(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `block ${i}` }] } }));
		}
		const logPath = join(dir, "many.log");
		writeFileSync(logPath, lines.join("\n"));
		const track = () => {
			let inFlight = 0;
			let maxInFlight = 0;
			return {
				max: () => maxInFlight,
				run: async () => {
					inFlight++;
					maxInFlight = Math.max(maxInFlight, inFlight);
					await new Promise((resolve) => setTimeout(resolve, 5));
					inFlight--;
					return "ok";
				},
			};
		};
		// the fixture blocks are short, so a threshold of 1 keeps every block standalone
		// the default cap of 8 applies when no override is set
		const def = track();
		const result = await analyseLog(logPath, { runAnalyst: def.run, runDoctor: async () => "ok", mergeThreshold: 1 });
		assert.equal(result.blockCount, 20);
		assert.ok(def.max() <= 8, `max in-flight was ${def.max()}, expected at most 8`);
		assert.ok(def.max() > 1, "the block analysts did not run in parallel");
		// a concurrency override tightens the cap
		const capped = track();
		const cappedResult = await analyseLog(logPath, { runAnalyst: capped.run, runDoctor: async () => "ok", concurrency: 3, mergeThreshold: 1 });
		assert.equal(cappedResult.blockCount, 20);
		assert.ok(capped.max() <= 3, `max in-flight was ${capped.max()}, expected at most 3`);
		assert.ok(capped.max() > 1, "the capped block analysts did not run in parallel");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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

// --- the lead-in merge pass: a short text or thinking block folds into the next block as
// lead-in context. The folded block gets no analyst call and no report entry. ---

async function testShortLeadInMerge() {
	// a short text block before a tool call folds into the tool call block: the tool call
	// prompt carries the lead-in, and the short block gets no analyst call of its own
	const dir = fixtureDir("merge");
	try {
		const logPath = join(dir, "merge.log");
		writeFileSync(logPath, [textEnd("Now let me read the tests file:"), toolCallEnd("tc1", "read", { path: "/x/tests.ts" })].join("\n"));
		const prompts: string[] = [];
		const result = await analyseLog(logPath, { runAnalyst: promptRecorder(prompts), runDoctor: promptRecorder(prompts) });
		assert.equal(result.blockCount, 1, "the short text block folds into the tool call");
		assert.equal(result.blocks.length, 1);
		assert.equal(result.blocks[0].type, "toolCall");
		assert.equal(result.blocks[0].summary, "S");
		assert.equal(prompts.length, 2, "one pass 1 call for the tool call plus pass 2");
		assert.ok(prompts[0].includes('lead-in [text]: "Now let me read the tests file:"'), `the tool call prompt carries the lead-in, got: ${prompts[0]}`);
		assert.ok(prompts[1].includes("Merged lead-in blocks: 1"), `pass 2 counts the folded block, got: ${prompts[1]}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testConsecutiveLeadIns() {
	// consecutive short lead-ins accumulate in order in the next block's prompt
	const dir = fixtureDir("leadins");
	try {
		const long = "This long block stands on its own and carries both lead-ins in its prompt. ".repeat(4);
		const logPath = join(dir, "leadins.log");
		writeFileSync(logPath, [textEnd("First I check the board:"), thinkingEnd("The board looks stale."), textEnd(long)].join("\n"));
		const prompts: string[] = [];
		const result = await analyseLog(logPath, { runAnalyst: promptRecorder(prompts), runDoctor: promptRecorder(prompts) });
		assert.equal(result.blockCount, 1, "both short blocks fold into the long block");
		const textAt = prompts[0].indexOf('lead-in [text]: "First I check the board:"');
		const thinkingAt = prompts[0].indexOf('lead-in [thinking]: "The board looks stale."');
		assert.ok(textAt !== -1 && thinkingAt !== -1, `both lead-ins travel in the prompt, got: ${prompts[0]}`);
		assert.ok(textAt < thinkingAt, "the lead-ins keep log order");
		assert.ok(prompts[1].includes("Merged lead-in blocks: 2"), `pass 2 counts both folded blocks, got: ${prompts[1]}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testLeadInCap() {
	// many consecutive short lead-ins grow the prompt: the joined lead-ins get the same
	// 8000-char cap as the block content, and the lead-ins closest to the block stay
	const dir = fixtureDir("leadcap");
	try {
		const records: string[] = [];
		for (let i = 0; i < 60; i++) records.push(textEnd(`note ${i} ${"x".repeat(240)}`));
		records.push(toolCallEnd("tc1", "read", { path: "/x" }));
		const logPath = join(dir, "cap.log");
		writeFileSync(logPath, records.join("\n"));
		const prompts: string[] = [];
		const result = await analyseLog(logPath, { runAnalyst: promptRecorder(prompts), runDoctor: promptRecorder(prompts) });
		assert.equal(result.blockCount, 1, "all 60 short blocks fold into the tool call");
		assert.ok(prompts[0].includes("[Truncated: the oldest lead-ins were cut.]"), `the over-cap lead-ins carry the marker, got: ${prompts[0].slice(0, 400)}`);
		assert.ok(!prompts[0].includes(`note 0 ${"x".repeat(240)}`), "the oldest lead-in is cut");
		assert.ok(prompts[0].includes(`note 59 ${"x".repeat(240)}`), "the lead-in closest to the block stays");
		assert.ok(prompts[0].length < 10000, `the prompt stays bounded, got ${prompts[0].length} chars`);
		assert.ok(prompts[1].includes("Merged lead-in blocks: 60"), `pass 2 counts all folded blocks, got: ${prompts[1]}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testTrailingShortBlockStandalone() {
	// a short block at the end of the log has no following block: it keeps its own analyst
	// call and report entry
	const dir = fixtureDir("trailing");
	try {
		const logPath = join(dir, "trailing.log");
		writeFileSync(logPath, textEnd("done"));
		const prompts: string[] = [];
		const result = await analyseLog(logPath, { runAnalyst: promptRecorder(prompts), runDoctor: promptRecorder(prompts) });
		assert.equal(result.blockCount, 1);
		assert.equal(result.blocks.length, 1);
		assert.ok(!prompts[0].includes("lead-in"), `a standalone block carries no lead-in, got: ${prompts[0]}`);
		assert.equal(prompts.length, 2, "pass 1 for the trailing block plus pass 2");
		assert.ok(prompts[1].includes("Merged lead-in blocks: 0"));
		// a short block followed only by another short block: the earlier one still folds into
		// the trailing one, which stays standalone with the lead-in
		const pairPath = join(dir, "pair.log");
		writeFileSync(pairPath, [textEnd("First I check:"), textEnd("done")].join("\n"));
		const pairPrompts: string[] = [];
		const pair = await analyseLog(pairPath, { runAnalyst: promptRecorder(pairPrompts), runDoctor: promptRecorder(pairPrompts) });
		assert.equal(pair.blockCount, 1, "the first short block folds into the trailing short block");
		assert.ok(pairPrompts[0].includes('lead-in [text]: "First I check:"'), `the trailing prompt carries the lead-in, got: ${pairPrompts[0]}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testThresholdBoundary() {
	// a block at exactly the threshold stays standalone, one char below folds
	const dir = fixtureDir("threshold");
	try {
		const long = "This block is long enough to stand on its own. ".repeat(6);
		const mkLog = (shortText: string) => [textEnd(shortText), textEnd(long)].join("\n");
		// the default threshold of 250 applies when mergeThreshold is unset
		const atPrompts: string[] = [];
		const atPath = join(dir, "at.log");
		writeFileSync(atPath, mkLog("x".repeat(250)));
		const at = await analyseLog(atPath, { runAnalyst: promptRecorder(atPrompts), runDoctor: promptRecorder(atPrompts) });
		assert.equal(at.blockCount, 2, "a block at exactly 250 chars stays standalone");
		assert.ok(!atPrompts.slice(0, 2).some((p) => p.includes("lead-in [")), "no block folds at the threshold");
		const belowPrompts: string[] = [];
		const belowPath = join(dir, "below.log");
		writeFileSync(belowPath, mkLog("x".repeat(249)));
		const below = await analyseLog(belowPath, { runAnalyst: promptRecorder(belowPrompts), runDoctor: promptRecorder(belowPrompts) });
		assert.equal(below.blockCount, 1, "a block one char below the threshold folds");
		assert.ok(belowPrompts[0].includes(`lead-in [text]: "${"x".repeat(249)}"`), `the prompt carries the folded text, got: ${belowPrompts[0]}`);
		// an explicit mergeThreshold overrides the default
		const customPrompts: string[] = [];
		const customPath = join(dir, "custom.log");
		writeFileSync(customPath, mkLog("y".repeat(9)));
		const custom = await analyseLog(customPath, { runAnalyst: promptRecorder(customPrompts), runDoctor: promptRecorder(customPrompts), mergeThreshold: 10 });
		assert.equal(custom.blockCount, 1, "a block below an explicit threshold folds");
		assert.ok(customPrompts[0].includes(`lead-in [text]: "${"y".repeat(9)}"`), `the prompt carries the folded text, got: ${customPrompts[0]}`);
		const customAtPrompts: string[] = [];
		const customAtPath = join(dir, "custom-at.log");
		writeFileSync(customAtPath, mkLog("y".repeat(10)));
		const customAt = await analyseLog(customAtPath, { runAnalyst: promptRecorder(customAtPrompts), runDoctor: promptRecorder(customAtPrompts), mergeThreshold: 10 });
		assert.equal(customAt.blockCount, 2, "a block at an explicit threshold stays standalone");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --- the doctor pass: argv builders, prompt with and without a role file, doctor log
// persistence, runner injection and the llm override ---

// The shipped agents/doctor.md rendered over the synthetic fixture, as a byte pin: any
// deliberate wording change must update this literal (accepted combined scaffold, #228).
function shippedDoctorPrompt(roleFile: string, role: string): string {
	return `Blocks: 5 total (text 3, thinking 1, toolCall 1).
Tool calls per tool: read 1.
Merged lead-in blocks: 0 (short blocks folded into the next block as lead-in context).
Errors: 1 (tool results with errors plus failed block analyses).

Block summaries:
1. [thinking] S: x
   Struggle: none
2. [toolCall read] S: x
   Struggle: none
3. [text] S: x
   Struggle: none
4. [text] S: x
   Struggle: none
5. [text] S: x
   Struggle: none

Produce a markdown analysis report of pain points (struggle, wasted time, inefficiency) with block number references. The analysed log is one run of the "${role}" role agent of a kanban pipeline. Identify what the agent lost most of its time on (pain points), then revise the role guidance file at ${roleFile} so future runs of that role go more smoothly (a role file of none means there is no role file: do not write any file, produce the report only). You have full rewrite authority over the role file: restructure or trim the whole file and remove stale guidance, and keep it valid markdown guidance for the role.`;
}

async function testDoctorPromptWithRoleFile() {
	// with roleFile the doctor prompt carries the role file path, names the role and asks
	// for the rewrite; the pi doctor argv drops the tool isolation while the analyst keeps it
	const dir = fixtureDir("rolefile");
	try {
		const logPath = join(dir, "foo.developer.0.log");
		writeFileSync(logPath, SYNTHETIC);
		const roleFile = join(dir, "developer.md");
		const analystCalls: string[][] = [];
		const doctorCalls: string[][] = [];
		const result = await analyseLog(logPath, {
			mergeThreshold: 10,
			role: "developer",
			roleFile,
			runAnalyst: argvRecorder(analystCalls, "S: x\nStruggle: none"),
			runDoctor: argvRecorder(doctorCalls, "DOCTOR ANALYSIS"),
		});
		assert.equal(doctorCalls.length, 1, "the doctor runs once");
		const prompt = doctorCalls[0][doctorCalls[0].length - 1];
		assert.equal(prompt, shippedDoctorPrompt(roleFile, "developer"), "the doctor prompt pins the shipped agents/doctor.md bytes");
		// the pi doctor argv drops --no-mcp and --no-tools, the analyst argv keeps them
		assert.equal(doctorCalls[0].indexOf("--no-mcp"), -1, "--no-mcp stays out of the doctor argv");
		assert.equal(doctorCalls[0].indexOf("--no-tools"), -1, "--no-tools stays out of the doctor argv");
		assert.equal(analystCalls.length, 5);
		for (const argv of analystCalls) {
			assert.ok(argv.includes("--no-mcp"), "the analyst argv keeps --no-mcp");
			assert.ok(argv.includes("--no-tools"), "the analyst argv keeps --no-tools");
		}
		// the analyst prompts stay block-only: no role file path and no rewrite ask
		assert.ok(analystCalls.every((argv) => !argv[argv.length - 1].includes(roleFile)), "the analyst prompts carry no role file path");
		assert.equal(result.analysis, "DOCTOR ANALYSIS");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testDoctorPromptWithoutRoleFile() {
	// without a roleFile the role file substitutes to the literal "none": the prompt tells
	// the doctor not to write any file, the role stays unnamed, and the argv keeps the
	// doctor shape (roleFile only changes the prompt)
	const dir = fixtureDir("reportonly");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		const doctorCalls: string[][] = [];
		const result = await analyseLog(logPath, {
			mergeThreshold: 10,
			role: "developer",
			runAnalyst: async () => "S: x\nStruggle: none",
			runDoctor: argvRecorder(doctorCalls, "PLAIN ANALYSIS"),
		});
		assert.equal(doctorCalls.length, 1);
		const prompt = doctorCalls[0][doctorCalls[0].length - 1];
		assert.equal(prompt, shippedDoctorPrompt("none", "none"), "the no-roleFile doctor prompt pins the shipped agents/doctor.md bytes");
		assert.ok(prompt.includes("do not write any file"), "the none case forbids writes");
		assert.ok(!prompt.includes("developer"), "the role stays unnamed without a role file");
		assert.equal(result.analysis, "PLAIN ANALYSIS");
		assert.ok(existsSync(result.reportPath), "the report is written without a role file");
		// the headless analyst isolation flags stay in the doctor argv
		assert.deepEqual(doctorCalls[0].slice(0, 7), ["pi", "--approve", "--no-session", "--no-extensions", "--no-skills", "--mode", "json"]);
		assert.equal(doctorCalls[0][7], "-p");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testDoctorLogPath() {
	const dir = fixtureDir("doctorlog");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		const doctorLogPath = join(dir, "x.doctor.log");
		// with a stubbed doctor the log is still created eagerly, empty, before the pass
		await analyseLog(logPath, {
			mergeThreshold: 10,
			doctorLogPath,
			runAnalyst: async () => "S: x\nStruggle: none",
			runDoctor: async () => "DOCTOR",
		});
		assert.ok(existsSync(doctorLogPath), "the doctor log is created eagerly before the doctor pass");
		assert.equal(readFileSync(doctorLogPath, "utf8"), "", "a stubbed doctor writes nothing to the log");
		// without doctorLogPath no file is created for the doctor pass
		rmSync(doctorLogPath, { force: true });
		await analyseLog(logPath, {
			mergeThreshold: 10,
			runAnalyst: async () => "S: x\nStruggle: none",
			runDoctor: async () => "DOCTOR",
		});
		assert.ok(!existsSync(doctorLogPath), "no doctor log without doctorLogPath");
		assert.deepEqual(readdirSync(dir).sort(), ["x.analysis.md", "x.log"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testDoctorLogPersistence() {
	// with no runner stubs the real spawn runs the stub agent in both passes: the doctor
	// pass persists its stream to doctorLogPath while the analyst pass keeps its stdout
	// in memory, and the stub answer becomes the Analysis section
	const dir = fixtureDir("persist");
	try {
		const logPath = join(dir, "stub.log");
		writeFileSync(logPath, SYNTHETIC);
		const stubPath = join(dir, "stub-agent.js");
		const stub = [
			"#!/usr/bin/env node",
			'process.stdout.write(\'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"DOCTOR REWRITE DONE"}]}}\\n\');',
		].join("\n");
		writeFileSync(stubPath, stub);
		chmodSync(stubPath, 0o755);
		const roleFile = join(dir, "developer.md");
		writeFileSync(roleFile, "# developer guidance\n");
		const doctorLogPath = join(dir, "stub.doctor.log");
		const result = await analyseLog(logPath, {
			agent: stubPath,
			backend: "pi",
			llm: {},
			role: "developer",
			roleFile,
			doctorLogPath,
		});
		assert.ok(existsSync(doctorLogPath));
		const doctorLog = readFileSync(doctorLogPath, "utf8");
		assert.ok(doctorLog.includes("DOCTOR REWRITE DONE"), "the doctor log holds the stub stdout");
		assert.equal(doctorLog.trim().split("\n").length, 1, "only the doctor pass appends to the doctor log");
		// no separate analyst log: the dir holds only the fixture files and the report
		assert.deepEqual(readdirSync(dir).sort(), ["developer.md", "stub-agent.js", "stub.analysis.md", "stub.doctor.log", "stub.log"]);
		const report = readFileSync(result.reportPath, "utf8");
		const at = report.indexOf("## Analysis");
		assert.ok(at !== -1, "the report has an Analysis section");
		assert.ok(report.slice(at).includes("DOCTOR REWRITE DONE"), "the stub answer is the Analysis section");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testRunDoctorInjection() {
	// an injected runDoctor decides the analysis: its answer lands in the result and the
	// report, it runs exactly once with the doctor argv, and runAnalyst runs once per kept block
	const dir = fixtureDir("injection");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		const analystCalls: string[][] = [];
		const doctorCalls: string[][] = [];
		const result = await analyseLog(logPath, {
			mergeThreshold: 10,
			runAnalyst: argvRecorder(analystCalls, "S: x\nStruggle: none"),
			runDoctor: argvRecorder(doctorCalls, "INJECTED ANALYSIS"),
		});
		assert.equal(result.blockCount, 5);
		assert.equal(analystCalls.length, result.blockCount, "one analyst call per kept block");
		assert.equal(doctorCalls.length, 1, "the doctor runs exactly once");
		assert.deepEqual(doctorCalls[0].slice(0, 7), ["pi", "--approve", "--no-session", "--no-extensions", "--no-skills", "--mode", "json"], "the doctor gets the doctor argv");
		assert.equal(doctorCalls[0][7], "-p");
		assert.equal(result.analysis, "INJECTED ANALYSIS", "the doctor answer becomes the analysis");
		const report = readFileSync(result.reportPath, "utf8");
		const at = report.indexOf("## Analysis");
		assert.ok(at !== -1);
		assert.ok(report.slice(at).includes("INJECTED ANALYSIS"), "the report carries the doctor answer");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --- the prompt files: agents/analyst.md and agents/doctor.md are the only prompt
// source, read once per run from <root>/agents (default the package's own agents dir) ---

async function testPromptFileSubstitution() {
	// a per-root template renders through the placeholder contract: known placeholders are
	// replaced, an unknown placeholder stays literal text, toolName is empty for non-tool blocks
	const dir = fixtureDir("subst");
	try {
		const root = join(dir, "proj");
		mkdirSync(join(root, "agents"), { recursive: true });
		writeFileSync(join(root, "agents", "analyst.md"), "type={{blockType}} tool={{toolName}}| idx={{blockIndex}} keep={{mystery}}\n{{blockContent}}");
		writeFileSync(join(root, "agents", "doctor.md"), "s={{stats}} m={{mergedCount}} f={{failedCount}} file={{roleFile}} role={{role}}\n{{reports}}");
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, [textEnd("done"), toolCallEnd("tc1", "read", { path: "/x" })].join("\n"));
		const prompts: string[] = [];
		await analyseLog(logPath, { root, mergeThreshold: 1, role: "developer", roleFile: "/r/AGENTS.developer.md", runAnalyst: promptRecorder(prompts), runDoctor: promptRecorder(prompts) });
		assert.equal(prompts.length, 3, "two analyst calls plus the doctor call");
		assert.equal(prompts[0], "type=text tool=| idx=1 keep={{mystery}}\ndone");
		assert.equal(prompts[1], `type=toolCall tool= read| idx=2 keep={{mystery}}\nTool call read. Arguments:\n${JSON.stringify({ path: "/x" })}`);
		assert.equal(
			prompts[2],
			"s=Blocks: 2 total (text 1, thinking 0, toolCall 1).\nTool calls per tool: read 1. m=0 f=0 file=/r/AGENTS.developer.md role=developer\n1. [text] S\n   Struggle: none\n2. [toolCall read] S\n   Struggle: none",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testMissingPromptFileFails() {
	// both prompt files are required: a missing file fails the analysis with the path
	// named before any LLM call, and no report is written
	const dir = fixtureDir("missing");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		let calls = 0;
		await assert.rejects(analyseLog(logPath, { root: dir, runAnalyst: async () => { calls++; return "S"; } }), /agents[/\\]analyst\.md/);
		assert.equal(calls, 0, "no analyst call before the prompt files load");
		assert.ok(!existsSync(join(dir, "x.analysis.md")), "no report on a failed prompt load");
		// a missing doctor.md fails too, even with analyst.md present
		mkdirSync(join(dir, "agents"));
		writeFileSync(join(dir, "agents", "analyst.md"), "Block {{blockIndex}}.\n{{blockContent}}");
		await assert.rejects(analyseLog(logPath, { root: dir, runAnalyst: async () => { calls++; return "S"; } }), /agents[/\\]doctor\.md/);
		assert.equal(calls, 0, "no analyst call when the doctor prompt file is missing");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testManualToolErrorPath() {
	// the manual efficiency_analysis tool resolves the prompts from the session cwd's
	// agents dir: a missing file fails the analysis and the tool reports it as
	// "Cannot analyse <path>: <msg>" naming the missing prompt file
	const dir = fixtureDir("toolerr");
	try {
		const result = await TOOLS.efficiency_analysis.run({ path: "x.log" }, { cwd: dir, defaultAgent: "pi" });
		assert.ok(result.text.startsWith(`Cannot analyse ${join(dir, "x.log")}:`), `got: ${result.text}`);
		assert.ok(result.text.includes("analyst.md"), `the message names the missing prompt file: ${result.text}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testDoctorLlm() {
	// doctorLlm defaults to the analyst llm flags; an explicit doctorLlm overrides the
	// doctor argv only, the analyst argv keeps its own flags
	const dir = fixtureDir("doctorllm");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		const analystCalls: string[][] = [];
		const doctorCalls: string[][] = [];
		await analyseLog(logPath, {
			mergeThreshold: 10,
			llm: { model: "analyst-model", thinking: "high" },
			runAnalyst: argvRecorder(analystCalls, "S: x\nStruggle: none"),
			runDoctor: argvRecorder(doctorCalls, "DOCTOR"),
		});
		assert.deepEqual(doctorCalls[0].slice(7, 11), ["--model", "analyst-model", "--thinking", "high"], "the doctor defaults to the analyst llm flags");
		assert.deepEqual(analystCalls[0].slice(9, 13), ["--model", "analyst-model", "--thinking", "high"]);
		const override: string[][] = [];
		await analyseLog(logPath, {
			mergeThreshold: 10,
			llm: { model: "analyst-model", thinking: "high" },
			doctorLlm: { model: "doctor-model", thinking: "low" },
			runAnalyst: async () => "S: x\nStruggle: none",
			runDoctor: argvRecorder(override, "DOCTOR"),
		});
		assert.deepEqual(override[0].slice(7, 11), ["--model", "doctor-model", "--thinking", "low"], "an explicit doctorLlm overrides the doctor flags");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

try {
	testBlockExtraction();
	testDeltaFallback();
	testGzipHandling();
	testPlainTextFallback();
	testPlainOrderBeforeFallbackCall();
	await testReportPipeline();
	testAnalystCommandBuilder();
	testDoctorCommandBuilder();
	testClaudeArgBuilders();
	await testClaudeAnalystPipeline();
	testAnalystAnswerEmptyParts();
	testClaudeBlockExtraction();
	testClaudeAnalystAnswer();
	await testFailedAnalyst();
	await testRetryRecovers();
	await testRetryExhaustion();
	await testEmptyAnswerRetried();
	await testConcurrencyLimit();
	await testShortLeadInMerge();
	await testConsecutiveLeadIns();
	await testLeadInCap();
	await testTrailingShortBlockStandalone();
	await testThresholdBoundary();
	await testDoctorPromptWithRoleFile();
	await testDoctorPromptWithoutRoleFile();
	await testDoctorLogPath();
	await testDoctorLogPersistence();
	await testRunDoctorInjection();
	await testDoctorLlm();
	await testPromptFileSubstitution();
	await testMissingPromptFileFails();
	await testManualToolErrorPath();
	console.log("efficiency-analysis tests passed");
} finally {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
