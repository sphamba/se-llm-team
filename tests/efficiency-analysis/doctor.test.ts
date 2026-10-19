import assert from "node:assert/strict";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyseLog } from "../../src/efficiency-analysis.ts";
import { argvRecorder, cleanupDirs, fixtureDir, SYNTHETIC } from "./helpers.ts";

try {
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

Produce a markdown analysis report of pain points (struggle, wasted time, inefficiency) with block number references. The analysed log is one run of the "${role}" role agent of a kanban pipeline. Identify what the agent lost most of its time on (pain points), then revise the role guidance file at ${roleFile} so future runs of that role go more smoothly (a role file of none means there is no role file: do not write any file, produce the report only). You have full rewrite authority over the role file: rewrite it in full each run, keep at most 20 top-level bullets, and keep it valid markdown guidance for the role. Keep only durable, task-agnostic guidance (repo structure, build/test recipes, general shell traps, workflow tips). Delete task-specific material (task-number citations, per-task recipes, measured per-task values, war stories) outright, never archive it.`;
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

async function testMaxNotesBulletsOverride() {
	// an explicit maxNotesBullets overrides the default 20 in the rendered doctor prompt:
	// the configured number renders, the placeholder never stays literal
	const dir = fixtureDir("notescap");
	try {
		const logPath = join(dir, "x.log");
		writeFileSync(logPath, SYNTHETIC);
		const doctorCalls: string[][] = [];
		await analyseLog(logPath, {
			mergeThreshold: 10,
			maxNotesBullets: 5,
			runAnalyst: async () => "S: x\nStruggle: none",
			runDoctor: argvRecorder(doctorCalls, "CAPPED"),
		});
		assert.equal(doctorCalls.length, 1);
		const prompt = doctorCalls[0][doctorCalls[0].length - 1];
		assert.ok(prompt.includes("keep at most 5 top-level bullets"), "the configured cap renders into the doctor prompt");
		assert.ok(!prompt.includes("{{maxNotesBullets}}"), "the placeholder never stays literal");
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
	await testDoctorPromptWithRoleFile();
	await testDoctorPromptWithoutRoleFile();
	await testDoctorLogPath();
	await testDoctorLogPersistence();
	await testRunDoctorInjection();
	await testDoctorLlm();
	await testMaxNotesBulletsOverride();
	console.log("efficiency-analysis: doctor tests passed");
} finally {
	cleanupDirs();
}
