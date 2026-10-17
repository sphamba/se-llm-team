import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { kanbanDir } from "../../src/kanban.ts";
import { compactFinishedLogs, compactLogLine, nextRunIndex } from "../../src/orchestrator.ts";
import { fixture, cleaned } from "../helpers.ts";

// --- part AB: the compactor drops the moderate drop list, keeps the read path byte-for-byte ---
// fixture JSONL with one record per rule class; the pi stderr line is a non-JSON passthrough
const compactorFixture = (): string =>
	[
		JSON.stringify({ type: "session", version: 3, id: "s", timestamp: 0, cwd: "/t" }),
		JSON.stringify({ type: "agent_start" }),
		JSON.stringify({ type: "turn_start" }),
		JSON.stringify({ type: "message_start", message: { role: "system", content: "", sections: { preamble: "the ~135 KB system prompt" } } }),
		JSON.stringify({ type: "message_end", message: { role: "system", content: "", sections: { preamble: "the ~135 KB system prompt" } } }),
		JSON.stringify({ type: "message_update", usage: { input: 0, output: 5, cost: { total: 0.01 } }, assistantMessageEvent: { type: "thinking_delta", delta: "héllo→" } }),
		JSON.stringify({ type: "message_update", usage: { output: 6 }, assistantMessageEvent: { type: "toolcall_delta", id: "t1", delta: '{"command"' } }),
		JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }),
		JSON.stringify({ type: "message_start", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "full tool result" }] } }),
		JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "git status" } }),
		JSON.stringify({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: { content: [{ type: "text", text: "Agent ID: a1\nOutput file: sub.log\nfull body" }], isError: false } }),
		JSON.stringify({ type: "message_end", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "full tool result" }] } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
		JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "turn replay" }] } }),
		JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: "the full message replay" }], willRetry: false }),
		"pi stderr diagnostics: not json",
		JSON.stringify({ type: "message_end", message: { role: "user", content: "the prompt" } }),
	].join("\n") + "\n";

// per-rule asserts on the line-level function
assert.equal(compactLogLine(JSON.stringify({ type: "message_start", message: { role: "system", sections: {} } })), null, "system message_start dropped");
assert.equal(compactLogLine(JSON.stringify({ type: "message_end", message: { role: "system", sections: {} } })), null, "system message_end dropped");
assert.equal(compactLogLine(JSON.stringify({ type: "message_start", message: { role: "toolResult", content: [] } })), null, "toolResult message_start dropped");
const turnEndLine = JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [] } });
assert.equal(compactLogLine(turnEndLine), turnEndLine, "turn_end kept verbatim");
assert.equal(compactLogLine("plain stderr line"), "plain stderr line", "non-JSON stderr passthrough");

// claude stream-json records: the stream_event wrappers drop (their deltas repeat what the
// following authoritative assistant/user records carry), every other claude record keeps
// verbatim, exactly like unknown pi records
const claudeFixture = (): string =>
	[
		JSON.stringify({ type: "system", subtype: "init", cwd: "/r", session_id: "s1", tools: ["Bash"], model: "claude-opus-4-6" }),
		JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", model: "claude-opus-4-6", content: [{ type: "thinking", thinking: "claude plans" }, { type: "text", text: "claude says" }, { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/r/SPECS.md" } }], id: "msg_1", usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }, timestamp: "2026-10-11T09:36:24.121Z" }),
		JSON.stringify({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "cla" } } }),
		JSON.stringify({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_stop", index: 0 } }),
		JSON.stringify({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false, content: "specs body" }] } }),
		JSON.stringify({ type: "result", subtype: "success", is_error: false, duration_ms: 1234, duration_api_ms: 900, num_turns: 2, result: "claude done", usage: { input_tokens: 10, output_tokens: 20 }, total_cost_usd: 0.01 }),
	].join("\n") + "\n";
const claudeLines = claudeFixture().split("\n").filter((l) => l !== "");
for (const claudeLine of claudeLines) {
	const claudeRec = JSON.parse(claudeLine) as any;
	if (claudeRec.type !== "stream_event") continue;
	assert.equal(compactLogLine(claudeLine), null, `claude ${claudeRec.event.type} stream_event dropped`);
}
assert.equal(claudeLines.filter((l) => JSON.parse(l).type === "stream_event").length, 2, "both stream_event shapes covered");
for (const claudeLine of claudeLines) {
	const claudeRec = JSON.parse(claudeLine) as any;
	if (claudeRec.type === "stream_event") continue;
	assert.deepEqual(JSON.parse(compactLogLine(claudeLine) as string), claudeRec, `claude ${claudeRec.type} record kept verbatim`);
}
assert.equal(claudeLines.filter((l) => JSON.parse(l).type !== "stream_event").length, 4, "four kept claude records: system, assistant, user, result");
assert.equal(compactLogLine("claude stderr noise"), "claude stderr noise", "non-JSON line in a claude log kept as its own line");

// the whole fixture line-by-line: compaction is the retro pass now (the fd redirect removed
// the write-time pipe), so each complete line goes through compactLogLine directly, the way
// compactFinishedLogs runs it
const linesAB = compactorFixture().split("\n").map(compactLogLine);
assert.equal(linesAB[linesAB.length - 1], "", "trailing newline preserved");
const recsAB = linesAB.slice(0, -1).filter((l) => l !== null);
assert.equal(recsAB.length, 14, "one line per surviving record, dropped records removed whole");
const parsedAB = recsAB.map((l) => {
	try {
		return JSON.parse(l);
	} catch {
		return l;
	}
});
assert.equal(recsAB[12], "pi stderr diagnostics: not json", "stderr passthrough, position preserved");
assert.ok(!parsedAB.some((p: any) => p.type === "message_start" && p.message?.role === "system"), "system message_start gone");
assert.ok(!parsedAB.some((p: any) => p.type === "message_end" && p.message?.role === "system"), "system message_end gone");
assert.ok(!parsedAB.some((p: any) => p.type === "message_start" && p.message?.role === "toolResult"), "toolResult message_start gone");
assert.ok(parsedAB.some((p: any) => p.type === "message_end" && p.message?.role === "toolResult"), "toolResult message_end kept verbatim");
const muAB = parsedAB.find((p: any) => p.type === "message_update");
assert.deepEqual(muAB.assistantMessageEvent, { type: "thinking_delta", delta: "héllo→" }, "multibyte split reassembled, event verbatim");
assert.deepEqual(Object.keys(muAB).sort(), ["assistantMessageEvent", "type"], "usage envelope stripped");
assert.deepEqual(parsedAB.find((p: any) => p.type === "agent_end"), { type: "agent_end", willRetry: false }, "agent_end messages dropped, the rest kept");
assert.equal(
	parsedAB.find((p: any) => p.type === "tool_execution_end").result.content[0].text.includes("Agent ID: a1"),
	true,
	"full tool result kept for the subagent-log matching",
);
assert.ok(parsedAB.some((p: any) => p.type === "message_end" && p.message?.role === "user"), "the user prompt's message_end kept");
assert.equal(parsedAB.find((p: any) => p.type === "message_update" && p.assistantMessageEvent.type === "toolcall_delta") !== undefined, true, "toolcall deltas survive");
console.log("orchestrator.test.ts: ... + log compactor rules smoke passed");

// --- part AC: every sweep compacts finished logs into .log.gz, never logs with a live pid ---
const rootAC = fixture();
cleaned.push(rootAC);
mkdirSync(join(kanbanDir(rootAC), ".logs"), { recursive: true });
mkdirSync(join(kanbanDir(rootAC), ".pids"), { recursive: true });
const slugDoneAC = "000201_retro_done";
const slugRunAC = "000202_retro_running";
const slugMergAC = "000203_retro_merger";
const logAC = (name: string) => join(kanbanDir(rootAC), ".logs", name);
writeFileSync(logAC(`${slugDoneAC}.developer.0.log`), compactorFixture());
writeFileSync(logAC(`${slugRunAC}.developer.0.log`), compactorFixture());
writeFileSync(logAC(`${slugMergAC}.merger.0.log`), compactorFixture());
writeFileSync(logAC("orchestrator.log"), "daemon log\n");
writeFileSync(logAC(`${slugDoneAC}.reviewer-armed`), "123");
writeFileSync(logAC("push-failures.count"), "3");
writeFileSync(join(kanbanDir(rootAC), ".pids", `${slugRunAC}.pid`), String(process.pid));
writeFileSync(join(kanbanDir(rootAC), ".pids", "merger.pid"), String(process.pid));
const retroAC = compactFinishedLogs(rootAC);
assert.equal(retroAC.files, 1, "only the finished log compacted+gzipped; running and merger logs skipped");
assert.ok(retroAC.after < retroAC.before, "the gzip shrank the log");
assert.ok(!existsSync(logAC(`${slugDoneAC}.developer.0.log`)), "the plain file is replaced by the .log.gz");
const doneAfterAC = gunzipSync(readFileSync(logAC(`${slugDoneAC}.developer.0.log.gz`))).toString();
assert.ok(!doneAfterAC.includes('"usage"') && !doneAfterAC.includes('"sections"'), "gzipped slim");
assert.ok(doneAfterAC.includes('"type":"tool_execution_end"'), "tool results survive the compaction");
assert.equal(doneAfterAC.split("\n").length, compactorFixture().split("\n").length - 3, "exactly the three dead records dropped");
assert.equal(readFileSync(logAC(`${slugRunAC}.developer.0.log`), "utf8"), compactorFixture(), "running log stays plain and appendable");
assert.ok(!existsSync(`${logAC(`${slugRunAC}.developer.0.log`)}.gz`), "no gz for a live agent's log");
assert.equal(readFileSync(logAC(`${slugMergAC}.merger.0.log`), "utf8"), compactorFixture(), "merger log untouched while the merger pidfile exists");
assert.equal(readFileSync(logAC("orchestrator.log"), "utf8"), "daemon log\n", "orchestrator.log skipped");
assert.equal(readFileSync(logAC(`${slugDoneAC}.reviewer-armed`), "utf8"), "123", "armed marker skipped");
assert.equal(readFileSync(logAC("push-failures.count"), "utf8"), "3", "counter skipped");
assert.equal(compactFinishedLogs(rootAC).files, 0, "already-gzipped logs never match: a second pass is a no-op");
assert.equal(nextRunIndex(rootAC, slugDoneAC, "developer"), 1, "a gzipped run still counts, so a fresh spawn never reuses the index");
// 000250 a .doctor.log of a finished run joins the sweep: gzipped like a role log, its
// content passes through the compactor, and it never advances the per-run index
writeFileSync(logAC(`${slugDoneAC}.developer.0.doctor.log`), "doctor stream\n");
assert.equal(compactFinishedLogs(rootAC).files, 1, "the doctor log compacts+gzips like a role log");
assert.ok(existsSync(logAC(`${slugDoneAC}.developer.0.doctor.log.gz`)) && !existsSync(logAC(`${slugDoneAC}.developer.0.doctor.log`)), "the plain doctor.log is replaced by the .log.gz");
assert.equal(gunzipSync(readFileSync(logAC(`${slugDoneAC}.developer.0.doctor.log.gz`))).toString(), "doctor stream\n", "the doctor.log content passes through the compactor");
assert.equal(nextRunIndex(rootAC, slugDoneAC, "developer"), 1, "a .doctor.log never advances the per-run index");
// a live analysis pid keeps its doctor log plain: the guard is the analysis pid file
writeFileSync(logAC(`${slugRunAC}.developer.0.doctor.log`), "doctor live\n");
writeFileSync(join(kanbanDir(rootAC), ".pids", `${slugRunAC}.developer.0.analysis.pid`), String(process.pid));
assert.equal(compactFinishedLogs(rootAC).files, 0, "a live analysis's doctor log stays plain");
assert.equal(readFileSync(logAC(`${slugRunAC}.developer.0.doctor.log`), "utf8"), "doctor live\n", "the live analysis's doctor.log is untouched");
console.log("orchestrator.test.ts: ... + retro sweep smoke passed");
