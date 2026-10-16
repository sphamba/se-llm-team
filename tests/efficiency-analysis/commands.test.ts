import assert from "node:assert/strict";
import { buildAnalystCommand, buildDoctorCommand } from "../../src/efficiency-analysis.ts";
import { claudeAnalystArgs, claudeDoctorArgs } from "../../src/orchestrator/backends.ts";

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

testAnalystCommandBuilder();
testDoctorCommandBuilder();
testClaudeArgBuilders();
console.log("efficiency-analysis: command builder tests passed");
