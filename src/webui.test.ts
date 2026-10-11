import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, getTask, setState } from "./kanban.ts";
import { flipDiff, loadWebUiConfig, LOG_CHUNK, renderLogChunk, startWebUi } from "./webui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_NAMES = ["backlog", "to-do", "doing", "to-review", "reviewing", "to-live-test", "live-testing", "done"];

const root = mkdtempSync(join(tmpdir(), "webui-test-"));
const home = mkdtempSync(join(tmpdir(), "webui-home-"));
let daemon: ChildProcess | undefined;
const cleanup = () => {
	daemon?.kill("SIGKILL");
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

// absent or invalid config = off (HOME at the empty temp home, no board config yet)
const realHome = process.env.HOME;
process.env.HOME = home;
assert.equal(loadWebUiConfig(root).enabled, false);
process.env.HOME = realHome;

// renderLogChunk: JSONL events render as readable lines, non-JSON lines pass through,
// a partial trailing record (byte boundary split) drops
const jsonl = [
	JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "now", cwd: "/r" }),
	JSON.stringify({ type: "message_start", message: { role: "user", content: "Run the checks", timestamp: 1 } }),
	JSON.stringify({ type: "message_end", message: { role: "user", content: "Run the checks", timestamp: 1 } }),
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } }),
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Read the specs first." } }),
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_start", contentIndex: 1 } }),
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Starting the run." } }),
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "toolcall_end", contentIndex: 2, toolCall: { type: "toolCall", id: "t1", name: "bash", arguments: { command: "git status --short" } } } }),
	JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "git status --short" } }),
	JSON.stringify({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: { content: [{ type: "text", text: "boom: exit 1" }] }, isError: true, durationMs: 5 }),
	"pi: diagnostic that never was JSON",
].join("\n") + "\n";
const rendered = renderLogChunk(jsonl);
assert.ok(rendered.includes("── thinking ──\n"), "thinking start renders a thinking line");
assert.ok(rendered.includes("Read the specs first.\n"), "thinking delta renders");
assert.ok(rendered.includes("Starting the run.\n"), "text delta renders as text");
assert.equal(rendered.split("[tool] bash: git status --short").length - 1, 1, "one tool line per call: toolcall_end and execution start deduped by id");
assert.ok(rendered.includes("[tool] bash failed: boom: exit 1\n"), "failed tool execution renders an error line");
assert.ok(rendered.includes("pi: diagnostic that never was JSON\n"), "non-JSON line passes through unchanged");
assert.ok(rendered.includes("[prompt] Run the checks\n"), "user message_end renders the prompt");
assert.ok(!rendered.includes('"type"'), "parsed JSON records never leak raw JSON");
assert.equal(renderLogChunk(jsonl + "partial-without-newline"), rendered, "a partial trailing record is dropped");

// startWebUi on port 0 against a temp board with one task
const task = createTask(root, { name: "feat: webui smoke", summary: "Dashboard smoke", specs: "Render the board" });
const ui = await startWebUi(root, { port: 0 });
assert.ok(ui, "web ui starts on port 0");
const base = `http://localhost:${ui.port}`;

const tasksRes = await fetch(`${base}/api/tasks`);
assert.equal(tasksRes.status, 200);
const listed = await tasksRes.json();
assert.equal(listed.length, 1);
assert.equal(listed[0].file, task.file);
assert.equal(listed[0].name, task.name);
assert.equal(listed[0].priority, "medium");
assert.equal(listed[0].state, "backlog");
assert.equal(listed[0].worktree, "");
assert.equal(listed[0].updated, statSync(join(root, ".kanban", task.file)).mtimeMs);
assert.match(listed[0].body, /# Summary\nDashboard smoke/);

// GET / mentions all 8 state names; other paths and methods are 404
const page = await (await fetch(`${base}/`)).text();
assert.ok(page.includes("Software Engineering LLM Team"), "page shows the new title");
assert.ok(page.includes('id="theme"'), "page has the theme toggle");
for (const st of STATE_NAMES) assert.ok(page.includes(st), `page mentions state ${st}`);
assert.equal((await fetch(`${base}/nope`)).status, 404);
assert.equal((await fetch(`${base}/api/tasks`, { method: "POST" })).status, 404);

// FLIP diff: which cards get transforms. a on top, b below in one column; 210px is the next column
const stacked = { a: { x: 0, y: 0 }, b: { x: 0, y: 50 } };
assert.deepEqual(
	flipDiff({ ...stacked }, { a: { x: 210, y: 0 }, b: { x: 0, y: 0 } }),
	{ a: { dx: -210, dy: 0 }, b: { dx: 0, dy: 50 } },
	"a card leaving slides laterally and the cards below shift upward",
);
assert.deepEqual(
	flipDiff({ ...stacked }, { c: { x: 0, y: 0 }, a: { x: 0, y: 50 }, b: { x: 0, y: 100 } }),
	{ a: { dx: 0, dy: -50 }, b: { dx: 0, dy: -50 } },
	"a card entering slides the cards below downward; the new card itself gets no transform",
);
assert.deepEqual(flipDiff(stacked, stacked), {}, "an unchanged refresh animates nothing");
assert.ok(page.includes(String(flipDiff)), "the page ships the tested flipDiff source");
assert.ok(page.includes('transition = "transform .4s ease"'), "sibling shifts reuse the moved-card timing");

// agent info: null for a backlog task; populated for a working task with a live pid
assert.equal(listed[0].agent, null);
assert.deepEqual(listed[0].agents, [], "no role logs yet, empty agent history");
assert.ok(page.includes('id="m-agent"'), "modal has the agent area");
assert.ok(page.includes("#m-log.hidden { display: none; }"), "log pane hides");
assert.ok(page.includes("/api/agent-log"), "page uses the agent log endpoint");
assert.ok(page.includes('<span class="check">✓</span>'), "past agent buttons render a green checkmark");
assert.ok(page.includes(".agent-btn-active"), "the shown agent button gets an active class");
setState(root, getTask(root, task.file)!, "doing");
const slug = task.file.replace(/\.md$/, "");
mkdirSync(join(root, ".kanban", ".pids"), { recursive: true });
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), String(process.pid));
mkdirSync(join(root, ".kanban", ".logs"), { recursive: true });
const logFile = join(root, ".kanban", ".logs", `${slug}.developer.log`);
const logText = Array.from({ length: 2600 }, () => "H".repeat(63) + "\n").join(""); // 64-byte lines: chunk boundaries never split one, 2+ history pages
writeFileSync(logFile, logText);
const working = (await (await fetch(`${base}/api/tasks`)).json())[0];
assert.deepEqual(working.agent, { role: "developer", alive: true, log: `${slug}.developer` });
assert.deepEqual(working.agents, [{ role: "developer", alive: true }], "single role log, live agent only");

// tail: no offset returns only the last chunk, with cursors for poll and history
const enc = encodeURIComponent(`${slug}.developer`);
const tail = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(tail.tail, logText.length);
assert.equal(tail.head, logText.length - LOG_CHUNK);
assert.equal(tail.text, logText.slice(logText.length - LOG_CHUNK));
assert.equal(tail.atStart, false);

// poll from an offset returns only new content
const idle = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.tail}`)).json();
assert.equal(idle.text, "");
writeFileSync(logFile, logText + "NEW\n");
const appended = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.tail}`)).json();
assert.equal(appended.text, "NEW\n");
assert.equal(appended.tail, logText.length + 4);

// history: chunks before an offset down to the start of the file
const h1 = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.head}&before=1`)).json();
assert.equal(h1.head, tail.head - LOG_CHUNK);
assert.equal(h1.text, logText.slice(h1.head, tail.head));
const h2 = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${h1.head}&before=1`)).json();
assert.equal(h2.head, 0);
assert.equal(h2.atStart, true);
assert.equal(h2.text + h1.text + tail.text, logText);

// unknown files and non-agent handles are rejected
assert.equal((await fetch(`${base}/api/agent-log?file=nope.developer`)).status, 404);
assert.equal((await fetch(`${base}/api/agent-log?file=${encodeURIComponent(slug + ".merger")}`)).status, 404);
assert.equal((await fetch(`${base}/api/agent-log`)).status, 404);

// a past role log lists as a dead agent and streams through the same endpoint
writeFileSync(join(root, ".kanban", ".logs", `${slug}.reviewer.log`), "REVIEW\n");
const past = (await (await fetch(`${base}/api/tasks`)).json())[0];
assert.deepEqual(past.agents, [{ role: "developer", alive: true }, { role: "reviewer", alive: false }], "past reviewer after the live developer, pipeline order");
const reviewerLog = await (await fetch(`${base}/api/agent-log?file=${encodeURIComponent(slug + ".reviewer")}`)).json();
assert.equal(reviewerLog.text, "REVIEW\n");

// a stale pid file reports the agent as not alive
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), "999999999");
const stale = (await (await fetch(`${base}/api/tasks`)).json())[0];
assert.equal(stale.agent.alive, false);
assert.deepEqual(stale.agents, [{ role: "developer", alive: false }, { role: "reviewer", alive: false }], "a dead state-mapped agent is past too");

// leave the board as the daemon section expects it
rmSync(join(root, ".kanban", ".pids", `${slug}.pid`));
rmSync(join(root, ".kanban", ".logs", `${slug}.reviewer.log`));
setState(root, getTask(root, task.file)!, "backlog");

// /api/agent-log renders a JSONL event log into readable lines
const jsonlLog = [
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Checking the board." } }),
	JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "src/webui.ts" } }),
	"not json at all",
].join("\n") + "\n";
writeFileSync(logFile, jsonlLog);
const servedLog = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(servedLog.text.includes("Checking the board.\n"), "endpoint renders the thinking line");
assert.ok(servedLog.text.includes("[tool] read: src/webui.ts\n"), "endpoint renders the tool line");
assert.ok(servedLog.text.includes("not json at all\n"), "endpoint passes non-JSON lines through");

// a record split at the chunk head (init fetch of a log bigger than LOG_CHUNK) drops its partial
// line instead of rendering raw JSON
const bigRecord = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "z".repeat(100000) } });
writeFileSync(logFile, JSON.stringify({ type: "session", id: "s" }) + "\n" + bigRecord + "\n" + JSON.stringify({ type: "message_end", message: { role: "user", content: "tail" } }) + "\n");
const splitLog = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(splitLog.text, "[prompt] tail\n", "a record split at the chunk head drops its partial line, later records still render");

// a finished log: the tail is terminal records (assistant message_end, turn_end, agent_end,
// agent_settled) that render to nothing, so an unrenderable tail chunk walks back instead of
// serving an empty pane
const pad = "z".repeat(100000); // one assistant message_end record bigger than LOG_CHUNK
const terminalLog = [
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "final output line" } }),
	JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: pad }], timestamp: 2 } }),
	JSON.stringify({ type: "turn_end", timestamp: 3 }),
	JSON.stringify({ type: "agent_end", timestamp: 4 }),
	JSON.stringify({ type: "agent_settled", timestamp: 5 }),
].join("\n") + "\n";
writeFileSync(logFile, terminalLog);
const finished = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(finished.text.includes("final output line\n"), "an unrenderable tail chunk walks back to the last chunk with renderable content");
assert.equal(finished.head, 0);
assert.equal(finished.tail, terminalLog.length);
assert.equal(finished.atStart, true);
assert.ok(!finished.text.includes('"type"'), "walk-back serves rendered text, never raw JSON");
// an offset poll keeps its window: the client already consumed the region below its offset
const finishedPoll = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${finished.tail}`)).json();
assert.equal(finishedPoll.text, "");
assert.equal(finishedPoll.head, finished.tail);

// a history page inside an unrenderable record walks back to the nearest earlier renderable chunk
const paddedLog = [
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "early delta" } }),
	JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: pad }], timestamp: 2 } }),
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "tail delta" } }),
].join("\n") + "\n";
writeFileSync(logFile, paddedLog);
const padded = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.ok(padded.text.includes("tail delta\n"), "a renderable tail chunk serves without walking back");
const paddedHist = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${padded.head}&before=1`)).json();
assert.ok(paddedHist.text.includes("early delta\n"), "a history page inside an unrenderable record walks back to renderable content");
assert.equal(paddedHist.head, 0);

// a second startWebUi on the taken port reports failure instead of throwing
assert.equal(await startWebUi(root, { port: ui.port }), null);
ui.close();

// daemon wiring: HOME at a config with webUi enabled and port 0 -> OS picks, URL logged
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
writeFileSync(join(home, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, port: 0 } }));
daemon = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", root], {
	stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, HOME: home },
});
let out = "";
daemon.stdout.on("data", (d) => (out += d));
daemon.stderr.on("data", (d) => (out += d));
const exited = new Promise((r) => daemon!.on("exit", r));
const end = Date.now() + 10000;
let url = "";
while (Date.now() < end) {
	const m = out.match(/web ui on (http:\/\/\S+)/);
	if (m) {
		url = m[1];
		break;
	}
	await new Promise((r) => setTimeout(r, 250));
}
assert.ok(url, "daemon log shows the web ui url; got: " + out);
const served = await (await fetch(`${url}/`)).text();
for (const st of STATE_NAMES) assert.ok(served.includes(st), `daemon dashboard serves the ${st} column`);
const viaDaemon = await (await fetch(`${url}/api/tasks`)).json();
assert.equal(viaDaemon.length, 1);
assert.equal(viaDaemon[0].file, task.file);
daemon.kill("SIGTERM");
await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);

// project .kanban/se-llm-team.json overrides the user file for webUi
process.env.HOME = home;
writeFileSync(join(root, ".kanban", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: 4243 } }));
const overridden = loadWebUiConfig(root);
assert.equal(overridden.host, "127.0.0.1");
assert.equal(overridden.port, 4243);
// a project file without webUi falls back to the user file
writeFileSync(join(root, ".kanban", "se-llm-team.json"), JSON.stringify({ pollMinutes: 5 }));
assert.equal(loadWebUiConfig(root).enabled, true);
process.env.HOME = realHome;

cleanup();
console.log("webui.test.ts: all assertions passed");
