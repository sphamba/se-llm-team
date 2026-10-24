import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createTask, kanbanDir, parseTask, setState, taskSlug, type TaskState } from "../../src/kanban.ts";
import { loadConfig, poll } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import { armedPath, counterPath, logPath, nextRunIndex, readCounter } from "../../src/orchestrator/log.ts";
import { exitFilePath, writeMergerSlug } from "../../src/orchestrator/spawn.ts";
import { writePid } from "../../src/pid.ts";
import { HERE, cleaned, cleanupAll, deadStub, fixture } from "../helpers.ts";

// --- part: pi's JSON mode exits 0 on a terminal assistant error, so the run log decides the
// state. Every case here drives poll() and rescan() directly: a hand-written run log, a pid
// file naming a dead pid and the exit code the sh wrapper would have written are the setup ---

// one fixture per case, with a dying stub agent so every analysis or respawn the orchestrator
// spawns stays offline and fast
const caseRoot = () => {
	const root = fixture();
	cleaned.push(root);
	writeFileSync(join(root, "se-llm-team.json"), JSON.stringify({ agent: deadStub(root) }));
	const logs = join(kanbanDir(root), ".logs");
	mkdirSync(logs, { recursive: true });
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	return { root, cfg: loadConfig(root), logs };
};

const startTask = (root: string, state: string, complexity = "moderate") => {
	const task = createTask(root, { name: `fix: terminal error ${state}`, summary: "Terminal-error smoke", specs: "n/a", complexity });
	setState(root, task, state as TaskState);
	return task;
};

// the healthy developer stub's own log shape: a message_end with no stopReason, a clean stop,
// agent_end and agent_settled, and one non-JSON stderr line in the same file
const healthyLog = () =>
	[
		JSON.stringify({ type: "session", version: 3, id: "s", timestamp: 0, cwd: "/t" }),
		JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }),
		JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "working" } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: "work" } }),
		JSON.stringify({ type: "message_end", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "result echo" }] } }),
		JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }, toolResults: [] }),
		JSON.stringify({ type: "agent_end", willRetry: false }),
		JSON.stringify({ type: "agent_settled", aborted: false }),
		"stub stderr diagnostic: not json",
	].join("\n") + "\n";

// the real 504 run of task #321, record for record
const terminalLog = () =>
	[
		JSON.stringify({ type: "turn_start" }),
		JSON.stringify({
			type: "turn_end",
			message: { role: "assistant", content: [], stopReason: "error", errorMessage: '504: {"code":"upstream_timeout","message":"Upstream request timed out."}' },
			toolResults: [],
		}),
		JSON.stringify({ type: "agent_end", willRetry: false }),
		JSON.stringify({ type: "auto_retry_end", success: false, attempt: 3, finalError: "504: upstream_timeout" }),
		JSON.stringify({ type: "agent_settled", aborted: false }),
	].join("\n") + "\n";

// a finished run: its log at the next run index (plain, the sweep's .gz, or absent), the pid
// file naming a dead pid, and the exit code the sh wrapper writes. Returns the run index the
// .dead marker then names
const endRun = (root: string, slug: string, role: string, body: string | null, code = "0", pidName = slug, gz = false) => {
	const n = nextRunIndex(root, slug, role);
	const base = logPath(root, `${slug}.${role}.${n}`);
	if (body !== null) {
		if (gz) writeFileSync(`${base}.gz`, gzipSync(Buffer.from(body)));
		else writeFileSync(base, body);
	}
	writePid(root, pidName, 999999);
	writeFileSync(exitFilePath(root, pidName), code);
	return n;
};

const orchLog = (root: string) => {
	try {
		return readFileSync(join(kanbanDir(root), ".logs", "orchestrator.log"), "utf8");
	} catch {
		return "";
	}
};

// --- a developer run that ends in a terminal error goes back to to-do, under the crash rules ---
{
	const { root, logs } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	const n = endRun(root, slug, "developer", terminalLog());
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-do", "a terminal error with exit 0 bounces doing -> to-do");
	assert.ok(existsSync(join(logs, `${slug}.developer.${n}.dead`)), "the bounced run carries its .dead marker");
	assert.equal(readFileSync(join(logs, `${slug}.developer.${n}.dead`), "utf8").trim(), "999999", "the marker names the dying run's pid");
	assert.equal(readFileSync(join(logs, `${slug}.dead.count`), "utf8").trim(), "1", "the bounce bumps the same death counter as a crash");
	assert.ok(orchLog(root).includes(`${slug}: agent exited 0 after a terminal error, doing -> to-do`), "the terminal-error bounce is logged as its own kind");
	assert.ok(!orchLog(root).includes("doing -> to-review"), "the failed developer run never reaches to-review");
}

// --- a reviewer run that ends in a terminal error bounces and never bumps the run counter ---
{
	const { root, logs } = caseRoot();
	const task = startTask(root, "reviewing", "simple");
	const slug = taskSlug(task.file);
	const n = endRun(root, slug, "reviewer", terminalLog());
	writeFileSync(armedPath(root, slug), "999999");
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-review", "a terminal error with exit 0 bounces reviewing -> to-review");
	assert.ok(existsSync(join(logs, `${slug}.reviewer.${n}.dead`)), "the bounced reviewer run carries its .dead marker");
	assert.equal(readCounter(root, `${slug}.reviewer-runs`), 0, "a failed reviewer run never bumps .reviewer-runs");
	// the cap cannot force-advance through consumeReviewerRun either: the failed run is not
	// counted, so the to-review sweep finds the counter below the cap and respawns instead
	endRun(root, slug, "reviewer", terminalLog());
	writeFileSync(armedPath(root, slug), "999999");
	rescan(root, loadConfig(root));
	assert.notEqual(parseTask(root, task.file).state, "to-merge", "a reached cap of failed runs never force-advances the task");
	assert.equal(readCounter(root, `${slug}.reviewer-runs`), 0, "consumeReviewerRun counts no failed reviewer run");
}

// --- the cap still force-advances on counted successes (control for the case above) ---
{
	const { root } = caseRoot();
	const task = startTask(root, "to-review", "simple");
	const slug = taskSlug(task.file);
	endRun(root, slug, "reviewer", healthyLog());
	writeFileSync(armedPath(root, slug), "999999");
	writeFileSync(counterPath(root, `${slug}.reviewer-runs`), "1");
	rescan(root, loadConfig(root));
	assert.equal(parseTask(root, task.file).state, "to-merge", "a healthy reviewer run at the cap still force-advances");
}

// --- a live-tester run that ends in a terminal error never reaches done ---
{
	const { root, logs } = caseRoot();
	const task = startTask(root, "live-testing");
	const slug = taskSlug(task.file);
	const n = endRun(root, slug, "live-tester", terminalLog());
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-live-test", "a terminal error with exit 0 bounces live-testing -> to-live-test");
	assert.ok(existsSync(join(logs, `${slug}.live-tester.${n}.dead`)), "the bounced live-tester run carries its .dead marker");
	assert.ok(!orchLog(root).includes("live-testing -> done"), "the failed live-tester run never reaches done");
}

// --- the integration lane: a terminal error retries, a success and a crash land at done ---
{
	const { root, logs } = caseRoot();
	const task = startTask(root, "integration-testing");
	const slug = taskSlug(task.file);
	writeMergerSlug(root, slug, "integration-tester");
	const n = endRun(root, slug, "integration-tester", terminalLog(), "0", "integration-tester");
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-integration-test", "a terminal error with exit 0 returns the integration lane to to-integration-test");
	assert.ok(existsSync(join(logs, `${slug}.integration-tester.${n}.dead`)), "the bounced integration run carries its .dead marker");
}
{
	const { root } = caseRoot();
	const task = startTask(root, "integration-testing");
	const slug = taskSlug(task.file);
	writeMergerSlug(root, slug, "integration-tester");
	endRun(root, slug, "integration-tester", healthyLog(), "0", "integration-tester");
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "done", "a successful integration end still lands at done");
}
{
	const { root } = caseRoot();
	const task = startTask(root, "integration-testing");
	const slug = taskSlug(task.file);
	writeMergerSlug(root, slug, "integration-tester");
	endRun(root, slug, "integration-tester", terminalLog(), "7", "integration-tester");
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "done", "a non-zero integration exit keeps today's done behavior");
}

// --- claude's stream-json carries its failure in the result record ---
for (const [label, result] of [
	["is_error", { type: "result", subtype: "success", is_error: true, result: "API Error: 429 quota exceeded" }],
	["error_ subtype", { type: "result", subtype: "error_max_turns", is_error: false, result: "" }],
] as const) {
	const { root } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	endRun(
		root,
		slug,
		"developer",
		[
			JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
			JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "working" }] } }),
			JSON.stringify(result),
		].join("\n") + "\n",
	);
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-do", `a claude ${label} result with exit 0 bounces the developer`);
}
{
	const { root } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	endRun(
		root,
		slug,
		"developer",
		[
			JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
			JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
			JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done" }),
		].join("\n") + "\n",
	);
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-review", "a healthy claude result with exit 0 still advances");
}

// --- regressions: the exit-0 behavior stands whenever the log shows no terminal error ---
{
	const { root } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	endRun(root, slug, "developer", healthyLog());
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-review", "a healthy JSON log with exit 0 advances");
	assert.ok(!orchLog(root).includes("terminal error"), "a healthy run logs no terminal-error bounce");
}
{
	const { root } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	endRun(root, slug, "developer", healthyLog(), "0", slug, true);
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-review", "a compacted .log.gz with exit 0 advances");
}
{
	const { root } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	endRun(root, slug, "developer", null);
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-review", "a missing log with exit 0 advances");
}
{
	const { root } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	endRun(root, slug, "developer", "");
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-review", "an empty log with exit 0 advances");
}
{
	const { root } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	endRun(root, slug, "developer", healthyLog(), "7");
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-do", "a non-zero exit still bounces");
	assert.ok(orchLog(root).includes("exited 7 without success, doing -> to-do"), "a non-zero exit keeps the crash log line");
}
{
	// a transient error that recovered: the retry verdict and the last assistant stop are clean
	const { root } = caseRoot();
	const task = startTask(root, "doing");
	const slug = taskSlug(task.file);
	const recovered = [
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "429: rate limited" } }),
		JSON.stringify({ type: "auto_retry_start", attempt: 1, delayMs: 2000 }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } }),
		JSON.stringify({ type: "auto_retry_end", success: true, attempt: 1 }),
	].join("\n") + "\n";
	endRun(root, slug, "developer", recovered);
	poll(root, 5);
	assert.equal(parseTask(root, task.file).state, "to-review", "a recovered transient error with exit 0 still advances");
}

// --- the classifier itself ---
const { classifyRunLog } = await import("../../src/orchestrator/log.ts");
{
	const { root, logs } = caseRoot();
	const put = (name: string, body: string) => {
		const path = join(logs, name);
		writeFileSync(path, body);
		return path;
	};
	assert.equal(classifyRunLog(join(logs, "missing.log")), false, "a missing log is no terminal error");
	assert.equal(classifyRunLog(put("empty.log", "")), false, "an empty log is no terminal error");
	assert.equal(classifyRunLog(put("stderr.log", "pi stderr diagnostic\nnot json at all\n")), false, "unparseable lines are no terminal error");
	assert.equal(classifyRunLog(put("healthy.log", healthyLog())), false, "a healthy log is no terminal error");
	assert.equal(classifyRunLog(put("nostop.log", JSON.stringify({ type: "message_end", message: { role: "assistant", content: "work" } }) + "\n")), false, "a missing stopReason is no terminal error");
	assert.equal(classifyRunLog(put("fail.log", terminalLog())), true, "the real 504 record shape is a terminal error");
	for (const stopReason of ["error", "aborted", "length"]) {
		assert.equal(classifyRunLog(put(`stop-${stopReason}.log`, JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [], stopReason } }) + "\n")), true, `stopReason ${stopReason} is a terminal error`);
	}
	assert.equal(
		classifyRunLog(put("quota.log", [JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } }), JSON.stringify({ type: "auto_retry_end", success: false, attempt: 0, finalError: "insufficient_quota" })].join("\n") + "\n")),
		true,
		"a non-retryable quota failure is a terminal error",
	);
	assert.equal(classifyRunLog(put("claude-error.log", JSON.stringify({ type: "result", subtype: "success", is_error: true }) + "\n")), true, "claude is_error is a terminal error");
	assert.equal(classifyRunLog(put("claude-subtype.log", JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: false }) + "\n")), true, "a claude error_ subtype is a terminal error");
	assert.equal(classifyRunLog(put("claude-ok.log", JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\n")), false, "a healthy claude result is no terminal error");
	// the tail bound: the marker records are terminal, so an old failure beyond the 256 KB
	// window does not count, and a failure at the very end of a huge log still does
	const filler = (n: number) => (JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x".repeat(1024) } }) + "\n").repeat(n);
	const tail = filler(400);
	assert.equal(classifyRunLog(put("old-fail.log", terminalLog() + tail + JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [], stopReason: "stop" } }) + "\n")), false, "a failure outside the tail window is no terminal error");
	assert.equal(classifyRunLog(put("late-fail.log", tail + terminalLog())), true, "a failure at the end of a huge log is a terminal error");
	// both file forms, plus the compacted one the sweep leaves behind
	const gzPath = join(logs, "fail.log.gz");
	writeFileSync(gzPath, gzipSync(Buffer.from(terminalLog())));
	assert.equal(classifyRunLog(gzPath), true, "a compacted failing log is a terminal error");
	assert.equal(classifyRunLog(root), false, "a directory is no terminal error");
}
{
	// acceptance on the real runs: the failed developer run, and a clean live-tester run
	const failed = join(HERE, "../.kanban/.logs/000321_integration_done_mirror.developer.0.log.gz");
	const clean = join(HERE, "../.kanban/.logs/000321_integration_done_mirror.live-tester.0.log.gz");
	if (existsSync(failed) && existsSync(clean)) {
		assert.equal(classifyRunLog(failed), true, "the real 504 developer run classifies as a terminal error");
		assert.equal(classifyRunLog(clean), false, "the real clean live-tester run classifies as no terminal error");
	} else console.log("terminal-error.test.ts: real .kanban run logs absent, acceptance check skipped");
}

cleanupAll(...cleaned);
console.log("terminal-error.test.ts: terminal-error classifier + bounce smoke passed");
