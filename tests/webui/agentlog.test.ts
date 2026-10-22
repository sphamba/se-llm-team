import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, getTask, setState } from "../../src/kanban.ts";
import { startHub } from "../../src/hub.ts";
import { agentLabel, agentLogPayload, fmtDur, fmtTokens, LOG_LINES, taskHistory, taskStats } from "../../src/webui.ts";
// not re-exported by the webui barrel: import directly from the logpane module
import { LOG_ROLES } from "../../src/webui/logpane.ts";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));

// 000215: the neutral config dir resolves to $HOME/.config/se-llm-team when XDG_CONFIG_HOME
// is unset, so dropping it keeps every temp-HOME section off the real user config
delete process.env.XDG_CONFIG_HOME;

const root = mkdtempSync(join(tmpdir(), "webui-test-"));
const home = mkdtempSync(join(tmpdir(), "webui-home-"));
const cleanup = () => {
	rmSync(root, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		cleanup();
		process.exit(sig === "SIGINT" ? 130 : 143);
	});
}
process.env.HOME = home;

const thinkDelta = (t: string) => JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: t } });
const thinkEnd = (t: string) => JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: t } });

const task = createTask(root, { name: "feat: webui smoke", summary: "Dashboard smoke", specs: "Render the board" });
const ui = await startHub({ name: "webui-test", root, host: "localhost", port: 0 });
const base = `http://localhost:${ui.port}`;
const page = await (await fetch(`${base}/`)).text();

setState(root, getTask(root, task.file)!, "doing");
const slug = task.file.replace(/\.md$/, "");
mkdirSync(join(root, ".kanban", ".pids"), { recursive: true });
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), String(process.pid));
mkdirSync(join(root, ".kanban", ".logs"), { recursive: true });
const logFile = join(root, ".kanban", ".logs", `${slug}.developer.log`);
const logText = Array.from({ length: 350 }, () => "H".repeat(63) + "\n").join(""); // 64-byte lines: far under the old byte chunk, so the collapsed-line cap is what pages
writeFileSync(logFile, logText);
// 000242: the agent history lives on the per-task detail, never the light /api/tasks rows.
// 000248: the history is the follow-up fetch, detailOf merges both halves like the client does
const detailOf = async (f: string) => ({
	...(await (await fetch(`${base}/api/task-detail?num=${parseInt(f, 10)}`)).json()),
	...(await (await fetch(`${base}/api/task-history?num=${parseInt(f, 10)}`)).json()),
});
const working = await detailOf(task.file);
assert.deepEqual(working.agent, { role: "developer", alive: true, log: `${slug}.developer` });
assert.deepEqual(working.agents, [{ role: "developer", run: null, alive: true, status: "live", handle: `${slug}.developer`, tokens: null, duration: null }], "legacy role log, live agent only, no stats in a non-JSON log");

// 000128: the bounce's per-run .dead marker drives the entry status: a run with a sibling
// marker is dead, a markerless run advanced the state itself, the newest run of the live role
// stays live; the stable mtime sort keeps the legacy file before the indexed runs
writeFileSync(join(root, ".kanban", ".logs", `${slug}.developer.0.log`), "run zero\n");
writeFileSync(join(root, ".kanban", ".logs", `${slug}.developer.0.dead`), "424242\n");
writeFileSync(join(root, ".kanban", ".logs", `${slug}.developer.1.log`), "run one\n");
const marked = await detailOf(task.file);
assert.deepEqual(
	marked.agents.map((a) => [a.run, a.status]),
	[[null, "ok"], [0, "dead"], [1, "live"]],
	"the .dead marker marks its own run dead, markerless runs read ok, the newest run of the live role reads live",
);
rmSync(join(root, ".kanban", ".logs", `${slug}.developer.0.log`));
rmSync(join(root, ".kanban", ".logs", `${slug}.developer.0.dead`));
rmSync(join(root, ".kanban", ".logs", `${slug}.developer.1.log`));

// tail: no offset returns the last 100 collapsed lines, with cursors for poll and history
const enc = encodeURIComponent(`${slug}.developer`);
const tail = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(tail.tail, logText.length);
assert.equal(tail.head, (350 - LOG_LINES) * 64);
assert.equal(tail.text, logText.slice(tail.head));
assert.equal(tail.atStart, false);

// poll from an offset returns only new content
const idle = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.tail}`)).json();
assert.equal(idle.text, "");
writeFileSync(logFile, logText + "NEW\n");
const appended = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.tail}`)).json();
assert.equal(appended.text, "NEW\n");
assert.equal(appended.tail, logText.length + 4);

// history: the previous 100 collapsed lines per page, down to the start of the file
const h1 = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.head}&before=1`)).json();
assert.equal(h1.head, tail.head - LOG_LINES * 64);
assert.equal(h1.text, logText.slice(h1.head, tail.head));
const h2 = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${h1.head}&before=1`)).json();
assert.equal(h2.head, h1.head - LOG_LINES * 64);
assert.equal(h2.text, logText.slice(h2.head, h1.head));
const h3 = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${h2.head}&before=1`)).json();
assert.equal(h3.head, 0);
assert.equal(h3.atStart, true);
assert.equal(h3.text + h2.text + h1.text + tail.text, logText);

// unknown files and unknown roles are rejected; merger handles are allowlisted now
assert.equal((await fetch(`${base}/api/agent-log?file=nope.developer`)).status, 404, "a handle needs its task on the board");
assert.equal((await fetch(`${base}/api/agent-log?file=${encodeURIComponent(slug + ".auditor")}`)).status, 404, "an unknown role is rejected");
assert.equal((await fetch(`${base}/api/agent-log?file=${encodeURIComponent(slug + ".merger")}`)).status, 200, "a merger handle is allowlisted (empty until a merger runs)");
assert.equal((await fetch(`${base}/api/agent-log`)).status, 404);

// a past role log lists as a dead agent and streams through the same endpoint
writeFileSync(join(root, ".kanban", ".logs", `${slug}.reviewer.log`), "REVIEW\n");
const past = await detailOf(task.file);
assert.deepEqual(
	past.agents,
	[
		{ role: "developer", run: null, alive: true, status: "live", handle: `${slug}.developer`, tokens: null, duration: null },
		{ role: "reviewer", run: null, alive: false, status: "ok", handle: `${slug}.reviewer`, tokens: null, duration: null },
	],
	"past reviewer after the live developer, pipeline order",
);
const reviewerLog = await (await fetch(`${base}/api/agent-log?file=${encodeURIComponent(slug + ".reviewer")}`)).json();
assert.equal(reviewerLog.text, "REVIEW\n");

// a stale pid file reports the agent as not alive
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), "999999999");
const stale = await detailOf(task.file);
assert.equal(stale.agent.alive, false);
assert.deepEqual(
	stale.agents,
	[
		{ role: "developer", run: null, alive: false, status: "ok", handle: `${slug}.developer`, tokens: null, duration: null },
		{ role: "reviewer", run: null, alive: false, status: "ok", handle: `${slug}.reviewer`, tokens: null, duration: null },
	],
	"a dead state-mapped agent is past too",
);

// leave the board as the daemon section expects it
rmSync(join(root, ".kanban", ".pids", `${slug}.pid`));
rmSync(join(root, ".kanban", ".logs", `${slug}.reviewer.log`));
setState(root, getTask(root, task.file)!, "backlog");

// #247: splitter runs render like the other roles: the agent history includes the Splitter run
// before the Developer (the Splitter runs first in pipeline order, so the start/mtime sort reads
// it first), its handle resolves, sub=list answers 200 and the chunked read streams
const splLog = join(root, ".kanban", ".logs", `${slug}.splitter.0.log`);
writeFileSync(splLog, "SPLIT\n");
utimesSync(splLog, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
const withSplitter = await detailOf(task.file);
assert.deepEqual(
	withSplitter.agents.map((a) => [a.role, a.run, a.status]),
	[["splitter", 0, "ok"], ["developer", null, "ok"]],
	"the splitter run precedes the developer run, chronological order",
);
assert.equal(taskStats({ agents: [{ role: "splitter", tokens: 1200, duration: 30_000 }, { role: "developer", tokens: 800, duration: 10_000 }] }), "2k · 40s", "the board footer sums the splitter run like any role");
const encSpl = encodeURIComponent(`${slug}.splitter.0`);
const splList = await (await fetch(`${base}/api/agent-log?file=${encSpl}&sub=list`)).json();
assert.deepEqual(splList, [], "a splitter handle's sub list answers 200 (the Splitter spawned no subagents)");
const splTail = await (await fetch(`${base}/api/agent-log?file=${encSpl}`)).json();
assert.equal(splTail.text, "SPLIT\n", "a splitter log tail reads like any agent log");
writeFileSync(splLog, "SPLIT\nMORE\n");
const splPoll = await (await fetch(`${base}/api/agent-log?file=${encSpl}&offset=${splTail.tail}`)).json();
assert.equal(splPoll.text, "MORE\n", "a splitter log poll streams the appended content");
rmSync(splLog);

// /api/agent-log renders a JSONL event log into readable lines
const jsonlLog = [
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Checking the board." } }),
	JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "src/webui.ts" } }),
	"not json at all",
].join("\n") + "\n";
writeFileSync(logFile, jsonlLog);
const servedLog = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(servedLog.text.includes('<span class="lg-cont">Checking the board.</span>'), "endpoint renders continuing thinking deltas as the joinable span");
assert.ok(servedLog.text.includes('<details class="lg-tool" data-tc="t1"><summary>read: src/webui.ts</summary>'), "endpoint renders the collapsed tool block");
assert.ok(servedLog.text.includes("not json at all\n"), "endpoint passes non-JSON lines through");
assert.equal(servedLog.model, null, "a log without usage-bearing records carries a null model, the meta line stays hidden");
assert.equal(servedLog.thinkingLevel, null, "a log without usage-bearing records carries a null thinking level too");

// 000151: the meta comes off the latest usage-bearing record only; when that record lacks
// model/thinkingLevel both clear instead of keeping an older record's values
writeFileSync(logFile, [
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 60, output: 40, cacheRead: 500, cacheWrite: 300, reasoning: 10, totalTokens: 900 }, model: "m-1", thinkingLevel: "low" }, timestamp: "2026-10-11T09:36:24.121Z" }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 120, output: 80, cacheRead: 700, cacheWrite: 200, reasoning: 20, totalTokens: 1100 } }, timestamp: "2026-10-11T09:37:24.121Z" }),
].join("\n") + "\n");
const clearedLog = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(clearedLog.model, null, "a latest usage-bearing record without a model clears the meta's model");
assert.equal(clearedLog.thinkingLevel, null, "a latest usage-bearing record without a thinking level clears it too");
// 000177: the card tokens sum input + output over the records, cacheRead/cacheWrite excluded
const tokenEntry = (await detailOf(task.file)).agents.find((a) => a.handle === `${slug}.developer`);
assert.equal(tokenEntry.tokens, 300, "the card tokens sum input + output across the records, cache excluded");

// 000158: an unterminated tail record (an agent mid-write) is not a line yet: init counts
// collapsed lines from the boundary below it and the next poll re-reads the record whole
const bigRecord = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "z".repeat(100000) } });
writeFileSync(logFile, JSON.stringify({ type: "session", id: "s" }) + "\n" + bigRecord);
const splitLog = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(splitLog.text, "", "an unterminated tail record is not a line: init renders nothing of it");
assert.equal(splitLog.tail, (JSON.stringify({ type: "session", id: "s" }) + "\n").length, "init's tail sits on the boundary below the partial record");
writeFileSync(logFile, JSON.stringify({ type: "session", id: "s" }) + "\n" + bigRecord + "\n");
assert.ok((await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${splitLog.tail}`)).json()).text.includes("zzz"), "the record renders whole once its newline arrives");

// 000299: a poll or init window whose last text record carries no newline holds that line's
// records back instead of rendering a partial row; the tail reports the boundary before them, so
// the next poll re-reads them and the line renders whole, exactly once (000084's rule, one level
// down). A before=1 history page keeps the fragment: it renders as a paragraph, no open marker
const deltaRow = (t: string) => JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: t } }) + "\n";
const tableHead = deltaRow("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
const tableCut = deltaRow("| 3 | 4");
// the hold needs a live run: only a live run can write the newline that closes the line
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), String(process.pid));
writeFileSync(logFile, tableHead + tableCut);
const cutInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(!cutInit.text.includes("3"), "init holds the unterminated line back");
assert.ok(cutInit.text.includes('<div class="md-table-wrap" data-open="tbl">'), "the table renders with the open marker, so the line can join it later");
assert.equal(cutInit.tail, tableHead.length, "the tail sits on the record boundary before the held records");
writeFileSync(logFile, tableHead + tableCut + deltaRow(" |\n"));
const cutPoll = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${cutInit.tail}`)).json();
assert.equal(cutPoll.text, "<p>| 3 | 4 |</p>", "the next poll renders the held line whole, exactly once");
const cutAgain = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${cutPoll.tail}`)).json();
assert.equal(cutAgain.text, "", "the held line is not served twice");
const cutHist = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${(tableHead + tableCut).length}&before=1`)).json();
assert.equal(cutHist.head, 0);
assert.ok(cutHist.text.endsWith("<p>| 3 | 4</p>"), "a history page keeps the mid-line cut as a fragment paragraph");
assert.ok(!cutHist.text.includes("data-open"), "the history page's table takes no open marker, the pane never absorbs the fragment");
// a row still streaming keeps the hold across polls, not just the init window: every poll of the
// open line reports the same offset, so no fragment row renders, and the closed line lands whole
writeFileSync(logFile, tableHead + deltaRow("| 3 "));
const streamInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(streamInit.tail, tableHead.length, "init holds the open row and points at its first record");
writeFileSync(logFile, tableHead + deltaRow("| 3 ") + deltaRow("| 4 "));
const streamHeld = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${streamInit.tail}`)).json();
assert.equal(streamHeld.text, "", "a poll whose window is the open row holds it, never a fragment");
assert.equal(streamHeld.tail, streamInit.tail, "the held poll reports the same offset, so nothing renders twice");
writeFileSync(logFile, tableHead + deltaRow("| 3 ") + deltaRow("| 4 ") + deltaRow("|\n"));
const streamDone = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${streamHeld.tail}`)).json();
assert.equal(streamDone.text, "<p>| 3 | 4 |</p>", "the row lands whole, exactly once, after a mid-row poll");
assert.equal((await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${streamDone.tail}`)).json()).text, "", "the whole row is not served a second time");
// a run that is gone never writes the newline that closes its line: the fragment renders as a
// paragraph, so the pane loses nothing and a past run's log still stops polling
rmSync(join(root, ".kanban", ".pids", `${slug}.pid`));
writeFileSync(logFile, tableHead + tableCut);
const deadInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(deadInit.text.endsWith("<p>| 3 | 4</p>"), "a finished run's open line renders as a fragment paragraph instead of holding forever");
assert.ok(!deadInit.text.includes("data-open"), "the fragment takes no open marker, so the pane never absorbs it as a row");

// 000166: an init window on a log mid-thinking holds the still-open block whole from its
// thinking_start as one open Thinking block (never a delta-run orphan span); the later delta
// polls' spans join it client-side and the cross-window thinking_end serves the closing span
const filler = "F".repeat(79) + "\n"; // 80-byte lines
const msStart = JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } }) + "\n";
const msBody = (deltas: string) => filler.repeat(2000) + msStart + filler.repeat(1100) + deltas;
writeFileSync(logFile, msBody(thinkDelta("outside the window") + "\n"));
const msInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(msInit.text.includes('<details class="lg-think" data-open="think"><summary>Thinking</summary><pre><p>outside the window</p></pre></details>'), "the init window holds the still-open thinking block whole from its thinking_start, one open block");
assert.ok(!msInit.text.includes("lg-cont"), "no delta-run orphan span: the window never starts inside the open block");
writeFileSync(logFile, msBody(thinkDelta("outside the window") + "\n" + thinkDelta(" joined") + "\n" + thinkDelta(" in place") + "\n"));
const msPoll = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${msInit.tail}`)).json();
assert.ok(msPoll.text.includes('<span class="lg-cont"> joined in place</span>'), "the next poll renders the new deltas as a joinable span too");
writeFileSync(logFile, msBody(thinkDelta("outside the window") + "\n" + thinkDelta(" joined") + "\n" + thinkDelta(" in place") + "\n") + thinkEnd("authoritative thinking") + "\n");
const msClose = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${msPoll.tail}`)).json();
assert.ok(msClose.text.includes('<span class="lg-cont" data-final="1">authoritative thinking</span>'), "the cross-window thinking_end serves the closing span with the authoritative text");

// 000158 block-aware lines: a thinking block spanning many records is ONE collapsed line, so the
// init window holds it whole even when it outgrows the old byte chunk, and the back-fill page
// never splits a block either
const userPrompt = JSON.stringify({ type: "message_end", message: { role: "user", content: "next" } }) + "\n";
const thinkBlock = (deltas: number) =>
	msStart + Array.from({ length: deltas }, (_, i) => thinkDelta("d" + i) + "\n").join("") + thinkEnd("the whole plan") + "\n";
writeFileSync(logFile, JSON.stringify({ type: "session", id: "s" }) + "\n" + thinkBlock(1500) + userPrompt.repeat(99));
const thinkInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(thinkInit.text.includes('<details class="lg-think"><summary>Thinking</summary><pre><p>the whole plan</p></pre></details>'), "a 1500-record thinking block loads as one unbroken collapsed line with its authoritative content");
assert.ok(!thinkInit.text.includes("lg-cont"), "no split-thinking artifact: a window never starts inside a block");
assert.ok(!thinkInit.text.includes("data-open"), "the block is closed in the window");
assert.equal(thinkInit.head, (JSON.stringify({ type: "session", id: "s" }) + "\n").length, "the window starts at the block: it plus the 99 prompt lines make the last 100 collapsed lines");
writeFileSync(logFile, JSON.stringify({ type: "session", id: "s" }) + "\n" + thinkBlock(300) + userPrompt.repeat(100));
const blockInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(!blockInit.text.includes("lg-think"), "the init window holds the 100 prompt lines, the block sits before it");
const blockHist = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${blockInit.head}&before=1`)).json();
assert.ok(blockHist.text.includes('<details class="lg-think"><summary>Thinking</summary><pre><p>the whole plan</p></pre></details>'), "the back-fill serves the block whole, never split across the page boundary");
assert.ok(!blockHist.text.includes("lg-cont"), "no continuation artifact in the back-fill either");

// 000166: a thinking block still open at the tail (no thinking_end yet) is ONE collapsed line
// too: init holds it whole from its thinking_start, and a scroll-up back-fill from that head
// never re-serves it, so a live phase renders as one open block that the thinking_end finalizes
const openBlock = (deltas: number) => msStart + Array.from({ length: deltas }, (_, i) => thinkDelta("d" + i) + "\n").join("");
writeFileSync(logFile, JSON.stringify({ type: "session", id: "s" }) + "\n" + filler.repeat(100) + openBlock(150));
const openInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(openInit.text.includes('<details class="lg-think" data-open="think"><summary>Thinking</summary><pre><p>d0'), "the open block loads whole from its thinking_start as one open Thinking block");
assert.ok(openInit.text.includes("d149"), "the open block's full delta run renders, a never-ending block is never dropped");
assert.ok(!openInit.text.includes("lg-cont"), "no orphan delta span: the window never starts inside the open block");
assert.equal(openInit.head, (JSON.stringify({ type: "session", id: "s" }) + "\n").length + filler.length, "the open block counts as one line: it plus the 99 filler lines above it make the last 100 collapsed lines");
const openHist = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${openInit.head}&before=1`)).json();
assert.ok(!openHist.text.includes("lg-think") && !openHist.text.includes("lg-cont") && !openHist.text.includes("data-open"), "the back-fill never re-serves the open block: one live phase, one open Thinking block, no stale fragment");

// 000158: a tool call block (tool_execution_start..tool_execution_end) is ONE line too, so the
// window never splits a tool block's result away from its call
const toolLog = [
	JSON.stringify({ type: "session", id: "s" }),
	JSON.stringify({ type: "tool_execution_start", toolCallId: "t9", toolName: "bash", args: { command: "big tool call" } }),
	JSON.stringify({ type: "tool_execution_end", toolCallId: "t9", toolName: "bash", result: { content: [{ type: "text", text: "the whole output" }] }, isError: false }),
].join("\n") + "\n" + userPrompt.repeat(99);
writeFileSync(logFile, toolLog);
const toolInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(toolInit.text.includes('<details class="lg-tool" data-tc="t9"><summary>bash: big tool call</summary>'), "the tool call block loads whole in the window");
assert.ok(toolInit.text.includes('<pre class="lg-out">the whole output</pre>'), "the tool result stays joined to its call");
assert.ok(!toolInit.text.includes("lg-tres"), "no orphan-result span: the window never splits start from end");

// 000218: a claude stream-json log renders through the endpoint from the authoritative
// assistant/user records: text blocks as pending text, thinking and tool_use blocks collapsed, a
// string tool_result content joins its block once, a plain-string user content renders as a
// prompt line, stream_event deltas and system/result records render nothing, and an orphan error
// tool_result shows its failed span
const claudeLog = [
	JSON.stringify({ type: "system", subtype: "init", cwd: "/r", session_id: "s1" }),
	JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", model: "claude-opus-4-6", content: [{ type: "thinking", thinking: "claude plans" }, { type: "text", text: "claude says" }, { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/r/SPECS.md" } }] } }),
	JSON.stringify({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false, content: "specs body" }] } }),
	JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", model: "claude-opus-4-6", content: [{ type: "text", text: "claude done" }], usage: { input_tokens: 30, output_tokens: 70 } } }),
	JSON.stringify({ type: "user", parent_tool_use_id: null, message: { role: "user", content: "initial prompt" } }),
	JSON.stringify({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "DELTAONLY" } } }),
	JSON.stringify({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_9", is_error: true, content: "boom" }] } }),
	JSON.stringify({ type: "result", subtype: "success", is_error: false, duration_ms: 1234, result: "claude done", usage: { input_tokens: 30, output_tokens: 70 } }),
].join("\n") + "\n";
writeFileSync(logFile, claudeLog);
const claudeServed = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(claudeServed.text.includes('<details class="lg-think"><summary>Thinking</summary>'), "the claude thinking block renders as a closed Thinking block");
assert.ok(claudeServed.text.includes("<p>claude plans</p>"), "the claude thinking content renders inside the block");
assert.ok(claudeServed.text.includes("<summary>Read: /r/SPECS.md</summary>"), "the tool_use block summarizes off its file_path input");
assert.ok(claudeServed.text.includes("&quot;file_path&quot;: &quot;/r/SPECS.md&quot;"), "the tool_use input renders as the escaped args JSON block");
assert.ok(claudeServed.text.includes('<pre class="lg-out">specs body</pre>'), "a string tool_result content joins its block once");
assert.ok(claudeServed.text.includes("<p>claude done</p>"), "the claude text block renders as pending text");
assert.ok(claudeServed.text.includes("[prompt] initial prompt\n"), "a plain-string user content renders as a prompt line");
assert.ok(!claudeServed.text.includes("DELTAONLY"), "stream_event deltas never double-render the authoritative records");
assert.ok(claudeServed.text.includes('data-sum="? failed: boom"'), "an orphan error tool_result renders its failed span");
assert.ok(!claudeServed.text.includes('"type"'), "claude records never leak raw JSON");
assert.equal(claudeServed.model, "claude-opus-4-6", "the meta line comes off the latest usage-bearing claude record");

// 000218: the claude stats dedupe by message.id (one API turn emits several assistant records
// sharing the same usage) and a finished run's duration comes from the result record's wall-clock
// duration_ms, preferred over any record-timestamp difference
writeFileSync(logFile, [
	JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", model: "claude-opus-4-6", id: "msg_1", content: [{ type: "text", text: "a" }], usage: { input_tokens: 30, output_tokens: 70, cache_read_input_tokens: 500 } }, timestamp: "2026-10-11T09:36:24.121Z" }),
	JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", model: "claude-opus-4-6", id: "msg_1", content: [{ type: "text", text: "a2" }], usage: { input_tokens: 30, output_tokens: 70 } }, timestamp: "2026-10-11T09:36:25.121Z" }),
	JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", model: "claude-opus-4-6", id: "msg_2", content: [{ type: "text", text: "b" }], usage: { input_tokens: 10, output_tokens: 20 } } }),
	JSON.stringify({ type: "result", subtype: "success", is_error: false, duration_ms: 4321, result: "done", usage: { input_tokens: 40, output_tokens: 90 } }),
].join("\n") + "\n");
const claudeEntry = (await detailOf(task.file)).agents.find((a) => a.handle === `${slug}.developer`);
assert.equal(claudeEntry.tokens, 130, "the repeated msg_1 counts once and cache_read_input_tokens stays excluded");
assert.equal(claudeEntry.duration, 4321, "the result record's wall-clock duration wins over the record-timestamp difference");
assert.equal((await (await fetch(`${base}/api/agent-log?file=${enc}`)).json()).model, "claude-opus-4-6", "the meta's model comes off the latest usage-bearing record even without a timestamp");

// 000218: a claude stream_event block (content_block_start..content_block_stop with the deltas
// between, all separate records) counts as ONE collapsed line paired by event.index, so the init
// window starts at its content_block_start; a block still open at the tail counts as one line
// from its content_block_start too
const evStart = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } }) + "\n";
const evDelta = (t: string) => JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: t } } }) + "\n";
const evStop = JSON.stringify({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }) + "\n";
const evSession = JSON.stringify({ type: "session", id: "s" }) + "\n";
const evRun = Array.from({ length: 150 }, (_, i) => evDelta("d" + i)).join("");
writeFileSync(logFile, evSession + filler.repeat(100) + evStart + evRun + evStop + userPrompt.repeat(99));
const evInit = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(evInit.head, evSession.length + filler.repeat(100).length, "the claude stream block counts as ONE line: it plus the 99 prompt lines make the last 100 collapsed lines");
assert.ok(!evInit.text.includes("lg-cont"), "the window never starts inside a claude block");
assert.ok(!evInit.text.includes("thinking_delta"), "the stream deltas render nothing");
writeFileSync(logFile, evSession + filler.repeat(100) + evStart + evRun);
const evOpen = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(evOpen.head, evSession.length + filler.length, "an open claude block still counts as one line from its content_block_start");
assert.ok(!evOpen.text.includes("lg-cont"), "the open block's window never starts inside the block either");

// 000084: a JSONL record split across two poll windows renders exactly once, when its newline
// arrives. The first poll's tail sits on the last record boundary, so the next poll re-reads the
// partial record from its start instead of stripping it as a mid-record head line.
const splitRecord = JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "splittable record" } });
const splitPrefix = "legacy line\n";
for (const at of [1, 20, splitRecord.length >> 1, splitRecord.length - 1]) {
	writeFileSync(logFile, splitPrefix + splitRecord.slice(0, at));
	const first = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
	assert.equal(first.text, splitPrefix, `split at ${at}: the terminated line renders, the partial record does not`);
	assert.equal(first.tail, splitPrefix.length, `split at ${at}: the tail sits on the last record boundary`);
	writeFileSync(logFile, splitPrefix + splitRecord + "\n");
	const second = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${first.tail}`)).json();
	assert.equal(second.text, "<p>splittable record</p>", `split at ${at}: the record renders once its newline arrives`);
	assert.equal(second.tail, (splitPrefix + splitRecord + "\n").length, `split at ${at}: the tail advances past the completed record`);
	const third = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${second.tail}`)).json();
	assert.equal(third.text, "", `split at ${at}: the already-served prefix is not rendered twice`);
}
// the split can land inside a multi-byte character: the boundary stays before the record and the
// second poll re-reads the completed record whole, without a replacement glyph
const uniRecord = Buffer.from(splitPrefix + JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "→ done" } }) + "\n", "utf8");
writeFileSync(logFile, uniRecord.subarray(0, uniRecord.indexOf(Buffer.from("→")) + 1));
const uniFirst = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(uniFirst.text, splitPrefix, "a mid-multibyte split serves only the terminated line");
assert.equal(uniFirst.tail, splitPrefix.length, "a mid-multibyte split still reports the boundary before the record");
writeFileSync(logFile, uniRecord);
assert.equal((await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${uniFirst.tail}`)).json()).text, "<p>→ done</p>", "a record split mid-multibyte renders whole once its newline arrives");

// a finished log: the tail is terminal records (assistant message_end, turn_end, agent_end,
// agent_settled) that render to nothing, so an unrenderable tail chunk walks back instead of
// serving an empty pane
const pad = "z".repeat(100000); // one assistant message_end record bigger than the old byte chunk, and still one collapsed line
const terminalLog = [
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "final output line" } }),
	JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: pad }], timestamp: 2 } }),
	JSON.stringify({ type: "turn_end", timestamp: 3 }),
	JSON.stringify({ type: "agent_end", timestamp: 4 }),
	JSON.stringify({ type: "agent_settled", timestamp: 5 }),
].join("\n") + "\n";
writeFileSync(logFile, terminalLog);
const finished = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(finished.text.includes("<p>final output line</p>"), "an unrenderable tail chunk walks back to the last chunk with renderable content");
assert.equal(finished.head, 0);
assert.equal(finished.tail, terminalLog.length);
assert.equal(finished.atStart, true);
assert.ok(!finished.text.includes('"type"'), "walk-back serves rendered text, never raw JSON");
// an offset poll keeps its window: the client already consumed the region below its offset
const finishedPoll = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${finished.tail}`)).json();
assert.equal(finishedPoll.text, "");
assert.equal(finishedPoll.head, finished.tail);

// 000158: a back-fill page of terminal records renders empty and walks back by collapsed lines to
// the renderable content before them, so history never lands on an empty pane
const turn = JSON.stringify({ type: "turn_end", timestamp: 9 }) + "\n";
const paddedLog =
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "early delta" } }) + "\n" +
	turn.repeat(250) +
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "tail delta" } }) + "\n" +
	turn.repeat(50);
writeFileSync(logFile, paddedLog);
const padded = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(padded.text.includes("<p>tail delta</p>"), "a renderable tail window serves without walking back");
assert.ok(!padded.text.includes("<p>early delta</p>"), "the init window holds the last 100 collapsed lines only");
const paddedHist = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${padded.head}&before=1`)).json();
assert.ok(paddedHist.text.includes("<p>early delta</p>"), "a back-fill page of terminal records walks back by lines to renderable content");
assert.equal(paddedHist.head, 0);
assert.equal(paddedHist.atStart, true);


// 000088 per-run agent history: every `<slug>.<role>.<n>.log` is an entry of its own, a legacy
// unsuffixed file stays readable and sorts before its role's runs, and the entries are ordered by
// log mtime, so the run buttons read chronologically across roles
setState(root, getTask(root, task.file)!, "doing");
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), String(process.pid));
const logsDir = join(root, ".kanban", ".logs");
const dev0 = join(logsDir, `${slug}.developer.0.log`);
const dev1 = join(logsDir, `${slug}.developer.1.log`);
const lt0 = join(logsDir, `${slug}.live-tester.0.log`);
const lt1 = join(logsDir, `${slug}.live-tester.1.log`);
const rv0 = join(logsDir, `${slug}.reviewer.0.log`);
const mg0 = join(logsDir, `${slug}.merger.0.log`);
const mg1 = join(logsDir, `${slug}.merger.1.log`);
writeFileSync(logFile, "LEGACY\n");
writeFileSync(dev0, "RUN0\n");
writeFileSync(dev1, "RUN1\n");
writeFileSync(lt0, "LT\n");
writeFileSync(lt1, "LT1\n");
writeFileSync(rv0, "RV\n");
writeFileSync(mg0, "MG0\n");
writeFileSync(mg1, "MG1\n");
// mtime decides: the legacy developer file ties with run 0 (legacy first), then run 1, a
// live-tester run, a reviewer run, all inside a merger run on each side of the range
const t0 = Math.floor(Date.now() / 1000) - 1000;
const at = (file: string, seconds: number) => utimesSync(file, seconds, seconds);
at(mg0, t0 - 10);
at(logFile, t0);
at(dev0, t0);
at(dev1, t0 + 10);
at(lt0, t0 + 20);
at(lt1, t0 + 30); // ties with the reviewer run: pipeline order breaks the tie (reviewer first)
at(rv0, t0 + 30);
at(mg1, t0 + 40);
const history = await detailOf(task.file);
assert.deepEqual(
	history.agents,
	[
		{ role: "merger", run: 0, alive: false, status: "ok", handle: `${slug}.merger.0`, tokens: null, duration: null },
		{ role: "developer", run: null, alive: false, status: "ok", handle: `${slug}.developer`, tokens: null, duration: null },
		{ role: "developer", run: 0, alive: false, status: "ok", handle: `${slug}.developer.0`, tokens: null, duration: null },
		{ role: "developer", run: 1, alive: true, status: "live", handle: `${slug}.developer.1`, tokens: null, duration: null },
		{ role: "live-tester", run: 0, alive: false, status: "ok", handle: `${slug}.live-tester.0`, tokens: null, duration: null },
		{ role: "reviewer", run: 0, alive: false, status: "ok", handle: `${slug}.reviewer.0`, tokens: null, duration: null },
		{ role: "live-tester", run: 1, alive: false, status: "ok", handle: `${slug}.live-tester.1`, tokens: null, duration: null },
		{ role: "merger", run: 1, alive: false, status: "ok", handle: `${slug}.merger.1`, tokens: null, duration: null },
	],
	"indexed runs are their own entries, a legacy file ties first within its role, mtime orders across roles, the newest run of the live role is the live one",
);
assert.deepEqual(history.agent, { role: "developer", alive: true, log: `${slug}.developer.1` }, "the agent handle points at the live run, never the legacy file");

// 000108: a run label renders 1-based on the payload's 0-based run index; a legacy unsuffixed log
// (run null) and a solo run stay unnumbered, disk names and handles unchanged
const devRuns = history.agents.filter((a) => a.role === "developer");
assert.equal(agentLabel(devRuns[1], { developer: 3 }), "Developer 1", "run index 0 labels 1 when the role has several runs");
assert.equal(agentLabel(devRuns[2], { developer: 3 }), "Developer 2", "run index 1 labels 2");
assert.equal(agentLabel(devRuns[0], { developer: 3 }), "Developer", "a legacy unsuffixed run keeps its unnumbered label");
assert.equal(agentLabel({ role: "reviewer", run: 0 }, { reviewer: 1 }), "Reviewer", "a solo run keeps its unnumbered label");
assert.equal(agentLabel({ role: "doctor", run: 0 }, { doctor: 2 }), "Doctor", "a doctor entry stays unnumbered with several doctor cards");
assert.equal(agentLabel({ role: "doctor", run: 1 }, { doctor: 3 }), "Doctor", "a doctor entry stays unnumbered whatever run index it carries");
assert.ok(page.includes(String(agentLabel)), "the page ships the tested agentLabel source");

// 000337: a project-wide lane runs once per project, so its pid file is named after the role and
// not after the task slug: a live integration-tester or merger must mark its newest run live (the
// card spins, the log pane holds its open line), and a stale lane pid must leave the run finished
const laneRoot = mkdtempSync(join(tmpdir(), "webui-lane-"));
const laneTask = createTask(laneRoot, { name: "feat: lane live card", summary: "s", specs: "s" });
const laneSlug = laneTask.file.replace(/\.md$/, "");
const laneDetail = () => taskHistory(laneRoot, parseInt(laneTask.file, 10))!;
const laneLogs = join(laneRoot, ".kanban", ".logs");
const lanePids = join(laneRoot, ".kanban", ".pids");
mkdirSync(laneLogs, { recursive: true });
mkdirSync(lanePids, { recursive: true });
setState(laneRoot, getTask(laneRoot, laneTask.file)!, "integration-testing");
writeFileSync(join(laneLogs, `${laneSlug}.integration-tester.0.log`), "IT RUN\n");
writeFileSync(join(lanePids, "integration-tester.pid"), String(process.pid));
const laneIt = await laneDetail();
assert.deepEqual(
	laneIt.agents,
	[{ role: "integration-tester", run: 0, alive: true, status: "live", handle: `${laneSlug}.integration-tester.0`, tokens: null, duration: null }],
	"a live integration-tester lane pid marks the newest run live, so its card spins",
);
assert.deepEqual(laneIt.agent, { role: "integration-tester", alive: true, log: `${laneSlug}.integration-tester.0` }, "the card's agent handle opens the live integration-tester run");
writeFileSync(join(lanePids, "integration-tester.pid"), "999999");
assert.deepEqual(
	(await laneDetail()).agents[0],
	{ role: "integration-tester", run: 0, alive: false, status: "ok", handle: `${laneSlug}.integration-tester.0`, tokens: null, duration: null },
	"a stale integration-tester lane pid leaves the finished run not live",
);
rmSync(join(lanePids, "integration-tester.pid"));
setState(laneRoot, getTask(laneRoot, laneTask.file)!, "merging");
writeFileSync(join(laneLogs, `${laneSlug}.merger.0.log`), "MG RUN\n");
writeFileSync(join(lanePids, "merger.pid"), String(process.pid));
const laneMg = await laneDetail();
assert.deepEqual(
	laneMg.agents.find((a) => a.role === "merger"),
	{ role: "merger", run: 0, alive: true, status: "live", handle: `${laneSlug}.merger.0`, tokens: null, duration: null },
	"a live merger lane pid marks the newest merger run live, so its card spins",
);
assert.deepEqual(laneMg.agent, { role: "merger", alive: true, log: `${laneSlug}.merger.0` }, "the card's agent handle opens the live merger run");
rmSync(laneRoot, { recursive: true, force: true });

// 000120 card stats: tokens render raw below 1000, kilo (42k), mega from a million (2.3M); duration
// keeps one decimal below 10s then minutes; missing stats render empty
assert.equal(fmtTokens(42311), "42k", "tokens render in kilo");
assert.equal(fmtTokens(999), "999", "tokens below 1000 render raw");
assert.equal(fmtTokens(842), "842", "tokens below 1000 render raw");
assert.equal(fmtTokens(999499), "999k", "tokens just under a mega render in kilo");
assert.equal(fmtTokens(999500), "1.0M", "tokens at the mega boundary render one decimal M");
assert.equal(fmtTokens(1500000), "1.5M", "tokens from a million render one decimal M");
assert.equal(fmtTokens(null), "", "missing tokens render empty");
assert.equal(fmtDur(3479), "3s", "a duration rounds to integer seconds");
assert.equal(fmtDur(60000), "1m", "a whole minute drops the zero seconds");
assert.equal(fmtDur(86592), "1m 27s", "minutes and seconds");
assert.equal(fmtDur(3599000), "59m 59s", "durations below an hour keep the minutes format");
assert.equal(fmtDur(3600000), "1h", "an hour drops the zero minutes and seconds");
assert.equal(fmtDur(3660000), "1h 1m", "an hour and a minute drops the zero seconds");
assert.equal(fmtDur(3661000), "1h 1m 1s", "hours, minutes and seconds");
assert.equal(fmtDur(7261000), "2h 1m 1s", "hours above one render the full count");
assert.equal(fmtDur(null), "", "a missing duration renders empty");
assert.ok(page.includes(String(fmtTokens)) && page.includes(String(fmtDur)), "the page ships the tested stats formatters");

// a run-suffixed handle resolves to its own indexed file, a plain handle to the legacy file
const get = (file: string) => fetch(`${base}/api/agent-log?file=${encodeURIComponent(file)}`);
assert.equal((await (await get(`${slug}.developer.1`)).json()).text, "RUN1\n", "a run handle serves its own indexed file, never the legacy file");
assert.equal((await (await get(`${slug}.developer.0`)).json()).text, "RUN0\n");
assert.equal((await (await get(`${slug}.developer`)).json()).text, "LEGACY\n", "the plain handle still serves the legacy file");
assert.equal((await (await get(`${slug}.merger.1`)).json()).text, "MG1\n", "an indexed merger handle serves its own file");
assert.equal((await get(`${slug}.developer.x`)).status, 404, "a non-numeric run index is rejected");
assert.equal((await get(`${slug}.developer.0.1`)).status, 404, "a doubly suffixed handle is rejected");
assert.equal((await get("nope.developer.0")).status, 404, "a run handle needs its task on the board");
// the #67 walk-back applies to a run-suffixed handle too
writeFileSync(dev1, terminalLog);
const walkedRun = await (await get(`${slug}.developer.1`)).json();
assert.ok(walkedRun.text.includes("<p>final output line</p>") && walkedRun.head === 0, "an unrenderable tail of a run log walks back to renderable content");

// 000120 usage stats: agentHistory entries carry tokens (the sum of the turn_end
// message.usage input + output, cacheRead/cacheWrite excluded) and duration; timestamps arrive as ISO
// strings and epoch-ms numbers alike
writeFileSync(dev1, [
	JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date(Date.now() - 600000).toISOString() }),
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "working" } }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 1500, cost: { total: 0 } }, model: "m-1", thinkingLevel: "low" }, timestamp: Date.now() - 570000 }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 25000, output: 2500, cacheRead: 30000, cacheWrite: 1200, reasoning: 800, totalTokens: 58700 }, model: "m-2", thinkingLevel: "high" }, timestamp: new Date(Date.now() - 540000).toISOString() }),
].join("\n") + "\n");
const statEntry = (await detailOf(task.file)).agents.find((a) => a.handle === `${slug}.developer.1`);
assert.equal(statEntry.tokens, 27515, "tokens sums input + output across the run log, cacheRead/cacheWrite excluded");
assert.ok(statEntry.duration >= 600000, "a live run's duration ticks with now - first (the session record here), not the frozen parsed last - first");
// 000169: a finished run is not live, so its duration stays the parsed last - first even when
// the run ended long ago
// both timestamps derive from one base: two Date.now() calls can straddle a ms boundary under load, making the parsed duration 5001+ and failing the exact assertion below
const finishedBase = Date.now() - 600000;
writeFileSync(lt1, [
	JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date(finishedBase).toISOString() }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { totalTokens: 10 } }, timestamp: new Date(finishedBase + 5000).toISOString() }),
].join("\n") + "\n");
const finishedEntry = (await detailOf(task.file)).agents.find((a) => a.handle === `${slug}.live-tester.1`);
assert.equal(finishedEntry.duration, 5000, "a finished run keeps the parsed last - first");
// 000146: the chunked payload carries the meta off the latest usage-bearing record, so the log
// pane's meta line refreshes on every poll
const statPayload = await (await get(`${slug}.developer.1`)).json();
assert.equal(statPayload.model, "m-2", "the payload's model comes off the latest usage-bearing record");
assert.equal(statPayload.thinkingLevel, "high", "the payload's thinking level comes off the latest usage-bearing record");

// 000088 subagent transcripts: the Agent tool result in the parent log names each background agent
// and its .output file; sub=list enumerates them, sub=<n> serves the n-th through the same payload
mkdirSync("/tmp/pi-subagents-1000", { recursive: true });
const subDir = mkdtempSync("/tmp/pi-subagents-1000/webui-test-");
const out0 = join(subDir, "aaaaaaaa-0000-0000-0000-000000000000.output");
const out1 = join(subDir, "bbbbbbbb-0000-0000-0000-000000000000.output");
writeFileSync(out0, "SUB ZERO\n");
writeFileSync(out1, [
	JSON.stringify({ isSidechain: true, agentId: "bbbbbbbb", type: "user", message: { role: "user", content: "do the thing" }, timestamp: "2026-10-11T09:40:00.000Z" }),
	JSON.stringify({ isSidechain: true, type: "assistant", message: { role: "assistant", usage: { input: 10000, output: 1000, cacheRead: 0, cacheWrite: 0, reasoning: 400, totalTokens: 11000 }, model: "sub-model", thinkingLevel: "medium" }, timestamp: "2026-10-11T09:40:11.239Z" }),
	"plain fallback",
].join("\n") + "\n");
const subPath = (id: string, file: string) =>
	JSON.stringify({
		type: "tool_execution_end",
		toolCallId: id,
		toolName: "Agent",
		result: { content: [{ type: "text", text: `Agent started in background.\nAgent ID: ${id}\nType: subagent\nOutput file: ${file}\n\nYou will be notified when it settles.` }] },
		isError: false,
	});
writeFileSync(
	rv0,
	[
		subPath("aaaaaaaa-0000-0000-0000-000000000000", out0),
		// one spawn emits more records under the same toolCallId: only tool_execution_end counts
		JSON.stringify({ type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "Agent ID: aaaaaaaa-0000-0000-0000-000000000000" }] } }),
		subPath("bbbbbbbb-0000-0000-0000-000000000000", out1),
		subPath("cccccccc-0000-0000-0000-000000000000", "/etc/evil.output"),
		subPath("dddddddd-0000-0000-0000-000000000000", "/tmp/pi-subagents-1000/../evil.output"),
		subPath("eeeeeeee-0000-0000-0000-000000000000", join(subDir, "notes.txt")),
	].join("\n") + "\n",
);
const rvEnc = encodeURIComponent(`${slug}.reviewer.0`);
const subList = await (await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=list`)).json();
assert.deepEqual(
	subList,
	[
		{ id: "aaaaaaaa-0000-0000-0000-000000000000", index: 0, tokens: null, duration: null },
		{ id: "bbbbbbbb-0000-0000-0000-000000000000", index: 1, tokens: 11000, duration: 11239 },
	],
	"sub=list enumerates background agents in log order with their tokens and duration, and drops non-transcript records and paths outside pi's .output dir",
);
const subZero = await (await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=0`)).json();
assert.equal(subZero.text, "SUB ZERO\n", "sub=0 serves the first subagent transcript through the chunked payload");
const subOne = await (await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=1`)).json();
assert.equal(subOne.text, "[prompt] do the thing\nplain fallback\n", "a sidechain user record renders the prompt, its non-JSON line still passes through");
assert.equal(subOne.model, "sub-model", "a subagent transcript's payload carries the model off its latest usage-bearing assistant record");
assert.equal(subOne.thinkingLevel, "medium", "a subagent transcript's payload carries the thinking level too");
assert.equal((await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=9`)).status, 404, "an out-of-range subagent index is rejected");
assert.equal((await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=x`)).status, 404, "a non-numeric subagent index is rejected");
assert.equal((await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=1abc`)).status, 404, "a partially numeric subagent index is rejected too");
assert.deepEqual(await (await fetch(`${base}/api/agent-log?file=${encodeURIComponent(`${slug}.live-tester.0`)}&sub=list`)).json(), [], "a log without spawn records yields an empty subagent list, never an error");
// the memoized sub list must refresh when the parent log grows
const out2 = join(subDir, "ffffffff-0000-0000-0000-000000000000.output");
writeFileSync(out2, "SUB TWO\n");
appendFileSync(rv0, subPath("ffffffff-0000-0000-0000-000000000000", out2) + "\n");
const grown = await (await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=list`)).json();
assert.deepEqual(grown.map(s => s.id), ["aaaaaaaa-0000-0000-0000-000000000000", "bbbbbbbb-0000-0000-0000-000000000000", "ffffffff-0000-0000-0000-000000000000"], "a parent log that grew invalidates the memoized sub list");

// 000118 sidechain walk-back: a subagent tail that renders nothing walks back to the head chunk,
// which now renders the prompt, so a fresh open never lands on an empty pane
const out3 = join(subDir, "11111111-0000-0000-0000-000000000000.output");
writeFileSync(out3, [
	JSON.stringify({ isSidechain: true, agentId: "11111111", type: "user", message: { role: "user", content: "walk back to me" } }),
	JSON.stringify({ isSidechain: true, agentId: "11111111", type: "system", message: { role: "system", content: "x".repeat(81920) } }),
	JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "now", cwd: "/r" }),
].join("\n") + "\n");
appendFileSync(rv0, subPath("11111111-0000-0000-0000-000000000000", out3) + "\n");
const subTwo = await (await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=3`)).json();
assert.ok(subTwo.text.includes("[prompt] walk back to me\n") && subTwo.head === 0, "a subagent tail that renders nothing walks back to the prompt, never an empty pane");

// 000123 finished runs: the sweep replaces a finished run's plain .log with .log.gz and the
// read path decompresses transparently - the history entry, its stats, its subs and the
// chunked payload all keep working on the gzipped file
writeFileSync(`${dev0}.gz`, gzipSync(Buffer.from([
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "from the gzipped run" } }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 24000, output: 5000, cacheRead: 10000, cacheWrite: 2000, reasoning: 3000, totalTokens: 44000 } }, timestamp: Date.parse("2026-10-11T09:36:24.121Z") }),
].join("\n") + "\n")));
rmSync(dev0);
const gzEntry = (await detailOf(task.file)).agents.find((a) => a.handle === `${slug}.developer.0`);
assert.ok(gzEntry, "a gzipped run stays in the agent history");
assert.equal(gzEntry.tokens, 29000, "the gzipped run's stats parse from the decompressed records");
assert.ok((await (await get(`${slug}.developer.0`)).json()).text.includes("<p>from the gzipped run</p>"), "/api/agent-log serves the gzipped run with renderable content");
// the unrenderable tail walk-back indexes the decompressed text the same way
writeFileSync(`${dev0}.gz`, gzipSync(Buffer.from(terminalLog)));
const gzWalk = await (await get(`${slug}.developer.0`)).json();
assert.ok(gzWalk.text.includes("<p>final output line</p>") && gzWalk.head === 0, "an unrenderable tail of a gzipped log walks back on the decompressed text");
assert.equal((await (await fetch(`${base}/api/agent-log?file=${encodeURIComponent(`${slug}.developer.0`)}&offset=${gzWalk.tail}`)).json()).text, "", "a poll of a finished gzipped log is a no-op");
// subagent matching parses decompressed records: a gzipped parent log still enumerates its subs
writeFileSync(`${rv0}.gz`, gzipSync(readFileSync(rv0)));
rmSync(rv0);
const gzSubList = await (await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=list`)).json();
assert.deepEqual(gzSubList.map((s: any) => s.id), [
	"aaaaaaaa-0000-0000-0000-000000000000",
	"bbbbbbbb-0000-0000-0000-000000000000",
	"ffffffff-0000-0000-0000-000000000000",
	"11111111-0000-0000-0000-000000000000",
], "a gzipped parent log still enumerates its subagent transcripts");
// the legacy unsuffixed log gzips too and its plain handle keeps resolving
writeFileSync(`${logFile}.gz`, gzipSync(Buffer.from("LEGACY\n")));
rmSync(logFile);
assert.ok(
	(await detailOf(task.file)).agents.some((a) => a.handle === `${slug}.developer`),
	"a gzipped legacy log stays in the history",
);
assert.equal((await (await get(`${slug}.developer`)).json()).text, "LEGACY\n", "the plain handle serves the gzipped legacy log");

// restore the board for the daemon section below
rmSync(join(root, ".kanban", ".pids", `${slug}.pid`));
for (const f of [dev0, dev1, lt0, lt1, rv0, mg0, mg1, `${dev0}.gz`, `${rv0}.gz`, `${logFile}.gz`]) rmSync(f, { force: true });
rmSync(subDir, { recursive: true, force: true });
setState(root, getTask(root, task.file)!, "backlog");

// 000139 the gzip sweep rewrites finished logs' mtimes in readdir order, so mtime no longer
// reflects chronology: the history sorts by the first in-log record timestamp, a log without a
// parseable timestamp still sorts by its mtime
const sweepT = Date.parse("2026-10-12T07:33:03.000Z");
writeFileSync(logFile, "LEGACY\n"); // timestamp-less, sorts by its mtime between the swept runs
at(logFile, (sweepT + 50_000) / 1000);
writeFileSync(`${dev0}.gz`, gzipSync(Buffer.from(JSON.stringify({ type: "session", id: "s", timestamp: "2026-10-12T07:34:03.000Z" }) + "\n")));
at(`${dev0}.gz`, sweepT / 1000); // the sweep's fresh mtime, inverted against the in-log order
writeFileSync(`${dev1}.gz`, gzipSync(Buffer.from(JSON.stringify({ type: "session", id: "s", timestamp: "2026-10-12T07:33:13.000Z" }) + "\n")));
at(`${dev1}.gz`, (sweepT + 100_000) / 1000);
const swept = await detailOf(task.file);
assert.deepEqual(
	swept.agents.map((a) => a.handle),
	[`${slug}.developer.1`, `${slug}.developer`, `${slug}.developer.0`],
	"in-log first-record timestamps order the swept runs chronologically, the timestamp-less legacy log still sorts by mtime",
);
rmSync(logFile, { force: true });
rmSync(`${dev0}.gz`, { force: true });
rmSync(`${dev1}.gz`, { force: true });

// 000248 the light detail reads no logs: a probe child patches the fs module and counts every
// read under .logs while taskDetail answers; a corrupt run log that would fail the parse stays
// unread, the text shows on the light read alone and the heavy history loads in the follow-up
const probeRoot = mkdtempSync(join(tmpdir(), "webui-probe-"));
const probeTask = createTask(probeRoot, { name: "feat: probe detail", summary: "s", specs: "s" });
const probeSlug = probeTask.file.replace(/\.md$/, "");
mkdirSync(join(probeRoot, ".kanban", ".logs"), { recursive: true });
writeFileSync(join(probeRoot, ".kanban", ".logs", `${probeSlug}.developer.0.log.gz`), Buffer.from("not gzip"));
writeFileSync(join(probeRoot, ".kanban", ".logs", `${probeSlug}.developer.0.doctor.log`), JSON.stringify({ type: "session", id: "s", timestamp: "2026-10-12T07:34:03.000Z" }) + "\n");
writeFileSync(join(probeRoot, ".kanban", ".logs", `${probeSlug}.developer.log`), "plain legacy run log\n");
const probePreload = join(tmpdir(), `webui-probe-preload-${process.pid}.cjs`);
writeFileSync(probePreload, `
const fs = require("node:fs");
globalThis.__logReads = [];
for (const name of ["readFileSync", "readdirSync", "statSync", "openSync", "existsSync"]) {
	const orig = fs[name];
	fs[name] = function (p, ...rest) {
		if (String(p).includes(".logs")) globalThis.__logReads.push(name + " " + p);
		return orig.apply(this, [p, ...rest]);
	};
}
const zlib = require("node:zlib");
const gz = zlib.gunzipSync;
zlib.gunzipSync = function (...a) { globalThis.__logReads.push("gunzipSync"); return gz.apply(this, a); };
`);
const probeCode = `
import { pathToFileURL } from "node:url";
const payload = await import(pathToFileURL(process.env.HERE + "/../../src/webui/payload.ts").href);
const d = payload.taskDetail(process.env.ROOT, Number(process.env.NUM));
console.log(JSON.stringify({ body: !!(d && typeof d.body === "string" && d.body.length), hasAgents: !!d && "agents" in d, logReads: globalThis.__logReads.length }));
`;
const probeOut = spawnSync(process.execPath, ["--require", probePreload, "--input-type=module", "-e", probeCode], {
	env: { ...process.env, HERE, ROOT: probeRoot, NUM: String(parseInt(probeTask.file, 10)) },
	encoding: "utf8",
});
const probe = JSON.parse(probeOut.stdout);
assert.ok(probe.body, "the light detail serves the body text");
assert.ok(!probe.hasAgents, "the light detail carries no agent data");
assert.equal(probe.logReads, 0, "the light detail parses no logs (probe counted .logs reads)");

// 000248 the hub never lets a heavy parse stall another client: a probe hub patches readFileSync
// with a 100 ms block per doctor log, the history fetch parses two doctor logs and the concurrent
// /api/tasks poll must land between the two parses, not queue behind both
const orderRoot = mkdtempSync(join(tmpdir(), "webui-order-"));
const orderHome = mkdtempSync(join(tmpdir(), "webui-order-home-"));
const orderTask = createTask(orderRoot, { name: "feat: parse order", summary: "s", specs: "s" });
const orderSlug = orderTask.file.replace(/\.md$/, "");
mkdirSync(join(orderRoot, ".kanban", ".logs"), { recursive: true });
writeFileSync(join(orderRoot, ".kanban", ".logs", `${orderSlug}.developer.log`), JSON.stringify({ type: "session", id: "s", timestamp: "2026-10-12T07:34:03.000Z" }) + "\n");
writeFileSync(join(orderRoot, ".kanban", ".logs", `${orderSlug}.developer.0.doctor.log`), JSON.stringify({ type: "session", id: "s", timestamp: "2026-10-12T07:35:03.000Z" }) + "\n");
writeFileSync(join(orderRoot, ".kanban", ".logs", `${orderSlug}.developer.1.doctor.log`), JSON.stringify({ type: "session", id: "s", timestamp: "2026-10-12T07:36:03.000Z" }) + "\n");
const orderPreload = join(tmpdir(), `webui-order-preload-${process.pid}.cjs`);
// 000250: the incremental parse reads plain logs by openSync/readSync windows, so the heavy
// cold parse hangs on openSync (readFileSync never sees a plain log's window)
writeFileSync(orderPreload, `
const fs = require("node:fs");
const orig = fs.openSync;
fs.openSync = function (p, ...rest) {
	if (String(p).includes(".doctor")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	return orig.apply(this, [p, ...rest]);
};
`);
const orderCode = `
import { pathToFileURL } from "node:url";
const hub = (await import(pathToFileURL(process.env.HERE + "/../../src/hub.ts").href)).startHub;
const ui = await hub({ name: "order-test", root: process.env.ROOT, host: "127.0.0.1", port: 0 });
console.log("PORT " + ui.port);
setInterval(() => {}, 10_000);
`;
const orderChild = spawn(process.execPath, ["--require", orderPreload, "--input-type=module", "-e", orderCode], {
	env: { ...process.env, HERE, ROOT: orderRoot, HOME: orderHome },
	cwd: HERE,
	stdio: ["ignore", "pipe", "pipe"],
});
let orderPort = "";
orderChild.stdout.setEncoding("utf8");
orderChild.stdout.on("data", (c: string) => { const m = c.match(/PORT (\d+)/); if (m) orderPort = m[1]; });
for (let i = 0; i < 100 && !orderPort; i++) await new Promise((r) => setTimeout(r, 50));
assert.ok(orderPort, "the order-test hub started");
const orderBase = `http://127.0.0.1:${orderPort}`;
const started = Date.now();
const histAt = fetch(`${orderBase}/api/task-history?num=${parseInt(orderTask.file, 10)}`)
	.then((r) => r.json())
	.then((j: any) => { assert.ok(j.agents, "the history endpoint serves the agent history"); return Date.now(); });
await new Promise((r) => setTimeout(r, 10));
const tasksAt = fetch(`${orderBase}/api/tasks`).then((r) => r.json()).then(() => Date.now());
const [hist, tasks] = await Promise.all([histAt, tasksAt]);
assert.ok(tasks < hist, `a heavy parse never stalls a concurrent poll (tasks ${tasks - started}ms, history ${hist - started}ms)`);
orderChild.kill("SIGKILL");
rmSync(orderRoot, { recursive: true, force: true });
rmSync(orderHome, { recursive: true, force: true });

// 000222 the Doctor card payload: one doctors entry per existing
// `.logs/<slug>.<analysed role>.<n>.doctor.log` (the slug must match the task), tokens and
// duration parsed off the same JSONL stream the agent logs carry, alive = the analysed run's
// analysis pid is still alive; another task's doctor logs stay that task's entries, oldest first
const docRoot = mkdtempSync(join(tmpdir(), "webui-doctor-"));
const docTask = createTask(docRoot, { name: "feat: doctor payload", summary: "s", specs: "s" });
const docSlug = docTask.file.replace(/\.md$/, "");
const docDetail = (t: { file: string }) => taskHistory(docRoot, parseInt(t.file, 10))!;
const docLogs = join(docRoot, ".kanban", ".logs");
mkdirSync(docLogs, { recursive: true });
assert.deepEqual((await docDetail(docTask)).doctors, [], "no doctor logs yet, empty doctor history");
// finished doctor logs with relative timestamps: the in-log first record timestamp is the sort
// key, so the entries read oldest first regardless of file mtimes
const docBase = Date.now() - 600000;
writeFileSync(join(docLogs, `${docSlug}.developer.0.doctor.log`), [
	JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date(docBase).toISOString() }),
	"DOCTOR RUN ZERO",
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 12, output: 8, cacheRead: 500, cacheWrite: 300 } }, timestamp: new Date(docBase + 5000).toISOString() }),
].join("\n") + "\n");
writeFileSync(join(docLogs, `${docSlug}.developer.1.doctor.log`), [
	JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date(docBase + 10000).toISOString() }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 20, output: 10 } }, timestamp: new Date(docBase + 13000).toISOString() }),
].join("\n") + "\n");
// a doctor log of a DIFFERENT task's slug: it belongs to that task's payload, never this one's
const otherTask = createTask(docRoot, { name: "fix: other doctor task", summary: "s", specs: "s" });
const otherSlug = otherTask.file.replace(/\.md$/, "");
writeFileSync(join(docLogs, `${otherSlug}.developer.0.doctor.log`), "OTHER TASK DOCTOR\n");
assert.deepEqual(
	(await docDetail(docTask)).doctors,
	[
		{ role: "doctor", run: 0, alive: false, status: "ok", handle: `${docSlug}.developer.0.doctor`, tokens: 20, duration: 5000 },
		{ role: "doctor", run: 1, alive: false, status: "ok", handle: `${docSlug}.developer.1.doctor`, tokens: 30, duration: 3000 },
	],
	"one doctor entry per doctor log, tokens sum input + output (cache excluded), duration is last - first record timestamp, sorted oldest first",
);
assert.deepEqual(
	(await docDetail(otherTask)).doctors,
	[{ role: "doctor", run: 0, alive: false, status: "ok", handle: `${otherSlug}.developer.0.doctor`, tokens: null, duration: null }],
	"a doctor log belongs to its own task's payload, another task's slug is excluded",
);

// a live analysed run: the analysis pid file keeps the doctor entry live and its duration ticks
mkdirSync(join(docRoot, ".kanban", ".pids"), { recursive: true });
writeFileSync(join(docRoot, ".kanban", ".pids", `${docSlug}.developer.0.analysis.pid`), String(process.pid));
const docLive = (await docDetail(docTask)).doctors[0];
assert.equal(docLive.alive, true, "a live analysis pid marks the analysed run's doctor entry alive");
assert.equal(docLive.status, "live", "a live doctor entry reads live, so its card spins");
assert.ok(docLive.duration! >= 600000, "a live doctor's duration ticks with now - first, not the frozen parsed last - first");
rmSync(join(docRoot, ".kanban", ".pids", `${docSlug}.developer.0.analysis.pid`));

// 000251: a stale or recycled analysis pid file cannot flip a doctor entry alive: a dead pid
// reads dead and a live pid whose start ticks no longer match reads dead, so the sig never
// flips on a stale file
writeFileSync(join(docRoot, ".kanban", ".pids", `${docSlug}.developer.0.analysis.pid`), "999999 123456");
assert.equal((await docDetail(docTask)).doctors[0].alive, false, "a stale analysis pid file (dead pid) reads the doctor entry dead");
writeFileSync(join(docRoot, ".kanban", ".pids", `${docSlug}.developer.0.analysis.pid`), `${process.pid} 0`);
assert.equal((await docDetail(docTask)).doctors[0].alive, false, "a recycled analysis pid (live pid, mismatched start ticks) reads the doctor entry dead");
rmSync(join(docRoot, ".kanban", ".pids", `${docSlug}.developer.0.analysis.pid`));

// the doctor handle serves the doctor log through the same chunked payload; the handle needs the
// analysed run's task on the board and its run index, like any agent handle
const docServed = JSON.parse((await agentLogPayload(docRoot, new URLSearchParams("file=" + encodeURIComponent(`${docSlug}.developer.0.doctor`))))!);
assert.ok(docServed.text.includes("DOCTOR RUN ZERO\n"), "the doctor handle serves the doctor log's text");
assert.equal(docServed.atStart, true, "a short doctor log serves whole from its start");
assert.equal(await agentLogPayload(docRoot, new URLSearchParams("file=" + encodeURIComponent(`${docSlug}.developer.doctor`))), null, "a doctor handle without the analysed run index is rejected");
assert.equal(await agentLogPayload(docRoot, new URLSearchParams("file=" + encodeURIComponent(`${docSlug}.auditor.0.doctor`))), null, "a doctor handle over an unknown analysed role is rejected");
assert.equal(await agentLogPayload(docRoot, new URLSearchParams("file=" + encodeURIComponent(`nope.developer.0.doctor`))), null, "a doctor handle needs its task on the board");

// LOG_ROLES: the doctor analysis writes no per-task run log, its role is enumerated last
assert.equal(LOG_ROLES[LOG_ROLES.length - 1], "doctor", "doctor is the last LOG_ROLES entry, after the merger");
assert.ok(LOG_ROLES.includes("splitter"), "the splitter role is enumerated, its run logs resolve");
rmSync(docRoot, { recursive: true, force: true });
