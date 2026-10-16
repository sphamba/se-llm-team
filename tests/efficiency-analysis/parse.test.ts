import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { analystAnswer, parseLogBlocks, readLogFile } from "../../src/efficiency-analysis.ts";
import { cleanupDirs, fixtureDir, SYNTHETIC } from "./helpers.ts";

try {
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

	testBlockExtraction();
	testDeltaFallback();
	testGzipHandling();
	testPlainTextFallback();
	testPlainOrderBeforeFallbackCall();
	testAnalystAnswerEmptyParts();
	console.log("efficiency-analysis: parse tests passed");
} finally {
	cleanupDirs();
}
