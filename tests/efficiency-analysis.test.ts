import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { analyseLog, buildAnalyserCommand, parseLogBlocks, readLogFile } from "../src/efficiency-analysis.ts";

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

async function testFailedAnalyser() {
	const dir = fixtureDir("failed");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		const result = await analyseLog(logPath, { runAnalyser: async () => null });
		assert.ok(existsSync(result.reportPath));
		for (const block of result.blocks) {
			assert.ok(block.summary.startsWith("Block analysis failed after one retry"));
			assert.equal(block.struggle, "");
		}
		assert.ok(result.analysis.startsWith("Analysis failed after one retry"));
		const report = readFileSync(result.reportPath, "utf8");
		assert.ok(report.includes("Block analysis failed after one retry"));
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
		const run = async () => {
			calls++;
			if (calls === 1) throw new Error("boom");
			return "RECOVERED";
		};
		const result = await analyseLog(logPath, { runAnalyser: run });
		// the thrown pass 1 call retries once and succeeds, then pass 2 runs once
		assert.equal(calls, 3);
		assert.equal(result.blocks[0].summary, "RECOVERED");
		assert.equal(result.analysis, "RECOVERED");
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
		let inFlight = 0;
		let maxInFlight = 0;
		const run = async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight--;
			return "ok";
		};
		const result = await analyseLog(logPath, { runAnalyser: run });
		assert.equal(result.blockCount, 20);
		assert.ok(maxInFlight <= 8, `max in-flight was ${maxInFlight}, expected at most 8`);
		assert.ok(maxInFlight > 1, "the block analysers did not run in parallel");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

try {
	testBlockExtraction();
	testDeltaFallback();
	testGzipHandling();
	testPlainTextFallback();
	await testReportPipeline();
	testCommandBuilder();
	await testFailedAnalyser();
	await testRetryRecovers();
	await testConcurrencyLimit();
	console.log("efficiency-analysis tests passed");
} finally {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
