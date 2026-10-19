import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyseLog } from "../../src/efficiency-analysis.ts";
import { TOOLS } from "../../src/tools.ts";
import { cleanupDirs, fixtureDir, promptRecorder, SYNTHETIC, textEnd, toolCallEnd } from "./helpers.ts";

try {
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
		writeFileSync(join(root, "agents", "doctor.md"), "s={{stats}} m={{mergedCount}} f={{failedCount}} file={{roleFile}} role={{role}} n={{maxNotesBullets}}\n{{reports}}");
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, [textEnd("done"), toolCallEnd("tc1", "read", { path: "/x" })].join("\n"));
		const prompts: string[] = [];
		await analyseLog(logPath, { root, mergeThreshold: 1, role: "developer", roleFile: "/r/AGENTS.developer.md", runAnalyst: promptRecorder(prompts), runDoctor: promptRecorder(prompts) });
		assert.equal(prompts.length, 3, "two analyst calls plus the doctor call");
		assert.equal(prompts[0], "type=text tool=| idx=1 keep={{mystery}}\ndone");
		assert.equal(prompts[1], `type=toolCall tool= read| idx=2 keep={{mystery}}\nTool call read. Arguments:\n${JSON.stringify({ path: "/x" })}`);
		assert.equal(
			prompts[2],
			"s=Blocks: 2 total (text 1, thinking 0, toolCall 1).\nTool calls per tool: read 1. m=0 f=0 file=/r/AGENTS.developer.md role=developer n=20\n1. [text] S\n   Struggle: none\n2. [toolCall read] S\n   Struggle: none",
		);
		// an explicit maxNotesBullets overrides the default 20 at the use site; the placeholder
		// never stays literal
		const overrides: string[] = [];
		await analyseLog(logPath, { root, mergeThreshold: 1, maxNotesBullets: 7, role: "developer", roleFile: "/r/AGENTS.developer.md", runAnalyst: promptRecorder(overrides), runDoctor: promptRecorder(overrides) });
		assert.equal(overrides.length, 3, "the override run makes the same three calls");
		assert.ok(overrides[2].endsWith("n=7\n1. [text] S\n   Struggle: none\n2. [toolCall read] S\n   Struggle: none"), "the configured maxNotesBullets renders");
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

	await testPromptFileSubstitution();
	await testMissingPromptFileFails();
	await testManualToolErrorPath();
	console.log("efficiency-analysis: prompt file tests passed");
} finally {
	cleanupDirs();
}
