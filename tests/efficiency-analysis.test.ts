import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { analyseLog, analyserAnswer, buildAnalyserCommand, parseLogBlocks, readLogFile } from "../src/efficiency-analysis.ts";

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
		const result = await analyseLog(logPath, {
			runAnalyser: async (argv) => {
				calls.push(argv);
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
		// one call per block plus pass 2, with the default agent and the fixed argv shape
		assert.equal(calls.length, 6);
		assert.deepEqual(calls[0].slice(0, 9), ["pi", "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json"]);
		assert.equal(calls[0][9], "-p");
		// the gz log writes the report under the same name minus the .log.gz suffix
		const gzPath = join(dir, "bar.developer.0.log.gz");
		writeFileSync(gzPath, gzipSync(Buffer.from(SYNTHETIC)));
		const gzResult = await analyseLog(gzPath, { runAnalyser: async () => "GZ ANALYSIS" });
		assert.equal(gzResult.reportPath, join(dir, "bar.developer.0.analysis.md"));
		assert.ok(existsSync(gzResult.reportPath));
		assert.ok(readFileSync(gzResult.reportPath, "utf8").includes("GZ ANALYSIS"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function testCommandBuilder() {
	assert.deepEqual(
		buildAnalyserCommand("pi", ["--model", "m1"], "summarize this"),
		["pi", "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json", "--model", "m1", "-p", "summarize this"],
	);
	assert.deepEqual(
		buildAnalyserCommand("other-agent", [], "p"),
		["other-agent", "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json", "-p", "p"],
	);
}

function testAnalyserAnswerEmptyParts() {
	// a message_end with an empty text part: the joined text is empty, so no answer
	const emptyText = '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":""}]}}';
	assert.equal(analyserAnswer(emptyText), null);
	// whitespace-only text: also no answer
	const wsText = '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"  \\n\\t "}]}}';
	assert.equal(analyserAnswer(wsText), null);
	// missing text parts: no content, an empty content array, a text part without text,
	// and content with only a thinking part
	assert.equal(analyserAnswer('{"type":"message_end","message":{"role":"assistant"}}'), null);
	assert.equal(analyserAnswer('{"type":"message_end","message":{"role":"assistant","content":[]}}'), null);
	assert.equal(analyserAnswer('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text"}]}}'), null);
	assert.equal(analyserAnswer('{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"}]}}'), null);
	// the last assistant message_end wins: a trailing empty text discards an earlier answer
	const lastWins = [
		'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"earlier answer"}]}}',
		'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":" "}]}}',
	].join("\n");
	assert.equal(analyserAnswer(lastWins), null);
	// a non-empty answer still comes back unchanged, without trimming
	const real = '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"  padded  "}]}}';
	assert.equal(analyserAnswer(real), "  padded  ");
}

async function testFailedAnalyser() {
	const dir = fixtureDir("failed");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		const delays: number[] = [];
		const result = await analyseLog(logPath, {
			runAnalyser: async () => null,
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
		const delays: number[] = [];
		const run = async () => {
			calls++;
			if (calls === 1) throw new Error("boom");
			return "RECOVERED";
		};
		const result = await analyseLog(logPath, { runAnalyser: run, delay: async (ms) => { delays.push(ms); } });
		// the thrown pass 1 call waits 5000 ms, retries and succeeds, then pass 2 runs once
		assert.equal(calls, 3);
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
		const result = await analyseLog(logPath, { runAnalyser: run, delay: async (ms) => { delays.push(ms); } });
		// pass 1 uses 3 attempts with two 5000 ms waits, then pass 2 succeeds first try
		assert.equal(calls, 4);
		assert.deepEqual(delays, [5000, 5000]);
		assert.equal(result.blocks[0].summary, "Block analysis failed after 3 attempts: the analyser returned no answer");
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
		// a stub analyser whose only answer is an empty string: the empty answer must
		// count as no answer, so each call retries all 3 attempts. The stub appends one
		// character per run to a file in its cwd, so the test can count the runs.
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
		assert.equal(result.blocks[0].summary, "Block analysis failed after 3 attempts: the analyser returned no answer");
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
		// the default cap of 8 applies when no override is set
		const def = track();
		const result = await analyseLog(logPath, { runAnalyser: def.run });
		assert.equal(result.blockCount, 20);
		assert.ok(def.max() <= 8, `max in-flight was ${def.max()}, expected at most 8`);
		assert.ok(def.max() > 1, "the block analysers did not run in parallel");
		// a concurrency override tightens the cap
		const capped = track();
		const cappedResult = await analyseLog(logPath, { runAnalyser: capped.run, concurrency: 3 });
		assert.equal(cappedResult.blockCount, 20);
		assert.ok(capped.max() <= 3, `max in-flight was ${capped.max()}, expected at most 3`);
		assert.ok(capped.max() > 1, "the capped block analysers did not run in parallel");
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
	testCommandBuilder();
	testAnalyserAnswerEmptyParts();
	await testFailedAnalyser();
	await testRetryRecovers();
	await testRetryExhaustion();
	await testEmptyAnswerRetried();
	await testConcurrencyLimit();
	console.log("efficiency-analysis tests passed");
} finally {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
