import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { analyseLog } from "../../src/efficiency-analysis.ts";
import { cleanupDirs, fixtureDir, SYNTHETIC } from "./helpers.ts";

try {
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
	await testReportPipeline();
	await testFailedAnalyst();
	await testRetryRecovers();
	await testRetryExhaustion();
	await testEmptyAnswerRetried();
	await testConcurrencyLimit();
	console.log("efficiency-analysis: pipeline tests passed");
} finally {
	cleanupDirs();
}
