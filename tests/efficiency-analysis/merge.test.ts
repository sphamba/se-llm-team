import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyseLog } from "../../src/efficiency-analysis.ts";
import { cleanupDirs, fixtureDir, promptRecorder, textEnd, thinkingEnd, toolCallEnd } from "./helpers.ts";

try {
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
	await testShortLeadInMerge();
	await testConsecutiveLeadIns();
	await testLeadInCap();
	await testTrailingShortBlockStandalone();
	await testThresholdBoundary();
	console.log("efficiency-analysis: lead-in merge tests passed");
} finally {
	cleanupDirs();
}
