import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, getTask, PRIORITY_RANK, setState } from "../src/kanban.ts";
import { startHub } from "../src/hub.ts";
import { agentLabel, agentRowSig, agentStatsText, agentLogPayload, boardOf, buildShell, cardBaseHtml, cardHtml, curve, doctorCol, flipDiff, fmtDur, fmtTokens, LAYOUT, loadWebUiConfig, LOG_LINES, logFixups, md, mergeBoards, numLinkHtml, pairLayout, refreshMs, relationPaths, renderLogChunk, spinnerHtml, syncAgentStats, syncBoard, syncCardStats, syncDoctorCards, syncStatsLine, tabNames, tabsHtml, taskHistory, taskPayload, taskStats } from "../src/webui.ts";
// not re-exported by the webui barrel: import directly from the logpane module
import { esc, LOG_ROLES } from "../src/webui/logpane.ts";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_NAMES = ["backlog", "to-do", "doing", "to-review", "reviewing", "to-merge", "merging", "to-live-test", "live-testing", "done"];

// 000215: the neutral config dir resolves to $HOME/.config/se-llm-team when XDG_CONFIG_HOME
// is unset, so dropping it keeps every temp-HOME section off the real user config
delete process.env.XDG_CONFIG_HOME;

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

// minimal element stub for the log-pane fixups: only the DOM surface logFixups touches
class LogEl {
	tag: string;
	className = "";
	textContent = "";
	dataset: Record<string, string> = {};
	children: LogEl[] = [];
	parent: LogEl | null = null;
	classList = { contains: (cls: string) => this.className.split(/\s+/).includes(cls) };
	constructor(tag: string) { this.tag = tag; }
	get previousElementSibling(): LogEl | null {
		const p = this.parent;
		return p ? p.children[p.children.indexOf(this) - 1] ?? null : null;
	}
	querySelectorAll(sel: string): LogEl[] {
		const out: LogEl[] = [];
		const walk = (n: LogEl) => {
			for (const c of n.children) {
				if (logElMatches(c, sel)) out.push(c);
				walk(c);
			}
		};
		walk(this);
		return out;
	}
	querySelector(sel: string): LogEl | null { return this.querySelectorAll(sel)[0] ?? null; }
	appendChild(c: LogEl): LogEl { c.remove(); c.parent = this; this.children.push(c); return c; }
	append(...cs: (LogEl | string)[]) { for (const c of cs) { if (typeof c === "string") this.textContent += c; else this.appendChild(c); } }
	replaceWith(c: LogEl) {
		const p = this.parent;
		if (!p) return;
		p.children[p.children.indexOf(this)] = c;
		c.parent = p;
		this.parent = null;
	}
	remove() { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); this.parent = null; }
}
// the selector forms logFixups uses: tag.class[data-tc] / [data-tc="id"], .class, bare tag
const logElMatches = (c: LogEl, sel: string) => {
	const attr = sel.match(/^(?:([a-z]+))?(?:\.?([\w-]+))?(?:\[data-tc(?:="([^"]*)")?\])?$/);
	if (!attr) return c.tag === sel;
	const [, tag, cls, tc] = attr;
	return (
		(!tag || c.tag === tag) &&
		(!cls || c.classList.contains(cls)) &&
		(tc !== undefined ? c.dataset.tc === tc : !sel.includes("[data-tc") || c.dataset.tc !== undefined)
	);
};
(globalThis as any).CSS ??= { escape: (s: string) => s };
const logDoc = { createElement: (tag: string) => new LogEl(tag) };

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
assert.ok(rendered.includes('<details class="lg-think" data-open="think"><summary>Thinking</summary><pre><p>Read the specs first.</p></pre></details>'), "the thinking block renders as a collapsed details with a Thinking summary, left open at the chunk end for the next chunk's deltas");
assert.ok(rendered.includes("<p>Starting the run.</p>"), "a plain text delta renders through md() unchanged apart from the paragraph wrapping");
assert.equal(rendered.split('data-tc="t1"').length - 1, 1, "one tool block per call: toolcall_end and execution start dedupe by id");
assert.ok(rendered.includes("<summary>bash failed: boom: exit 1</summary>"), "a failed tool execution surfaces its error in the collapsed summary");
assert.ok(rendered.includes('<pre class="lg-args">{\n  &quot;command&quot;: &quot;git status --short&quot;\n}</pre>'), "the tool block body holds the full args");
assert.ok(rendered.includes('<pre class="lg-out">boom: exit 1</pre>'), "the tool result joins the same block");
assert.ok(rendered.includes("pi: diagnostic that never was JSON\n"), "non-JSON line passes through unchanged");
assert.ok(rendered.includes("[prompt] Run the checks\n"), "user message_end renders the prompt");
assert.ok(!rendered.includes('"type"'), "parsed JSON records never leak raw JSON");
assert.equal(renderLogChunk(jsonl + "partial-without-newline"), rendered, "a partial trailing record is dropped");
// blank lines in legacy print-mode text pass through unchanged: an empty line fails JSON.parse
const legacy = "first paragraph\n\nsecond paragraph\n\nthird paragraph\n";
assert.equal(renderLogChunk(legacy), legacy, "blank paragraph lines in non-JSON text pass through");
// a blank line also flushes buffered JSONL text instead of being skipped
const mixed = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "paragraph" } }) + "\n\nlegacy line\n";
assert.equal(renderLogChunk(mixed), "<p>paragraph</p>\nlegacy line\n", "a blank line flushes pending markdown text and passes through");

// 000122 collapsible log blocks: thinking_end closes with the authoritative content, the tool
// summary one-liner caps at 80 chars on the first line only, and a tool end whose block lives in
// an earlier chunk renders the joinable span the client resolves
const closed = renderLogChunk([
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } }),
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reconstructed" } }),
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "authoritative thinking" } }),
].join("\n") + "\n");
assert.ok(closed.includes('<details class="lg-think"><summary>Thinking</summary><pre><p>authoritative thinking</p></pre></details>'), "thinking_end closes the block with the authoritative content");
assert.ok(!closed.includes("data-open"), "a closed thinking block carries no continuation marker");

const longCmd = "curl -s " + "x".repeat(120) + " \\\n  --header 'Accept: application/json'";
const toolChunk = renderLogChunk(JSON.stringify({ type: "tool_execution_start", toolCallId: "t2", toolName: "bash", args: { command: longCmd } }) + "\n");
const sum = toolChunk.match(/<summary>([^<]*)<\/summary>/)![1];
assert.ok(sum.startsWith("bash: curl -s ") && sum.length <= "bash: ".length + 80, "the tool summary one-liner caps at 80 chars");
assert.ok(!sum.includes("--header"), "the tool summary shows the first line of the command only");
assert.ok(toolChunk.includes("x".repeat(120)), "the full command stays in the block body");

const joinChunk = renderLogChunk(JSON.stringify({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: { content: [{ type: "text", text: "boom: exit 1" }] }, isError: true }) + "\n");
assert.ok(joinChunk.includes('<span class="lg-tres" data-tc="t1" data-sum="bash failed: boom: exit 1">boom: exit 1</span>'), "a tool end whose block lives in an earlier chunk renders the joinable span, errors carrying the summary text");
// client-side promotion: an orphan span with no matching block in the pane becomes a collapsible
// details collapsed by default, the data-sum one-liner as the summary, the result text as the body
const joinPane = new LogEl("div");
const orphan = new LogEl("span");
orphan.className = "lg-tres";
orphan.dataset.tc = "t1";
orphan.dataset.sum = "bash failed: boom: exit 1";
orphan.textContent = "boom: exit 1";
joinPane.appendChild(orphan);
logFixups(joinPane, logDoc);
assert.equal(joinPane.children.length, 1);
const promoted = joinPane.children[0];
assert.ok(promoted.tag === "details" && promoted.className === "lg-tool" && !("tc" in promoted.dataset), "an orphan tool result with no matching block promotes to a collapsible details.lg-tool instead of staying a bare span");
assert.ok(promoted.children[0].tag === "summary" && promoted.children[0].textContent === "bash failed: boom: exit 1", "the promoted block summarizes from the data-sum one-liner");
assert.ok(promoted.children[1].tag === "pre" && promoted.children[1].className === "lg-out" && promoted.children[1].textContent === "boom: exit 1", "the promoted block holds the result text as its body");
// the join is unchanged when a matching block is loaded: the result joins it by toolCallId
const joinedPane = new LogEl("div");
const joinedBlock = new LogEl("details");
joinedBlock.className = "lg-tool";
joinedBlock.dataset.tc = "t1";
const joinedSum = new LogEl("summary");
joinedSum.textContent = "bash: ls";
joinedBlock.appendChild(joinedSum);
const joinSpan = new LogEl("span");
joinSpan.className = "lg-tres";
joinSpan.dataset.tc = "t1";
joinSpan.dataset.sum = "bash failed: boom: exit 1";
joinSpan.textContent = "boom: exit 1";
joinedPane.appendChild(joinedBlock);
joinedPane.appendChild(joinSpan);
logFixups(joinedPane, logDoc);
assert.equal(joinedPane.children.length, 1);
assert.ok(joinedBlock.children[0].textContent === "bash failed: boom: exit 1", "a joinable span still joins its block and carries the summary over");
assert.ok(joinedBlock.children[1].tag === "pre" && joinedBlock.children[1].className === "lg-out" && joinedBlock.children[1].textContent === "boom: exit 1", "a joinable span still fills its block's result");
// thinking deltas continuing a mid-thought chunk: one with no open block to join promotes to a
// collapsible details, one that finds the previous chunk's open block appends into it
const contPane = new LogEl("div");
const contSpan = new LogEl("span");
contSpan.className = "lg-cont";
contSpan.textContent = "still mid-thought";
contPane.appendChild(contSpan);
logFixups(contPane, logDoc);
assert.ok(contPane.children[0].tag === "details" && contPane.children[0].className === "lg-think", "a thinking delta with no open block to join promotes to a collapsible details.lg-think instead of staying a bare span");
assert.ok(contPane.children[0].children[0].textContent === "Thinking" && contPane.children[0].children[1].textContent === "still mid-thought", "the promoted thinking block summarizes as Thinking with the delta text as its body");
assert.ok(contPane.children[0].dataset.open === "think", "000148: the promoted block is marked open, so later delta polls walk back to it and join it instead of promoting a new block per poll");
const contJoinPane = new LogEl("div");
const openThink = new LogEl("details");
openThink.className = "lg-think";
openThink.dataset.open = "think";
openThink.appendChild(new LogEl("summary"));
const thinkBody = new LogEl("pre");
thinkBody.textContent = "started in the previous chunk";
openThink.appendChild(thinkBody);
const liveCont = new LogEl("span");
liveCont.className = "lg-cont";
liveCont.textContent = " continued here";
contJoinPane.appendChild(openThink);
contJoinPane.appendChild(liveCont);
logFixups(contJoinPane, logDoc);
assert.equal(contJoinPane.children.length, 1);
assert.ok(thinkBody.textContent === "started in the previous chunk continued here", "a thinking delta still appends into the previous chunk's open block");

// 000148 live multi-chunk: the window's deltas promote to a marked open block, later delta polls
// join it instead of promoting one block per poll, and the cross-window thinking_end (a final
// close span) replaces the body with the authoritative text and closes the block
const thinkDelta = (t: string) => JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: t } });
const thinkEnd = (t: string) => JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: t } });
const contSpanOf = (chunk: string) => {
	const m = chunk.match(/<span class="lg-cont"( data-final="1")?>([^<]*)<\/span>/);
	if (!m) throw new Error("chunk carries no cont span: " + chunk);
	const s = new LogEl("span");
	s.className = "lg-cont";
	if (m[1]) s.dataset.final = "1";
	s.textContent = m[2];
	return s;
};
const contSpansOf = (chunk: string) => [...chunk.matchAll(/<span class="lg-cont"( data-final="1")?>([^<]*)<\/span>/g)].map((m) => {
	const s = new LogEl("span");
	s.className = "lg-cont";
	if (m[1]) s.dataset.final = "1";
	s.textContent = m[2];
	return s;
});
const livePane = new LogEl("div");
// poll 1: the window's deltas of a block whose thinking_start lies outside it
livePane.appendChild(contSpanOf(renderLogChunk(thinkDelta("plan the fix") + "\n")));
logFixups(livePane, logDoc);
assert.equal(livePane.children.length, 1);
const promotedLive = livePane.children[0];
assert.ok(promotedLive.tag === "details" && promotedLive.className === "lg-think" && promotedLive.dataset.open === "think", "the promoted block is marked open so later delta polls join it");
// poll 2: two deltas render one span, it joins the marked block
livePane.appendChild(contSpanOf(renderLogChunk(thinkDelta(" and") + "\n" + thinkDelta(" grows") + "\n")));
logFixups(livePane, logDoc);
assert.equal(livePane.children.length, 1, "later delta polls join the marked open block, one Thinking block per stream");
assert.ok(livePane.children[0] === promotedLive && promotedLive.children[1].textContent === "plan the fix and grows", "the joined block's body grew in place");
// poll 3: the cross-window thinking_end closes the block with the authoritative text
const crossEnd = renderLogChunk(thinkEnd("authoritative thinking") + "\n");
assert.ok(crossEnd.includes('<span class="lg-cont" data-final="1">authoritative thinking</span>'), "a cross-window thinking_end renders the closing span with the authoritative text");
livePane.appendChild(contSpanOf(crossEnd));
logFixups(livePane, logDoc);
assert.equal(livePane.children.length, 1, "the close span keeps exactly one Thinking block");
assert.ok(!("open" in promotedLive.dataset), "the close removes the continuation marker");
assert.ok(promotedLive.children[1].textContent === "authoritative thinking", "the close replaces the block's body with the authoritative text");
// a close span with no open block before it promotes to a closed block of its own
const closeAlone = new LogEl("div");
closeAlone.appendChild(contSpanOf(renderLogChunk(thinkEnd("late authoritative") + "\n")));
logFixups(closeAlone, logDoc);
assert.equal(closeAlone.children.length, 1);
assert.ok(closeAlone.children[0].tag === "details" && closeAlone.children[0].className === "lg-think" && !("open" in closeAlone.children[0].dataset), "a close span with no open block promotes to a closed details.lg-think");
assert.ok(closeAlone.children[0].children[1].textContent === "late authoritative", "the promoted close block carries the authoritative text as its body");
// one poll can carry the deltas and the close together: one promote, one close, one new block
for (const s of contSpansOf(renderLogChunk(thinkDelta(" late") + "\n" + thinkEnd("final words") + "\n"))) livePane.appendChild(s);
logFixups(livePane, logDoc);
assert.equal(livePane.children.length, 2, "a poll carrying deltas and the close renders one new Thinking block beside the closed one");
assert.ok(livePane.children[1].className === "lg-think" && !("open" in livePane.children[1].dataset), "the combo chunk's block closes");
assert.ok(livePane.children[1].children[1].textContent === "final words", "the combo chunk's block carries the authoritative text");
assert.ok(promotedLive.children[1].textContent === "authoritative thinking", "the earlier closed block keeps its authoritative text");

const bareErr = renderLogChunk([
	JSON.stringify({ type: "tool_execution_start", toolCallId: "t3", toolName: "bash", args: { command: "ls" } }),
	JSON.stringify({ type: "tool_execution_end", toolCallId: "t3", toolName: "bash", isError: true, result: { content: [] } }),
].join("\n") + "\n");
assert.ok(bareErr.includes("<summary>bash failed</summary>"), "an error with no text surfaces as a bare failed summary, no trailing colon");

// sidechain subagent transcripts (.output session records): user prompt and assistant text render
// as lines, thinking and tool calls join the same collapsible blocks, toolResults fill them
const sidechain = [
	JSON.stringify({ isSidechain: true, agentId: "aaaa1111", type: "user", message: { role: "user", content: "Review the diff" } }),
	JSON.stringify({ isSidechain: true, agentId: "aaaa1111", type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reading the diff." }], usage: {}, model: "m", provider: "p" } }),
	JSON.stringify({ isSidechain: true, agentId: "aaaa1111", type: "toolResult", message: { role: "toolResult", toolCallId: "t9", toolName: "bash", content: [{ type: "text", text: "diff looks fine" }], isError: false, durationMs: 7 } }),
	JSON.stringify({ isSidechain: true, agentId: "aaaa1111", type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "Plan the fix." }, { type: "toolCall", id: "t8", name: "read", arguments: { path: "/r/SPECS.md" } }] } }),
	JSON.stringify({ isSidechain: true, agentId: "aaaa1111", type: "toolResult", message: { role: "toolResult", toolCallId: "t8", toolName: "read", content: [{ type: "text", text: "specs" }], isError: false } }),
].join("\n") + "\n";
const side = renderLogChunk(sidechain);
assert.ok(side.includes("[prompt] Review the diff\n"), "a sidechain user record renders the prompt text");
assert.ok(side.includes("<p>Reading the diff.</p>"), "sidechain text blocks render as message text");
assert.ok(side.includes('<span class="lg-tres" data-tc="t9">diff looks fine</span>'), "a sidechain toolResult without its toolcall renders the joinable result span");
// an orphan without a data-sum promotes with a generic result summary
const sidePane = new LogEl("div");
const sideOrphan = new LogEl("span");
sideOrphan.className = "lg-tres";
sideOrphan.dataset.tc = "t9";
sideOrphan.textContent = "diff looks fine";
sidePane.appendChild(sideOrphan);
logFixups(sidePane, logDoc);
assert.ok(sidePane.children[0].children[0].textContent === "result" && sidePane.children[0].children[1].textContent === "diff looks fine", "an orphan tool result without a data-sum promotes with a generic result summary");
assert.ok(side.includes('<details class="lg-think"><summary>Thinking</summary><pre><p>Plan the fix.</p></pre></details>'), "a sidechain thinking block renders as a collapsed details");
assert.equal(side.split("<summary>read: /r/SPECS.md</summary>").length - 1, 1, "one tool block per call: the toolcall args render once");
assert.ok(!side.includes('lg-tres" data-tc="t8'), "a sidechain toolResult dedupes against its toolcall within the chunk");
assert.ok(side.includes('<pre class="lg-out">specs</pre>'), "the sidechain toolResult fills its tool block");
assert.ok(!side.includes('"type"'), "sidechain records never leak raw JSON");
assert.ok(!renderLogChunk(sidechain + "partial-without-newline").includes("partial"), "a partial trailing sidechain record is dropped too");

// 000141 log text renders markdown through md(): bold, inline code, and fenced blocks become
// elements, an unclosed fence at the chunk end auto-closes, and HTML escapes before markup applies
const rich = renderLogChunk(JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Bold **text** and `inline code`\n\n```\nlet x = 1;\n```" } }) + "\n");
assert.ok(rich.includes("<p>Bold <b>text</b> and <code>inline code</code></p>"), "a text delta with bold and inline code markers renders b/code via md()");
assert.ok(rich.includes("<pre><code>let x = 1;\n</code></pre>"), "a fenced block in a text delta renders pre/code via md()");
const unclosed = renderLogChunk(JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "listing\n```\nfile one" } }) + "\n");
assert.ok(unclosed.includes("<p>listing</p><pre><code>file one\n</code></pre>"), "a chunk ending with an unclosed fence renders the partial as a closed fenced block (md auto-close)");
const injected = renderLogChunk(JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "<img src=x onerror=alert(1)> **bold**" } }) + "\n");
assert.ok(!injected.includes("<img") && injected.includes("&lt;img src=x onerror=alert(1)&gt; <b>bold</b>"), "markdown escapes HTML before applying markup, so log text cannot inject tags");
const thinkMd = renderLogChunk([
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } }),
	JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "**Plan**\n- step one" } }),
].join("\n") + "\n");
assert.ok(thinkMd.includes('<details class="lg-think"><summary>Thinking</summary><pre><p><b>Plan</b></p><ul><li>step one</li></ul></pre></details>'), "a thinking body containing markdown renders through md() inside the lg-think details");

// the hub serves the dashboard endpoints; HOME at the temp home keeps the hub registry and
// lock out of the real pi agent dir
const task = createTask(root, { name: "feat: webui smoke", summary: "Dashboard smoke", specs: "Render the board" });
process.env.HOME = home;
const ui = await startHub({ name: "webui-test", root, host: "localhost", port: 0 });
assert.ok(ui, "hub starts on port 0");
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
assert.equal(listed[0].issuer, "user", "absent issuer reads as user");
assert.equal(listed[0].blockedBy, "", "absent blockedBy reads as an empty string");
assert.equal(listed[0].complexity, "moderate");
assert.equal(listed[0].updated, statSync(join(root, ".kanban", task.file)).mtimeMs);
// 000242 the light list: rows carry identity + summary only, what the board renderer and the row
// click need; the heavy body, sections and agent history load per task through /api/task-detail.
// 000245: the visible cards' rows carry the agent stat data (this row is the column's first card),
// doctors stay detail-only
for (const k of ["body", "specs", "notes", "openQuestions", "agent", "doctors"])
	assert.ok(!(k in listed[0]), `light rows carry no ${k}`);
assert.deepEqual(listed[0].agents, [], "a visible card's row carries the agent stat data, empty without role logs");
assert.equal(listed[0].num, parseInt(task.file, 10), "light rows carry the task num");
assert.equal(listed[0].summary, "Dashboard smoke");
const detail = await (await fetch(`${base}/api/task-detail?num=${parseInt(task.file, 10)}`)).json();
assert.equal(detail.file, task.file);
assert.equal(detail.num, parseInt(task.file, 10));
assert.equal(detail.summary, "Dashboard smoke");
assert.equal(detail.specs, "Render the board");
assert.equal(detail.notes, "");
assert.equal(detail.openQuestions, "");
assert.match(detail.body, /# Summary\nDashboard smoke/);
// 000248: the light detail reads no logs, body, sections and attributes only; no agent data on
// the text payload, the heavy history loads in the follow-up fetch
for (const k of ["agents", "agent", "doctors"])
	assert.ok(!(k in detail), `the light detail carries no ${k}`);
// 000248: the follow-up history fetch carries the agent data the detail used to
const histPayload = await (await fetch(`${base}/api/task-history?num=${parseInt(task.file, 10)}`)).json();
assert.deepEqual(histPayload.agents, [], "the history carries the agent history, empty without role logs");
assert.equal(histPayload.agent, null);
assert.deepEqual(histPayload.doctors, []);
// unknown num: 404 with a JSON error body, on both endpoints
assert.equal((await fetch(`${base}/api/task-detail?num=999999`)).status, 404, "an unknown num is rejected");
assert.equal((await fetch(`${base}/api/task-detail?num=x`)).status, 404, "a non-numeric num is rejected");
assert.equal((await fetch(`${base}/api/task-detail`)).status, 404, "a missing num is rejected too");
assert.ok((await (await fetch(`${base}/api/task-detail?num=999999`)).json()).error, "the 404 carries a JSON error body");
for (const q of ["999999", "x", ""])
	assert.equal((await fetch(`${base}/api/task-history?num=${q}`)).status, 404, "an unknown task's history is rejected");
assert.ok((await (await fetch(`${base}/api/task-history?num=999999`)).json()).error, "the history 404 carries a JSON error body");

// issuer flows to /api/tasks: the creation value for task-issued tasks
const issued = createTask(root, { name: "feat: issued by 42", summary: "s", issuer: "#42" });
const issuedRow = (await (await fetch(`${base}/api/tasks`)).json()).find((t) => t.file === issued.file);
assert.equal(issuedRow.issuer, "#42");
assert.equal(issuedRow.complexity, "moderate");
rmSync(join(root, ".kanban", issued.file)); // the daemon section below expects a one-task board

// blockedBy flows to /api/tasks; the detail card and the relation lines read it from here
const held = createTask(root, { name: "fix: held by 1", summary: "s", blockedBy: `#${parseInt(task.file, 10)}` });
const heldRow = (await (await fetch(`${base}/api/tasks`)).json()).find((t) => t.file === held.file);
assert.equal(heldRow.blockedBy, `#${parseInt(task.file, 10)}`, "the blockedBy attribute serves with the payload");
rmSync(join(root, ".kanban", held.file)); // the daemon section below expects a one-task board

// 000245 the visible subset: the five cards each column renders before "show more" carry the stat
// data, a card behind it carries none; backlog sorts priority-first then newest-first, so with
// equal priorities the five newest are visible and the oldest sits behind the fold
const bulk = Array.from({ length: 6 }, (_, i) => createTask(root, { name: `feat: bulk ${i}`, summary: "s" }));
const bulkBase = Date.now() / 1000;
bulk.forEach((t, i) => utimesSync(join(root, ".kanban", t.file), bulkBase + i, bulkBase + i));
const bulkRows = (await (await fetch(`${base}/api/tasks`)).json()).filter((r: any) => r.name.startsWith("feat: bulk"));
assert.equal(bulkRows.length, 6);
for (const r of bulkRows)
	assert.equal("agents" in r, r.num !== parseInt(bulk[0].file, 10), "the five visible rows carry the stat data, a card behind show more carries none");
for (const t of bulk) rmSync(join(root, ".kanban", t.file)); // restore the one-task board

// GET / mentions all 10 state names; other paths and methods are 404
const pageRes = await fetch(`${base}/`);
assert.equal(pageRes.headers.get("cache-control"), "no-cache", "the page serves with a no-cache header so a browser reload re-fetches");
const page = await pageRes.text();
assert.doesNotThrow(() => new Function(page.match(/<script>([\s\S]*?)<\/script>/)![1]), "the served client script parses");
assert.ok(page.includes("Software Engineering LLM Team"), "page shows the new title");
assert.ok(page.includes('id="theme"'), "page has the theme toggle");
assert.ok(!page.includes('id="notify"'), "the header has no browser-notification control (000249)");
assert.ok(!page.includes("Notification"), "the served client never touches the Notification API (000249)");
assert.ok(page.includes('id="hub"'), "page has the hub identity footer (000165)");
assert.ok(page.includes("/api/task-history"), "the client fetches the heavy history in a follow-up fetch (000248)");
// 000165: /api/hub reports the serving hub's identity (pid, code checkout, commit), so a
// stale-code hub or a failover is visible at a glance
const hubRes = await fetch(`${base}/api/hub`);
assert.equal(hubRes.status, 200);
const hub = await hubRes.json();
assert.equal(hub.pid, process.pid, "/api/hub reports the serving process");
assert.equal(hub.root, realpathSync(join(HERE, "..")), "/api/hub names the code checkout hub.ts runs from");
assert.equal(hub.commit, execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(HERE, "..") }).toString().trim(), "/api/hub reports the checkout's HEAD commit");
for (const st of STATE_NAMES) assert.ok(page.includes(st), `page mentions state ${st}`);
assert.equal((await fetch(`${base}/nope`)).status, 404);
assert.equal((await fetch(`${base}/api/tasks`, { method: "POST" })).status, 404);
// 000192: the hub serves the statically imported webui module, so a page load writes no
// temp copies under src/
assert.ok(!readdirSync(join(HERE, "..", "src")).some((d) => d.startsWith(".webui-hot-")), "a page load writes no webui copy dirs under src/");

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

// 000047 stacked pairs, 000181 tail stack: backlog stays a single column, the other nine states
// render as four .pair wrappers (to-do over doing, to-review over reviewing, to-merge over merging,
// then to-live-test over live-testing over done as one stacked tail group).
// El is a minimal element stub: buildShell and syncBoard only touch this DOM surface.
class El {
	tag: string;
	className = "";
	textContent = "";
	dataset: Record<string, string> = {};
	style: Record<string, string> = {};
	children: El[] = [];
	parent: El | null = null;
	get parentElement(): El | null { return this.parent; }
	writes = 0;
	html = "";
	constructor(tag: string) { this.tag = tag; }
	get firstChild(): El | null { return this.children[0] ?? null; }
	get nextSibling(): El | null { const p = this.parent; return p ? p.children[p.children.indexOf(this) + 1] ?? null : null; }
	get innerHTML(): string { return this.html; }
	set innerHTML(v: string) { this.writes++; this.html = v; }
	appendChild(c: El): El { c.remove(); c.parent = this; this.children.push(c); return c; }
	insertBefore(c: El, ref: El | null): El {
		c.remove();
		c.parent = this;
		const i = ref ? Math.max(0, this.children.indexOf(ref)) : this.children.length;
		this.children.splice(i, 0, c);
		return c;
	}
	remove(): void { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); this.parent = null; }
}
const boardEl = new El("main");
const cols: Record<string, any> = buildShell(boardEl, { createElement: (tag: string) => new El(tag) });
assert.deepEqual(boardEl.children.map((c) => c.className), ["col c-backlog", "pair", "pair", "pair", "pair"], "backlog stays a single side column, the other nine states sit in four pairs");
assert.deepEqual(
	boardEl.children.slice(1, 5).map((p) => p.children.map((c) => c.className)),
	[["col c-to-do", "col c-doing"], ["col c-to-review", "col c-reviewing"], ["col c-to-merge", "col c-merging"], ["col c-to-live-test", "col c-live-testing", "col c-done"]],
	"to-do over doing, to-review over reviewing, to-merge over merging, to-live-test over live-testing over done",
);
assert.deepEqual(LAYOUT, ["backlog", ["to-do", "doing"], ["to-review", "reviewing"], ["to-merge", "merging"], ["to-live-test", "live-testing", "done"]], "backlog stays single, the middle states pair two by two, the last three stack as one group");
assert.deepEqual(pairLayout(STATE_NAMES), LAYOUT, "the pairs derive from the state list, with no state-specific wiring");
assert.ok(LAYOUT.every((part) => (typeof part === "string" ? cols[part] : part.every((st) => cols[st]))), "every layout state gets a column");
assert.ok(page.includes(JSON.stringify(LAYOUT)), "the page ships the tested layout");
assert.ok(page.includes(String(buildShell)) && page.includes(String(syncBoard)), "the page runs the tested shell and card pass");
assert.ok(page.includes(String(cardBaseHtml)) && page.includes(String(syncCardStats)) && page.includes(String(taskStats)), "the page runs the tested base-card and in-place stats source");
// syncBoard is interpolated as source, so every identifier it references must exist in the
// client scope: the page ships the rank map as a value, or the backlog sort throws on refresh
assert.ok(page.includes(`const PRIORITY_RANK = ${JSON.stringify(PRIORITY_RANK)}`), "the client defines the rank map syncBoard references");

// accents: one --ac per column, declared in pipeline order in the shared style block (not inside
// the dark palette or its media query), so both themes render the same accent pair
const accentAt = (st: string) => page.indexOf(`.c-${st} { --ac:`);
assert.ok(STATE_NAMES.every((st) => accentAt(st) >= 0), "every state has its own accent class");
assert.ok(STATE_NAMES.every((st, i) => i === 0 || accentAt(st) > accentAt(STATE_NAMES[i - 1])), "the accent classes are declared in pipeline order");
const accentColors = STATE_NAMES.map((st) => page.match(new RegExp(`\\.c-${st} \\{ --ac: (#[0-9a-f]{6}); \\}`))![1]);
assert.equal(new Set(accentColors).size, STATE_NAMES.length, "each column has a distinct accent color");

// the state picks the animation: only the states the orchestrator works on carry the spinner
assert.ok(spinnerHtml("doing").includes('<span class="spin">') && spinnerHtml("live-testing").includes('<span class="spin">') && spinnerHtml("merging").includes('<span class="spin">'), "working states render the spinner");
assert.equal(spinnerHtml("to-do") + spinnerHtml("to-review") + spinnerHtml("to-merge") + spinnerHtml("done"), "", "waiting and finished states render no spinner");
assert.ok(cardHtml({ file: "000047_fix_x.md", name: "a & b", priority: "high" }, "doing").includes('<span class="num-link num" data-task="000047_fix_x.md">#47</span>a &amp; b'), "a card carries its short number as a link and its escaped name");
// task ids are links: numLinkHtml carries the file for the post-render binding, escaped, and the
// card's own id keeps the num class
assert.equal(numLinkHtml("000047_fix_x.md"), '<span class="num-link" data-task="000047_fix_x.md">#47</span>', "a task id renders as a link carrying its file");
assert.equal(numLinkHtml('000048_quo"te.md'), '<span class="num-link" data-task="000048_quo&quot;te.md">#48</span>', "the data-task file is escaped");
// issuer on cards: user-issued keeps full contrast with a plain user chip, task-issued dims the
// name and carries a small #<num> badge
const userCard = cardHtml({ file: "000001_a.md", name: "a", priority: "high" }, "doing");
assert.ok(userCard.includes('<span class="chip">user</span>'), "a user-issued card shows a plain user chip");
assert.ok(!userCard.includes("issued"), "a user-issued card keeps full-contrast styling");
const issuedCard = cardHtml({ file: "000002_b.md", name: "b", priority: "low", issuer: "#42" }, "to-do");
assert.ok(issuedCard.includes('<div class="name issued">'), "a task-issued card dims its name");
assert.ok(issuedCard.includes('<span class="chip issuer">#42</span>'), "a task-issued card carries a small #num badge");
assert.ok(page.includes(".chip.issuer {") && page.includes(".issued {"), "the differentiation classes ship in the page css");
// complexity badge on cards: a per-value color chip next to the priority chip, default moderate when absent
const cxCard = cardHtml({ file: "000003_c.md", name: "c", priority: "medium", complexity: "complex" }, "doing");
assert.ok(cxCard.includes('<span class="chip p-medium">medium</span> <span class="chip cx cx-complex">complex</span>'), "the complexity badge carries its value class next to the priority badge");
assert.ok(!cardHtml({ file: "000006_f.md", name: "f", priority: "low" }, "to-do").includes('</span><span class="chip'), "a card puts a space between the priority, complexity and issuer chips");
assert.ok(cardHtml({ file: "000004_d.md", name: "d", priority: "high", complexity: "<x>" }, "doing").includes('<span class="chip cx cx-&lt;x&gt;">&lt;x&gt;</span>'), "the complexity badge is escaped");
assert.ok(userCard.includes('<span class="chip cx cx-moderate">moderate</span>'), "an absent complexity renders as moderate");
assert.ok(page.includes(".chip.cx {"), "the base complexity chip style ships in the page css as the fallback");
assert.ok(page.includes(".chip.cx-simple {") && page.includes(".chip.cx-moderate {") && page.includes(".chip.cx-complex {") && page.includes(".chip.cx-trivial {"), "the per-value complexity chip styles ship in the page css");
assert.ok(cardHtml({ file: "000005_e.md", name: "e", priority: "low", complexity: "trivial" }, "to-do").includes('<span class="chip cx cx-trivial">trivial</span>'), "a trivial task renders the cx-trivial chip");
// #178: the card's stats line sums all agent entries' tokens and durations, the agentStatsText
// format; hidden with no entries or both totals 0/null
assert.ok(cardHtml({ file: "000007_g.md", name: "g", priority: "low", agents: [{ tokens: 420, duration: 1500 }, { tokens: 1580, duration: 2000 }] }, "doing").includes('<span class="card-stats">2k · 4s</span>'), "a card sums its agent entries' tokens and durations into the stats line");
assert.ok(!cardHtml({ file: "000008_h.md", name: "h", priority: "low" }, "doing").includes("card-stats"), "a card without agent entries renders no stats line");
assert.ok(!cardHtml({ file: "000009_i.md", name: "i", priority: "low", agents: [{ tokens: null, duration: 1500 }, { duration: 2000 }] }, "doing").includes("card-stats"), "a card whose agent entries carry durations but no usage renders no stats line (000183)");
assert.ok(page.includes(".card-stats { display: block; font-size: 0.75rem; color: var(--muted); margin-top: 6px; }"), "the card stats line sits 6px below the chips row (000200)");
assert.ok(page.includes(".agent-stats { display: block; font-size: 0.75rem; color: var(--muted); margin-top: 2px; }"), "the agent stats line keeps its 2px margin (000200)");

// relation lines: one dashed curve per stored relation between rendered cards, running from the
// blocked task's card to the blocker's card, so the dashes flow blocked -> blocker. A done
// blocker, a ghost ref and an unrendered card draw nothing.
const rects = {
	"000001_a.md": { x: 0, y: 0, w: 280, h: 60 },
	"000002_b.md": { x: 310, y: 0, w: 280, h: 60 },
	"000003_c.md": { x: 620, y: 0, w: 280, h: 60 },
	"000004_d.md": { x: 310, y: 70, w: 280, h: 60 },
};
const rectOf = (file) => rects[file] ?? null;
const midY = (r) => r.y + r.h / 2;
const same = relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#4" },
	{ file: "000004_d.md", state: "to-do", blockedBy: "" },
], rectOf);
assert.equal(same.length, 1, "one curve per stored relation");
assert.equal(same[0].file, "000002_b.md", "each path is keyed by the blocked task's file, so the hover highlight reaches its lines without re-deriving geometry");
assert.equal(same[0].blocker, "000004_d.md", "each path also carries the blocker's file, so hovering the blocker highlights the line too (000144)");
assert.ok(same[0].d.startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`), "one uniform geometry: the path starts at the blocked card's right edge");
assert.ok(same[0].d.endsWith(`310 ${midY(rects["000004_d.md"])}`), "same column: the path enters the blocker's left edge, wrapping behind the cards");
// the geometry no longer depends on same-columnness or on the pair's states
assert.deepEqual(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#4" },
	{ file: "000004_d.md", state: "doing", blockedBy: "" },
], rectOf)[0], same[0], "a stacked pair at one x draws the same wrap, whatever the states");
const cross = relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#1, #3" },
	{ file: "000001_a.md", state: "backlog", blockedBy: "" },
	{ file: "000003_c.md", state: "to-review", blockedBy: "" },
], rectOf);
assert.equal(cross.length, 2, "multiple blockers draw one curve each");
assert.ok(cross[0].d.startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`) && cross[0].d.endsWith(`0 ${midY(rects["000001_a.md"])}`), "blocker left of blocked: out the blocked's right edge and into the blocker's left edge too");
assert.ok(cross[1].d.startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`) && cross[1].d.endsWith(`620 ${midY(rects["000003_c.md"])}`), "blocker right of blocked: blocked's right edge to the blocker's left edge");
assert.equal(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#3" },
	{ file: "000003_c.md", state: "done", blockedBy: "" },
], rectOf).length, 0, "a done blocker draws nothing");
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#9, junk, , " }], rectOf).length, 0, "ghost and unparseable refs draw nothing");
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#1" }], (f) => (f === "000001_a.md" ? rects["000001_a.md"] : null)).length, 0, "a ref whose card is not rendered draws nothing, and so does an unrendered blocked card");
assert.deepEqual(relationPaths([{ file: "000002_b.md", state: "to-do" }], rectOf), [], "an older payload without blockedBy draws nothing");

// hovering highlights both ways (000144): the served client script's hotRelations for the blocked
// file and for the blocker file both raise the same path, an unrelated file raises nothing
const hotPath: any = { dataset: { file: "000002_b.md", blocker: "000004_d.md" }, hot: new Set<string>() };
hotPath.classList = { toggle: (cls: string, on: boolean) => (on ? hotPath.hot.add(cls) : hotPath.hot.delete(cls)) };
const hotFn = (new Function("document", page.match(/<script>([\s\S]*?)<\/script>/)![1].match(/function hotRelations\(file, on\) \{[\s\S]*?\n\}/)![0] + "; return hotRelations;") as (d: unknown) => (file: string, on: boolean) => void)({ querySelectorAll: (sel: string) => (sel === "#relations path" ? [hotPath] : []) });
hotFn("000002_b.md", true);
assert.ok(hotPath.hot.has("relations-hot"), "hovering the blocked card highlights its outgoing line");
hotFn("000002_b.md", false);
assert.ok(!hotPath.hot.has("relations-hot"), "mouseleave reverts the highlight");
hotFn("000004_d.md", true);
assert.ok(hotPath.hot.has("relations-hot"), "hovering the blocker card highlights the same incoming line");
hotFn("000004_d.md", false);
assert.ok(!hotPath.hot.has("relations-hot"), "the blocker's mouseleave reverts it too");
hotFn("000009_x.md", true);
assert.ok(!hotPath.hot.has("relations-hot"), "an unrelated file highlights nothing");

// 000127/000236: far-apart cards bend the line into an S (the control offsets scale with the
// span, capped); same-row pairs clamp the offset inside the span, because a same-row cubic is
// collinear and any control past an endpoint retraces the line. The path format is fixed, so the
// control points parse straight out of the d string
const parseCurve = (d: string) => d.match(/^M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/)!.slice(1).map(Number);
const [sx1, , sc1x, , sc2x, , sx2] = parseCurve(same[0].d);
assert.equal(sc1x, sx1 + 280 * 0.35, "a same-column wrap scales the right-edge offset with the span");
assert.equal(sc2x, sx2 - 280 * 0.35, "a same-column wrap scales the left-edge offset with the span");
const [lx1, , lc1x, , lc2x, , lx2] = parseCurve(cross[0].d);
assert.ok(lc1x >= lx2 && lc1x <= lx1 && lc2x >= lx2 && lc2x <= lx1, "a same-row blocker left of the blocked card keeps both controls inside the span, so the straight line never doubles back");
const [rx1, , rc1x, , rc2x, , rx2] = parseCurve(cross[1].d);
assert.ok(rc1x <= rx2 && rc2x >= rx1, "same-row pairs keep the offsets within the span (c1x <= x2 and c2x >= x1)");
assert.equal(rc1x, rx1 + (rx2 - rx1) / 2, "the clamp halves the 40 px bow floor on the 30 px same-row gap, so the bezier never overshoots the entry point");
const farRects = { ...rects, "000005_e.md": { x: 700, y: 70, w: 280, h: 60 }, "000006_f.md": { x: 2000, y: 70, w: 280, h: 60 } };
const farOf = (f: string) => farRects[f] ?? null;
const farTasks = (file: string) => [
	{ file, state: "to-do", blockedBy: "#1" },
	{ file: "000001_a.md", state: "backlog", blockedBy: "" },
];
const [fx1, fy1, fc1x, fc1y, fc2x, fc2y, fx2, fy2] = parseCurve(relationPaths(farTasks("000005_e.md"), farOf)[0].d);
const farSpan = Math.abs(fx2 - fx1);
assert.equal(fc1y, fy1, "the S leaves the source card horizontally");
assert.equal(fc2y, fy2, "the S arrives into the target card horizontally");
assert.equal(fc1x, fx1 + farSpan * 0.35, "far-apart cards: the right-edge control offset scales with the span, the line bends into an S");
assert.equal(fc2x, fx2 - farSpan * 0.35, "far-apart cards: the left-edge control scales too, so the S crosses in the middle");
const capped = parseCurve(relationPaths(farTasks("000006_f.md"), farOf)[0].d);
assert.equal(capped[2], capped[0] + 480, "an extreme width caps the right-edge control offset at 480 so it never overshoots the board");
assert.equal(capped[4], capped[6] - 480, "an extreme width caps both controls");

// the page runs the tested helpers and ships the overlay wiring
assert.ok(page.includes(String(numLinkHtml)) && page.includes(String(curve)) && page.includes(String(relationPaths)), "the page ships the tested id-link and relation helpers");
assert.match(page, /#board \{[^}]*position: relative/, "#board is the overlay's containing block, so the lines scroll with the content");
assert.ok(page.includes("#relations { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }"), "the overlay stays at z-index 1, above the static columns and behind the cards, and never intercepts their clicks");
assert.match(page, /\.card \{ position: relative; z-index: 2;[^}]*background: color-mix\(in srgb, var\(--panel\) 85%, transparent\)/, "task cards stack above the relation lines with a semi-transparent background, so a line under a card shows through faintly in both themes");
assert.ok(page.includes('setAttribute("pointer-events", "none")'), "the overlay is created non-interactive");
assert.ok(page.includes("stroke-dasharray: 6 4"), "the relation paths render dashed");
assert.ok(page.includes("@keyframes dashflow { to { stroke-dashoffset: -10; } }"), "dashes flow along the path, from the blocked task towards the blocker");
assert.match(page, /@media \(prefers-reduced-motion: reduce\) \{ \.spin \{ animation: none; \} #relations path, #agent-relations path \{ animation: none; \} \}/, "reduced motion renders the relation paths static");
// 000191 motion: the new keyframes and rules ship in the page css, and the second reduced-motion
// rule stops the new animations without touching the spinner rule above
assert.ok(page.includes(".card.enter { animation: cardIn var(--enter) ease-out; }"), "new board cards fade and rise in");
assert.ok(page.includes(".agent-card.enter { animation: cardIn var(--enter) ease-out; }"), "new agent run cards reuse the card entrance");
assert.ok(page.includes("@keyframes cardIn { from { opacity: 0; transform: translateY(3px); } }"), "the card entrance is a small fade and rise, transform and opacity only");
assert.ok(page.includes("#modal:not(.hidden) { animation: fadeIn var(--enter) ease-out; }"), "the modal overlay fades in on open");
assert.ok(page.includes("#modal:not(.hidden) #m-box { animation: boxIn var(--enter) ease-out; }"), "the modal panel rises in on open");
assert.ok(page.includes("#m-log:not(.hidden) { animation: logIn var(--enter) ease-out; }"), "the log pane fades and rises on open");
assert.ok(page.includes("#m-log-text > * { animation: chunkIn var(--fade) ease-out; }"), "appended log chunks fade and rise in");
assert.ok(page.includes("@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }"), "the pulse sweeps left to right via background-position");
// 000194 letter-only shimmer: the gradient clips to the glyphs, color: transparent hides the box
assert.match(page, /#m-log-text > \.pulse, #m-log-text > details\.lg-think\.pulse, #m-log-text > details\.lg-tool\.pulse \{[^}]*background-image: linear-gradient\(90deg, var\(--shine-base\) 0%, var\(--shine-base\) 33%, color-mix\(in srgb, #fff var\(--shine\), var\(--shine-base\)\) 50%, var\(--shine-base\) 67%, var\(--shine-base\) 100%\); background-size: 300% 100%; background-repeat: no-repeat; -webkit-background-clip: text; background-clip: text; color: transparent; animation: chunkIn var\(--fade\) ease-out, shimmer var\(--pulse\) linear infinite/, "the pulse brightens only the glyphs via background-clip: text");
assert.ok(page.includes("#m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { --shine-base: var(--muted); }"), "the muted blocks' band goes muted, whiter, muted");
assert.match(page, /--enter: 200ms; --exit: 180ms; --fade: 150ms; --pulse: 2s; --shine: 45%;/, "the motion durations and the band strength retune in one place");
assert.match(page, /@media \(prefers-reduced-motion: reduce\) \{ \.card\.enter, [^}]*\{ animation: none; \} \}/, "reduced motion stops the new animations too");
// 000194 review: the details.pulse variants (1,2,1) outrank #m-log-text > * and .pulse, so they
// join the first media rule or the clip animation would keep running under reduce
assert.ok(page.includes("#m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { animation: none; } }"), "reduced motion stops the details blocks' pulse animation too, their variant outranks #m-log-text > *");
// 000194: the restore: color: transparent with the animation stopped would make the text vanish
assert.match(page, /@media \(prefers-reduced-motion: reduce\) \{ #m-log-text > \.pulse \{ background-image: none; color: var\(--fg\); \} #m-log-text > details\.lg-think\.pulse, #m-log-text > details\.lg-tool\.pulse \{ background-image: none; color: var\(--muted\); \} \}/, "reduced motion drops the gradient and restores the solid color per block type");
// the rule must come after the last base animation rule: equal specificity, so a media rule
// placed earlier is overridden and reduced motion stays animated (caught in live testing)
assert.ok(page.indexOf("@keyframes boxIn") < page.indexOf('@media (prefers-reduced-motion: reduce) { .card.enter'), "the reduced-motion rule sits after every base animation rule");
// 000194 close animations: the exits run the #191 entrances in reverse
assert.ok(page.includes("#modal.closing { animation: fadeOut var(--exit) ease-in forwards; }"), "the modal overlay fades out on close");
assert.ok(page.includes("#modal.closing #m-box { animation: boxOut var(--exit) ease-in forwards; }"), "the modal panel sinks out on close");
assert.ok(page.includes("@keyframes fadeOut { to { opacity: 0; } }") && page.includes("@keyframes boxOut { to { opacity: 0; transform: translateY(6px) scale(.985); } }"), "the panel exit mirrors the entrance's rise");
assert.ok(page.includes("#m-log.closing { animation: logOut var(--exit) ease-in forwards; }") && page.includes("@keyframes logOut { to { opacity: 0; transform: translateY(4px); } }"), "the log pane fades out on close");
assert.ok(page.indexOf("#modal:not(.hidden) { animation: fadeIn") < page.indexOf("#modal.closing {") && page.indexOf("#m-log:not(.hidden) { animation: logIn") < page.indexOf("#m-log.closing {"), "the .closing rules sit after the entrance rules, the equal-specificity close wins");
const pathRule = page.match(/#relations path \{([^}]*)\}/)?.[1] ?? "";
const baseOpacity = Number(pathRule.match(/stroke-opacity: ([\d.]+)/)?.[1]);
assert.ok(baseOpacity > 0 && baseOpacity < 1, "the relation lines draw at a reduced opacity, a subtle hint behind the semi-transparent cards");
const hotOpacity = Number(page.match(/#relations path\.relations-hot \{ stroke-opacity: ([\d.]+)/)?.[1]);
assert.ok(hotOpacity > baseOpacity, "hovering a card raises its lines' opacity clearly above the subtle base");
assert.match(pathRule, /transition: stroke-opacity/, "the opacity change transitions smoothly, the dash animation continues");
assert.ok(page.includes("el.onmouseenter = () => hotRelations(file, true)") && page.includes("el.onmouseleave = () => hotRelations(file, false)"), "the card hover wires the highlight on mouseenter and reverts on mouseleave");
assert.ok(page.includes('if (p.dataset.file === file || p.dataset.blocker === file) p.classList.toggle("relations-hot", on)'), "the hover matches paths by either endpoint's file in the dataset, no quote-unsafe selector interpolation");
assert.ok(page.includes('" data-blocker="'), "each relation path carries the blocker's file alongside the blocked task's file, so hovering either card finds it");
assert.ok(page.includes('window.addEventListener("resize", drawRelations)'), "a resize recomputes the line endpoints");
assert.match(page, /el\.ontransitionend = \(\) => \{ el\.style\.transition = ""; el\.ontransitionend = null; drawRelations\(\); \};/, "settled FLIP transitions recompute the line endpoints");
assert.ok(page.includes('querySelectorAll("#m-attrs .num-link")'), "the detail card binds its id links to openTask after render");
assert.ok(page.includes('"<div><span>blockedBy</span>"'), "the detail card builds a blockedBy row");
assert.ok(page.includes('if (!refs.length) return "";'), "no blockedBy row when the attribute is absent or empty");
assert.ok(page.includes(".num-link { color: var(--link); cursor: pointer; }"), "link ids carry the link color and a pointer affordance in both themes");
assert.ok(page.includes("#m-attrs span:not(.chip):not(.num-link)"), "the attrs styling exempts the id links");

// refresh identity: the 5 s poll keeps the node of every card whose markup did not change, so its
// spinner element keeps spinning; a state change rewrites that card's markup and nothing else
const els = new Map<string, El>();
const make = (file: string) => { const c = new El("div"); c.className = "card"; c.dataset.file = file; return c; };
const sync = (list: any[], open: Set<string> = new Set()) => syncBoard(cols, list, open, els, make, 5, { createElement: (tag: string) => new El(tag) });
const shown = (st: string) => cols[st].cards.children.filter((c: El) => c.className.split(" ")[0] === "card").map((c: El) => c.dataset.file);
const tasksA = [
	{ file: "000001_a.md", name: "feat: a", priority: "high", state: "doing", updated: 2 },
	{ file: "000002_b.md", name: "feat: b", priority: "low", state: "backlog", updated: 1 },
];
sync(tasksA);
const cardA = els.get("000001_a.md")!;
assert.ok(cardA.innerHTML.includes('<span class="spin">'), "a doing card carries the spinner");
assert.equal(cardA.writes, 1, "the first pass writes the card markup");
sync(tasksA);
assert.equal(els.get("000001_a.md"), cardA, "an unchanged card keeps its DOM node across a refresh");
assert.equal(cardA.writes, 1, "and its markup is not rewritten, so its spinner animation keeps running");
sync(tasksA.map((t) => (t.file === "000001_a.md" ? { ...t, state: "to-do", updated: 3 } : t)));
assert.equal(els.get("000001_a.md"), cardA, "a card that changes column keeps its node, so FLIP can move it");
assert.deepEqual(shown("to-do"), ["000001_a.md"], "the card sits in its new column");
assert.equal(cardA.writes, 2, "a state change rewrites the markup once");
assert.ok(!cardA.innerHTML.includes("spin"), "leaving a working column stops the spinner");
sync(tasksA);
assert.ok(cardA.innerHTML.includes('<span class="spin">'), "entering a working column starts the spinner");

// 000191 motion: a genuinely new card gains the one-shot entrance class at insertion, and neither
// an unchanged poll nor a markup rewrite ever re-adds it; only new cards are inserted (nodes kept)
assert.ok(cardA.className.includes("enter"), "a card created this pass carries the entrance class");
const later = { file: "000003_c.md", name: "feat: c", priority: "low", state: "backlog", updated: 4 };
sync([...tasksA, later]);
const cardC = els.get("000003_c.md")!;
assert.ok(cardC.className.includes("enter"), "a later insertion gains the entrance class too");
assert.equal(cardA.className, "card enter", "an unchanged card keeps the class exactly once, never re-added");
sync([{ ...tasksA[0], state: "to-do", updated: 5 }, later]);
assert.equal(cardA.className, "card enter", "a state rewrite does not re-add the entrance class");

// 000191 in-place stats (supersedes the accepted #178 spinner restart): a stats-only change
// updates the .card-stats span without rewriting the card markup, so the .spin node keeps its
// animation; the span joins when stats arrive and drops when they vanish
const liveTask = { file: "000004_d.md", name: "feat: d", priority: "high", state: "doing", updated: 6, agents: [{ tokens: 420, duration: 1500 }] };
sync([liveTask]);
const cardD = els.get("000004_d.md")!;
assert.ok(cardD.innerHTML.includes('<span class="card-stats">420 · 2s</span>'), "the card markup carries the stats span");
assert.equal(cardD.writes, 1, "the first pass writes the card markup once");
sync([{ ...liveTask, agents: [{ tokens: 900, duration: 2500 }] }]);
assert.equal(cardD.writes, 1, "a stats-only change does not rewrite the card markup, the spinner animation survives");
assert.equal(cardD.children[0].className, "card-stats", "the stats span updates in place");
assert.equal(cardD.children[0].textContent, "900 · 3s");
sync([{ ...liveTask, agents: [] }]);
assert.equal(cardD.writes, 1, "removing the stats span is in-place too");
assert.equal(cardD.children.length, 0, "the span drops when the stats vanish");

// the per-column cap and unfold (000030) and the empty marker still hold, and a card whose task
// left the board loses its node
const many = Array.from({ length: 7 }, (_, i) => ({ file: `00001${i}_x.md`, name: "feat: x", priority: "low", state: "reviewing", updated: i }));
sync(many);
assert.equal(shown("reviewing").length, 5, "a column shows at most 5 cards");
assert.equal(cols.reviewing.toggle.style.display, "", "the unfold button appears past the cap");
sync(many, new Set(["reviewing"]));
assert.equal(shown("reviewing").length, 7, "unfolding shows every card");
assert.equal(cols.reviewing.toggle.textContent, "show less", "an unfolded column offers show less");
sync(many.slice(1), new Set(["reviewing"]));
assert.equal(els.has("000010_x.md"), false, "a card whose task left the board loses its node");
assert.equal(cols["live-testing"].empty.style.display, "", "an empty column shows its dash");
assert.equal(shown("live-testing").length, 0, "an empty column holds no cards");

// 000077 ordering: backlog is priority-first then newest-first, every other column is newest-first
// only; the stable sort keeps the payload's task-number order on equal keys
const ordered = [
	{ file: "000001_a.md", name: "a", priority: "low", state: "backlog", updated: 100 },
	{ file: "000002_b.md", name: "b", priority: "critical", state: "backlog", updated: 1 },
	{ file: "000003_c.md", name: "c", priority: "high", state: "backlog", updated: 5 },
	{ file: "000004_d.md", name: "d", priority: "high", state: "backlog", updated: 5 },
	{ file: "000005_e.md", name: "e", priority: "critical", state: "backlog", updated: 9 },
	{ file: "000006_f.md", name: "f", priority: "low", state: "reviewing", updated: 5 },
	{ file: "000007_g.md", name: "g", priority: "critical", state: "reviewing", updated: 3 },
	{ file: "000008_h.md", name: "h", priority: "low", state: "reviewing", updated: 3 },
	{ file: "000009_i.md", name: "i", priority: "medium", state: "backlog", updated: 50 },
];
const backlogOrder = ["000005_e.md", "000002_b.md", "000003_c.md", "000004_d.md", "000009_i.md", "000001_a.md"];
sync(ordered, new Set(["backlog"]));
assert.deepEqual(shown("backlog"), backlogOrder, "backlog sorts priority-desc, then update-desc; equal keys keep task-number order");
assert.deepEqual(shown("reviewing"), ["000006_f.md", "000007_g.md", "000008_h.md"], "other columns sort update-desc with no priority weighting; equal update times keep task-number order");
sync(ordered, new Set(["backlog"]));
assert.deepEqual(shown("backlog"), backlogOrder, "a refresh with the same payload keeps the backlog order");

// tabs: one per registered project; a single project keeps the old ui, no tab bar
assert.deepEqual(tabNames([]), [], "an empty registry renders no tab bar");
assert.deepEqual(tabNames([{ name: "solo", root: "/r1", branch: "main" }]), [], "a single project renders no tab bar");
assert.deepEqual(
	tabNames([{ name: "alpha", root: "/r1", branch: "main" }, { name: "beta", root: "/r2", branch: "dev" }]),
	[{ id: "/r1", label: "alpha" }, { id: "/r2", label: "beta" }],
	"unique names keep the plain label",
);
// 000103: two checkouts of one repo - the label appends the branch, the identity is the root
assert.deepEqual(
	tabNames([{ name: "repo", root: "/r1", branch: "main" }, { name: "repo", root: "/r2", branch: "feat/x" }]),
	[{ id: "/r1", label: "repo (main)" }, { id: "/r2", label: "repo (feat/x)" }],
	"a duplicated name appends the branch to every duplicate",
);
assert.deepEqual(
	tabNames([{ name: "repo", root: "/r1", branch: "" }, { name: "repo", root: "/r2", branch: "feat" }]),
	[{ id: "/r1", label: "repo" }, { id: "/r2", label: "repo (feat)" }],
	"a detached HEAD (empty branch) keeps the plain label",
);
assert.deepEqual(
	tabNames([{ name: "constructor", root: "/r1", branch: "main" }, { name: "constructor", root: "/r2", branch: "dev" }]),
	[{ id: "/r1", label: "constructor (main)" }, { id: "/r2", label: "constructor (dev)" }],
	"a name colliding with Object.prototype keys still counts as duplicated",
);
assert.equal(
	tabsHtml(tabNames([{ name: "repo", root: "/r1", branch: "main" }, { name: "repo", root: "/r2", branch: "feat" }]), "/r2"),
	'<button class="tab" data-project="/r1">repo (main)</button><button class="tab active" data-project="/r2">repo (feat)</button>',
	"the tab identity is the root, so same-named checkouts get their own button",
);
assert.equal(tabsHtml([{ id: "/r1", label: "solo" }], "/r1"), "", "a single project renders no tab bar html");
assert.equal(
	tabsHtml([{ id: 'a"b', label: "a<b>" }, { id: "c", label: "c" }], "c"),
	'<button class="tab" data-project="a&quot;b">a&lt;b&gt;</button><button class="tab active" data-project="c">c</button>',
	"tab ids and labels are escaped",
);
assert.ok(
	[tabNames, tabsHtml, boardOf, mergeBoards].every((fn) => page.includes(String(fn))),
	"the page ships the tested tab helpers",
);
assert.ok(page.includes('<nav id="tabs"></nav>'), "page has the tab bar");
assert.ok(page.includes("switchTab(b.dataset.project)"), "each tab button switches the active board");
assert.match(page, /function switchTab\(name\) \{[\s\S]*?closeModal\(\);[\s\S]*?\}/, "a tab switch closes the open modal");
assert.match(page, /#tabs \{ position: relative; z-index: 1;/, "the tab bar stacks above the #modal overlay (000091)");
const modalZ = page.match(/#modal \{[^}]*z-index: (\d+)/)?.[1];
const relationsZ = page.match(/#relations \{[^}]*z-index: (\d+)/)?.[1];
const cardZ = page.match(/\.card \{[^}]*z-index: (\d+)/)?.[1];
assert.ok(modalZ && relationsZ && Number(modalZ) > Number(relationsZ), "the #modal backdrop and card stack above the #relations lines (000119)");
assert.ok(modalZ && cardZ && Number(modalZ) > Number(cardZ), "the #modal bumps above the z-index-2 task cards (000124)");
assert.ok(page.includes("render(true); // no FLIP across boards"), "a tab switch never flips from the other board's layout");
assert.ok(page.includes("Promise.all(projects.map(t => fetch(url(t))"), "every tab polls each cycle");
assert.ok(page.includes("setTimeout(refresh, refreshMs(openDetail))"), "the poll chains, the next tick keyed on the fresh open card's cadence");
assert.ok(page.includes(".catch(() => setTimeout(refresh, 5000))"), "a failed cycle retries at the board cadence");
// 000235: a throttled tab's delayed tick would land a full cadence after the wake; the client
// cancels it and refreshes at once when the gap exceeds twice the last scheduled cadence
assert.ok(page.includes("let pollTimer = null"), "the client tracks the pending poll timer");
assert.ok(page.includes("lastReload = Date.now()"), "a served board stamps the reload time");
assert.match(page, /if \(current && current\[1\]\) \{\s*document\.getElementById\("updated"\)\.textContent[\s\S]*?lastReload = Date\.now\(\);/, "the reload stamp lands with the updated line, only for a served board");
assert.ok(page.includes("lastDelay = refreshMs(openDetail)"), "the tick's cadence is kept as lastDelay");
assert.ok(page.includes(".catch(() => setTimeout(refresh, 5000)).then(t => { pollTimer = t; })"), "the failed-cycle retry timer is tracked too, so a wake cancels it");
assert.match(page, /addEventListener\("visibilitychange", \(\) => \{[\s\S]*?document\.visibilityState !== "visible"[\s\S]*?Date\.now\(\) - lastReload <= 2 \* lastDelay[\s\S]*?clearTimeout\(pollTimer\);[\s\S]*?refresh\(\);/, "a wake past twice the last cadence cancels the pending tick and refreshes at once");
assert.ok(page.includes('(active ? "&project=" + encodeURIComponent(active) : "")'), "agent-log polls carry the active tab's project");
// 000122: the live auto-scroll glides smoothly, reduced motion falls back to an instant auto;
// the client post-processes every insert, joining cross-chunk tool results and thinking deltas
assert.ok(page.includes('const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";'), "reduced motion falls back to an instant auto scroll");
assert.ok(page.includes("p.scrollTo({ top: p.scrollHeight, behavior: behavior });"), "the live auto-scroll glides smoothly to the bottom");
assert.ok(page.includes('details.lg-tool[data-tc]'), "the client dedupes tool blocks across poll windows by toolCallId");
assert.ok(page.includes(String(logFixups)), "the page runs the tested log fixups: dedupe, joins, orphan promotions");
assert.ok(page.includes('".lg-tres"'), "the client joins later tool results into their block");
assert.ok(page.includes('".lg-cont"'), "the client joins thinking deltas that continue the previous chunk's block");

// per-project payloads map to their own tab; a null payload keeps that tab's previous data
const boards = {};
mergeBoards(boards, [["alpha", [{ file: "000001_a.md" }]], ["beta", [{ file: "000002_b.md" }]]]);
assert.equal(boardOf(boards, "alpha").tasks[0].file, "000001_a.md", "each payload lands under its own project");
assert.equal(boardOf(boards, "beta").tasks[0].file, "000002_b.md");

// a tab switch keeps per-project state: fold choices and payloads survive a switch and a poll
boardOf(boards, "alpha").expanded.add("backlog");
mergeBoards(boards, [["alpha", [{ file: "000003_c.md" }]], ["beta", null]]);
assert.ok(boardOf(boards, "alpha").expanded.has("backlog"), "fold choices stay with their project");
assert.equal(boardOf(boards, "beta").tasks[0].file, "000002_b.md", "a failed project fetch keeps that tab's previous data");
assert.deepEqual(boardOf(boards, "gamma").tasks, [], "an unvisited tab starts as an empty board");
assert.deepEqual(boardOf(Object.create(null), "__proto__").tasks, [], "a project named like an object key gets its own board");
assert.ok(page.includes("Object.create(null)"), "the page keys per-project state without inherited keys");

// the hub registry answers /api/projects with its own entry
const projects = await (await fetch(`${base}/api/projects`)).json();
assert.equal(projects.length, 1, "the hub registry lists its own entry");
assert.equal(projects[0].root, root);
assert.ok(page.includes('projects = tabs.length ? tabs : [{ id: "", label: "" }]'), "the page falls back to one unnamed tab");
assert.ok(
	page.includes('t.id ? "/api/tasks?project=" + encodeURIComponent(t.id) : "/api/tasks"'),
	"the single-project fallback polls /api/tasks bare",
);

// agent info: null for a backlog task; populated for a working task with a live pid (000248:
// the agent data lives on the follow-up history fetch, the light detail carries none)
assert.equal(histPayload.agent, null);
assert.deepEqual(histPayload.agents, [], "no role logs yet, empty agent history");
assert.ok(page.includes('id="m-agent"'), "modal has the agent area");
assert.ok(!page.includes("<div><span>name</span>"), "the detail card drops the name attribute row the title already shows");
assert.ok(page.includes('"<div><span>issuer</span>" + issuerCell(t) + "</div>"'), "the detail card shows the issuer row");
assert.ok(page.includes('return target ? numLinkHtml(target.file) : esc(t.issuer || "user")'), "a task-issued issuer links to its card, plain text for user or an off-board number");
assert.ok(
	page.includes("\"<div><span>complexity</span><span class='chip cx cx-\" + esc(t.complexity || \"moderate\") + \"'>\""),
	"the detail card complexity row carries the value class",
);
assert.ok(
	page.includes("\"<div><span>priority</span><span class='chip p-\" + esc(t.priority) + \"'>\" + esc(t.priority) + \"</span></div>\" +"),
	"the detail card keeps the priority row with only the priority chip",
);
assert.ok(page.includes("#m-log.hidden { display: none; }"), "log pane hides");
assert.ok(page.includes("#m-log-meta { padding: 6px 10px 0; font-size: 0.75rem; line-height: 1.45; color: var(--muted); }") && page.includes("#m-log-meta.hidden { display: none; }"), "the log meta line renders muted grey and hides while no meta is available");
assert.ok(page.includes("/api/agent-log"), "page uses the agent log endpoint");
assert.ok(page.includes('<span class="check">✓</span>'), "past agent buttons render a green checkmark");
assert.ok(page.includes('<span class="cross">✗</span>'), "a dead run's card renders a cross instead of the check");
assert.ok(page.includes('a.status === "dead" ? "agent-dead" : "agent-past"'), "a dead run's card carries its own class, ok keeps agent-past");
assert.match(page, /\.cross \{ color: var\(--critical-fg\); margin-right: 5px; \}/, "the cross renders in the muted red both themes carry");
assert.match(page, /\.agent-dead \{ color: var\(--critical-fg\); \}/, "a dead card's label text reads in the muted red too");
assert.ok(page.includes(".agent-card-active"), "the shown agent card gets an active class");
// 000076: the small font belongs to the log text, not the selector cards; 000120: each run is a
// bit larger card in one wrapping row of columns, the live run last, its subs stacked below it
const agentCardCss = page.match(/\.agent-card \{[^}]*\}/)![0];
assert.ok(agentCardCss.includes("font-size: 0.875rem") && agentCardCss.includes("padding: 6px 10px"), ".agent-card is a bit larger than the old button");
// 000122: the log text renders in the page's sans serif stack, blocks are collapsed details;
// 000152: the size matches the card body text, no smaller log font-size remains
const logCss = page.match(/#m-log-text \{[^}]*\}/)![0];
assert.ok(logCss.includes("font-size: 0.9375rem") && !/font-size: 0\.(75|8125|875)rem/.test(logCss), "the agent log text renders at the card body size, no smaller log font-size");
// 204: every font-size is rem against the 16px base; the exact counts pin the mapping
const sizeCounts = [...page.matchAll(/font-size: ([\d.]+)rem/g)].map((m) => m[1]);
const gotSizes: Record<string, number> = {};
for (const s of sizeCounts) gotSizes[s] = (gotSizes[s] ?? 0) + 1;
assert.deepEqual(gotSizes, { "0.75": 4, "0.8125": 1, "0.875": 11, "0.9375": 4, "1.0625": 1, "1.125": 1 }, "every served font-size matches the rem mapping (12->0.75, 13->0.8125, 14->0.875, 15->0.9375, 17->1.0625, 18->1.125)");
// 204: mobile, zooming blocked and the root font size 15% smaller under 600px
assert.ok(page.includes('<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">'), "the viewport meta blocks zooming on mobile");
assert.ok(page.includes("@media (max-width: 600px) { html { font-size: 85%; } }"), "mobile screens render the root font size 15% smaller");
const logPaneCss = page.match(/#m-log \{[^}]*\}/)![0];
assert.ok(logPaneCss.includes("max-height: 70vh"), "the log pane grows to 70vh so long logs show more content");
// 000147: the no-monospace check stays scoped to this font-family declaration now that the code/pre rule adds monospace elsewhere
const logFont = logCss.match(/font-family: [^;]+;/)![0];
assert.ok(logFont.includes("system-ui") && !logFont.includes("monospace"), "the agent log text font-family declaration stays sans serif, not monospace");
// 000141: the Google Inter font loads in the page head and goes first in both font-family stacks
assert.ok(page.includes('<link rel="preconnect" href="https://fonts.googleapis.com">') && page.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'), "the page preconnects to Google Fonts before the Inter stylesheet");
assert.ok(page.includes('https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet"'), "the page loads the Inter stylesheet from fonts.googleapis.com");
assert.equal(page.match(/font-family: Inter, system-ui[^;]*;/g)?.length, 2, "Inter goes first in exactly the two font-family declarations (body and #m-log-text)");
// 000153: inline and fenced code render in an explicit monospace stack in the log pane and task
// body; buttons inherit the page font; the Thinking prose and tool args/output pres are not code,
// so the bare #m-log-text pre stays outside the selector and inherits the Inter page font
const monoRule = '#m-log-text code, #m-log-text pre code, #m-body code, #m-body pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }';
assert.ok(page.includes(monoRule), "code and fenced code render in an explicit monospace stack in the log pane and task body");
const monoSelectors = monoRule.slice(0, monoRule.indexOf("{")).split(",").map((s) => s.trim());
assert.ok(monoSelectors.includes("#m-log-text code") && monoSelectors.includes("#m-log-text pre code"), "inline code and fenced code stay in the log-pane monospace selector");
assert.ok(!monoSelectors.includes("#m-log-text pre"), "the Thinking prose and the tool args/output pres are not inside the monospace selector, they stay Inter");
assert.ok(page.includes("button { font-family: inherit; }"), "buttons inherit the page font instead of the UA Arial default");
assert.ok(page.includes(String(md)), "the page runs the tested md renderer for task bodies and log text");
assert.ok(page.includes("#m-log-text pre { font: inherit;"), "log block bodies inherit the sans serif font");
assert.ok(page.includes("#m-log-text pre { font: inherit; margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: break-word; }"), "expanded log block bodies wrap to the container width");
assert.ok(page.includes("#m-log-text summary { cursor: pointer;"), "collapsed log summaries read as clickable");
assert.ok(page.includes("#m-log-text details.lg-think, #m-log-text details.lg-tool { color: var(--muted); }"), "thinking and tool blocks render muted grey in both themes, collapsed and expanded alike");
assert.ok(/display: flex; flex-wrap: wrap/.test(page.match(/#m-agent-btns \{[^}]*\}/)![0]), "the run columns render as one wrapping flex row");
assert.ok(!page.includes(".agent-past {") && !page.includes(".agent-live {"), "no per-card block row styles remain");
assert.ok(page.includes('"agent-past"') && page.includes('"agent-live"'), "past and live cards carry their state class");
assert.ok(page.includes("runs.splice(runs.indexOf(live), 1); runs.push(live);"), "cards render chronologically: the live run moves last, past runs keep payload order");
assert.ok(!page.includes("openAgentLog(&quot;"), "no run handle reaches inline JS: quotes and backslashes would break the onclick");
// 000120 detail-card agent history: one horizontal row of run columns, each run a card with the
// tokens and duration next to the label, its subagent cards stacked below, always visible
assert.ok(page.includes('class="agent-stats"'), "each card carries a tokens/duration stats line");
assert.ok(page.includes('"Sub-" + a.role'), "sub cards label Sub-<caller role>, without the id string");
assert.ok(page.includes("openSubLog(b.dataset.handle, Number(b.dataset.sub))"), "a sub card opens its own run's subagent transcript");
assert.ok(page.includes("runs.forEach((a, i) => fetchSubs(gen, a, boxes[i]))"), "on openTask every run's sub list is fetched in parallel, not only the clicked run's");
assert.ok(!page.includes('id="m-sub-btns"'), "the single sub row is gone; subs stack under their caller column");
assert.match(page, /\.agent-col \{ display: flex; flex-direction: column/, "each column stacks its run card over its sub cards");
assert.match(page, /\.agent-subs \{ display: flex; flex-direction: column/, "sub cards stack vertically below their caller");
assert.ok(page.includes('if (gen !== agentGen || !box) return;'), "a superseded open's sub fetches never write into the new view");
// 000191: the sub list rebuild is html-gated (the keep pass re-fetches every second), and only a
// newly spawned sub card animates; a genuinely new run card carries the entrance too
// 000251: the sub list gate keys on the sub set only, so a growing transcript's advancing tokens
// and duration never rebuild the cards; an unchanged set moves the stats lines in place
assert.ok(!page.includes("if (box.__html === html) return;"), "the sub list gate no longer keys on the full html, a growing transcript's stats never trigger a rebuild");
const fsSubs = page.match(/function fetchSubs\(gen, a, box\) \{[\s\S]*?\n\}/)![0];
assert.ok(fsSubs.includes(".map(s => s.index)"), "the sub list gate keys on the sub indexes only");
assert.ok(fsSubs.includes("syncStatsLine("), "an unchanged sub list updates the stats lines in place, the cards stay mounted");
assert.ok(page.includes('if (prev && !prev.has(b.dataset.sub)) {'), "only a newly spawned sub card animates");
assert.ok(page.includes('b.onanimationend = () => { b.classList.remove("enter"); b.onanimationend = null; };'), "the sub cards' entrance class is dropped too, the rebuild's box carry-over never replays it");
assert.ok(page.includes('if (oldSubs && !oldSubs.has(b.dataset.handle)) b.classList.add("enter")'), "only a genuinely new run card animates");
assert.ok(page.includes('el.onanimationend = () => { el.classList.remove("enter"); el.onanimationend = null; };'), "the page drops the entrance class when the animation ends");
assert.ok(page.includes("syncBoard(cols, tab.tasks, tab.expanded, cardEls, makeCard, VISIBLE, document)"), "the card pass gets the document for the in-place stats span");
// 000121: the 5 s refresh re-derives the open detail card in place: title and attrs freely, the
// body html-gated, the run cards re-rendered without touching the log pane or its state
const upd = page.match(/function updateOpenTask\(t\) \{[\s\S]*?\n\}/)![0];
assert.ok(page.includes("if (!open) closeModal();"), "the refresh closes the open card when its task is gone");
assert.ok(page.includes("function pollDetail()"), "000242: the poll re-fetches the open task's detail, the light rows carry no agent data");
assert.ok(upd.includes("writeHead(t)") && upd.includes("renderAgent(t, true)") && upd.includes("setBody(t)"), "the refresh re-derives title, attrs, agent row and body from the fresh payload");
assert.ok(!upd.includes("closeLog") && !upd.includes("logState"), "the refresh path never touches the log pane, logState or the log timer");
assert.ok(page.includes('<div id="m-agent"><svg id="agent-relations"></svg><div id="m-agent-btns"></div><div id="m-doctor"></div><div id="m-log-meta" class="hidden"></div><div id="m-log" class="hidden"><div id="m-log-text"></div></div></div>'), "000154: the meta line ships as a sibling above the log pane, hidden until a payload carries meta; 000222 adds the doctor row between the run columns and the meta line; 000237 ships the relation SVG as the agent area's first child");
// 000222/000230 the Doctor card: one card per analysed run's doctor step, slotted into the
// analysed run's column below the run card (matched by handle, the run's plus the .doctor
// suffix); the residual #m-doctor row sits between the run columns and the log meta and keeps
// only the cards whose run column is gone, clicking a card opens the doctor log
assert.ok(page.indexOf('id="m-doctor"') > page.indexOf('id="m-agent-btns"') && page.indexOf('id="m-doctor"') < page.indexOf('id="m-log-meta"'), "#m-doctor sits between #m-agent-btns and #m-log-meta inside the agent area");
assert.ok(page.includes("function renderDoctor(t, keep)"), "the script defines renderDoctor for the doctor cards");
const rd = page.match(/function renderDoctor\(t, keep\) \{[\s\S]*?\n\}/)![0];
assert.ok(rd.includes("(t.doctors || []).slice()"), "renderDoctor builds one card per doctors entry of the fresh payload");
assert.ok(rd.includes("openAgentLog(b.dataset.handle)"), "a doctor card's click opens its doctor log by handle");
assert.ok(rd.includes("syncDoctorCards(cards, docs, row, el, document)"), "the keep pass runs syncDoctorCards, so an unchanged doctor set moves only the stats lines and the live doctor's spinner survives");
assert.ok(rd.includes("(doctorCol(row, d.handle) ?? el).appendChild(b)"), "each doctor card slots into its analysed run's column, unmatched cards fall back to the residual row");
assert.ok(page.includes('meta.classList.toggle("hidden", !label)') && page.includes('" \u00b7 thinking "'), "openLog/pullLog fill the meta line on init and every poll, model name then thinking level");
assert.ok(!page.includes(`+ '</div><div id="m-log"`), "renderAgent no longer rebuilds the log pane with the run cards");
const setBodySrc = page.match(/function setBody\(t\) \{[\s\S]*?\n\}/)![0];
assert.ok(setBodySrc.includes("if (el.__html === html) return;"), "the body rewrite is html-gated: an unchanged body keeps its node and the reader's scroll");
const ra = page.match(/function renderAgent\(t, keep\) \{[\s\S]*?\n\}/)![0];
assert.ok(ra.includes('.agent-subs").replaceWith(box)'), "a refresh carries the fetched sub boxes over by handle");
assert.ok(ra.includes('a.role === "splitter" ? "agent-splitter " : ""'), "the splitter run's card carries the agent-splitter marker class");
// 000130: the keep refresh re-fetches only the live run's sub list, so a sub spawned after the
// card was opened gets its button without re-opening the run; past runs' lists are never re-fetched
assert.ok(ra.includes('if (live) fetchSubs(agentGen, live,') && ra.includes('.agent-col:last-child > .agent-subs'), "the keep refresh re-fetches only the live run's (last column's) sub list");
assert.ok(ra.indexOf("if (keep) {") < ra.indexOf("++agentGen"), "the keep refresh passes the current generation, only an openTask render bumps agentGen");
// 000251: a run-row rebuild lifts the slotted doctor cards out before the innerHTML write and
// re-slots them after, so the keep pass's parentElement check holds and no doctor card remounts
assert.ok(ra.includes("doctorRow.__cards || []"), "the run-row rebuild lifts the slotted doctor cards out before the innerHTML write");
assert.ok(ra.includes("(doctorCol(el, c.dataset.handle) ?? doctorRow).appendChild(c)"), "the run-row rebuild re-slots the preserved doctor cards after");
// 000130: a sub transcript of a still-alive parent keeps polling (an empty poll is not proof a
// growing transcript stopped); a past run's log still stops after the first empty poll
const pollSrc = page.match(/function pollLog\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(pollSrc.includes("const live = (!!liveRun && liveRun.handle === logState.handle) || (!!liveDoctor && liveDoctor.handle === logState.handle);"), "a sub view of a still-alive parent stays live: the pane keeps its poll timer after an empty poll");
// 000222: a live doctor entry keeps its log polling the same way, so a running doctor's pane
// never freezes after an empty poll
assert.ok(pollSrc.includes('const liveDoctor = t && (t.doctors || []).find(d => d.alive);'), "pollLog's live check also matches a live doctors entry, so a live doctor log keeps polling");
assert.ok(!pollSrc.includes("logState.sub == null"), "a sub view is no longer hard-wired non-live, which froze the pane after the first empty poll");
assert.ok(pollSrc.includes("if (!live && logState.idle) {"), "a past run's log still stops the timer after the first empty poll");
// 000226: the doctor cards read blue from the #m-doctor scope; all three theme blocks carry
// the blue variables and the unscoped .agent-card rules keep their colors for the run columns
// and the sub cards. 000232: at rest only the doctor text and check mark stay blue, the plain
// outline and panel background show through
const lightVars = page.match(/:root \{ --bg: [^}]*\}/)![0];
const darkVars = page.match(/:root\[data-theme="dark"\] \{ --bg: [^}]*\}/)![0];
const mediaVars = page.match(/:root:not\(\[data-theme="light"\]\) \{ --bg: [^}]*\}/)![0];
for (const [theme, block] of [["light", lightVars], ["dark", darkVars], ["prefers-dark", mediaVars]] as const) {
	for (const v of ["--doctor-fg:", "--doctor-bg-strong:"]) assert.ok(block.includes(v), `the ${theme} theme block defines ${v}`);
}
assert.ok(!page.includes("--doctor-bg:"), "the unused --doctor-bg variable is gone from the theme blocks");
// 000240: the light hover is a near-opaque very light grey, so a hovered card stays clear
// against the white panel; the dark hover keeps its opaque #1b1f29
assert.ok(lightVars.includes("--hover: rgba(233, 237, 242, .95);"), `the light hover is the very light rgba(233, 237, 242, .95) (got ${lightVars.match(/--hover: [^;]+/)![0]})`);
for (const [theme, block] of [["dark", darkVars], ["prefers-dark", mediaVars]] as const) {
	assert.ok(block.includes("--hover: #1b1f29;"), `the ${theme} hover stays the opaque #1b1f29`);
}
assert.equal(lightVars.match(/--doctor-fg: (#[0-9a-f]{6})/)![1], "#2f6fdd", "the light doctor blue is the deeper #2f6fdd");
assert.equal(darkVars.match(/--doctor-fg: (#[0-9a-f]{6})/)![1], "#59a7ff", "the dark doctor blue is the lighter #59a7ff");
assert.ok(page.includes(".agent-doctor { color: var(--doctor-fg); }"), "the .agent-doctor rest state sets only the blue text, so the plain card outline and panel background show through, in their run's column and in the residual row alike");
assert.ok(!page.includes(".agent-doctor:hover"), "the doctor card inherits the plain .agent-card hover, with no blue rest highlight");
assert.ok(page.includes(".agent-doctor.agent-card-active { border-color: var(--doctor-fg); background: var(--doctor-bg-strong); }"), "the active doctor card keeps the blue outline and highlight, never the base link/medium-bg pair");
assert.ok(page.includes(".agent-doctor .check { color: var(--doctor-fg); }"), "the doctor card's checkmark reads the same blue as the card text");
assert.ok(page.includes(".agent-splitter { color: var(--doctor-fg); }"), "the splitter card reads the doctor blue at rest");
assert.ok(page.includes(".agent-splitter.agent-card-active { border-color: var(--doctor-fg); background: var(--doctor-bg-strong); }"), "the active splitter card keeps the blue outline and highlight");
assert.ok(page.includes(".agent-splitter .check { color: var(--doctor-fg); }"), "the splitter card's checkmark reads the same blue");
assert.ok(page.includes(".check { color: var(--low-fg); margin-right: 5px; }"), "the unscoped .check keeps var(--low-fg) for the run cards' and sub cards' checkmarks");
assert.ok(page.includes('agentCardHtml("agent-doctor " + (d.alive ? "agent-live" : "agent-past")'), "doctor cards keep their agent-live/agent-past classes under the agent-doctor marker, so no unscoped per-variant rule sets a color on them");
assert.ok(agentCardCss.includes("color: var(--link)") && agentCardCss.includes("border: 1px solid var(--border)") && agentCardCss.includes("background: color-mix(in srgb, var(--panel) 85%, transparent)"), "the unscoped .agent-card keeps gold text, grey outline and the main view's semi-transparent rest background for the run and sub cards");
assert.ok(page.includes(".agent-card:hover { background: var(--hover); }") && page.includes(".agent-card-active { border-color: var(--link); background: var(--medium-bg); }"), "the unscoped hover and active rules keep today's colors");
// 000194: the live pulse follows the viewed run's aliveness, the same signal the poll timer
// reads, refreshed from pullLog after every payload and dropped on close
assert.ok(page.includes("function markLiveLine()"), "the page wires the live block pulse");
assert.ok(page.includes('for (const el of text.children) el.classList.toggle("pulse", el === live)'), "the pulse walks the direct children, the latest live block only");
assert.ok(page.includes("markLiveLine();"), "pullLog, closeLog, pollLog's idle stop and the refresh drive the pulse");
// 000191: the death sweep, the two paths that observe the run's death clear the pulse without a
// close/reopen: the refresh's open-card update (the same pass that drops the dead run's .spin)
// and pollLog's idle early-return (which stops the timer before pullLog could sweep)
assert.ok(upd.includes("markLiveLine();"), "the refresh's open-card update sweeps the pulse when the run dies");
const idleStop = pollSrc.match(/if \(!live && logState\.idle\) \{[\s\S]*?\n\t\}/)![0];
assert.ok(idleStop.includes("markLiveLine();"), "pollLog sweeps the pulse when the idle early-return stops the timer on a dead run");
// 000194 markLiveLine retarget, run against the served source: the pulse lands on the LATEST open
// thinking/tool block only. The stub records the toggles through classList.
class ShineEl {
	tag: string;
	className = "";
	dataset: Record<string, string> = {};
	children: ShineEl[] = [];
	constructor(tag: string) { this.tag = tag; }
	classList = {
		contains: (cls: string) => this.className.split(" ").includes(cls),
		toggle: (cls: string, on: boolean) => { this.className = on ? (this.className ? this.className + " " + cls : cls) : this.className.split(" ").filter((c) => c !== cls).join(" "); },
	};
	querySelector(sel: string) { return sel === "pre.lg-out" ? this.children.find((c) => c.tag === "pre" && c.classList.contains("lg-out")) ?? null : null; }
}
const shThinkBlock = (open: boolean) => { const d = new ShineEl("details"); d.className = "lg-think"; if (open) d.dataset.open = "think"; return d; };
const shToolBlock = (done: boolean) => {
	const d = new ShineEl("details");
	d.className = "lg-tool";
	if (done) { const out = new ShineEl("pre"); out.className = "lg-out"; d.children.push(out); }
	return d;
};
const markOf = (children: ShineEl[], opts: { alive?: boolean; hidden?: boolean; handle?: string } = {}) => {
	const container = new ShineEl("div");
	container.children = children;
	const pane = new ShineEl("div");
	if (opts.hidden) pane.className = "hidden";
	const mark = new Function("openDetail", "modalFile", "logPane", "logState", "document", page.match(/function markLiveLine\(\) \{[\s\S]*?\n\}/)![0] + "; return markLiveLine;")(
		{ file: "t.md", agents: [{ handle: "h", alive: opts.alive !== false }] },
		"t.md",
		() => pane,
		{ handle: opts.handle ?? "h" },
		{ getElementById: (id: string) => (id === "m-log-text" ? container : null) },
	);
	return () => mark();
};
// the latest open thinking block shines, an earlier closed one and plain text do not
const thinkBlocks = [shThinkBlock(false), new ShineEl("p"), shThinkBlock(true)];
markOf(thinkBlocks)();
assert.ok(thinkBlocks[2].classList.contains("pulse"), "the pulse lands on the latest open thinking block");
assert.ok(!thinkBlocks[0].classList.contains("pulse") && !thinkBlocks[1].classList.contains("pulse"), "an earlier closed block and plain text never shine");
// an executing tool block (its result pre has not arrived) shines, an ended one does not
const toolBlocks = [shToolBlock(true), shThinkBlock(false), shToolBlock(false)];
markOf(toolBlocks)();
assert.ok(toolBlocks[2].classList.contains("pulse"), "the pulse lands on the latest executing tool block");
assert.ok(!toolBlocks[0].classList.contains("pulse"), "an ended tool block does not shine");
// a run between blocks or streaming plain text leaves nothing shining
const idleBlocks = [new ShineEl("p"), shThinkBlock(false), shToolBlock(true), new ShineEl("p")];
markOf(idleBlocks)();
assert.ok(idleBlocks.every((b) => !b.classList.contains("pulse")), "no block shines between blocks or on plain text");
// the shine clears on run death (000193 stays) and when another run's log is open
const dyingBlocks = [shThinkBlock(true), shToolBlock(false)];
markOf(dyingBlocks, { alive: false })();
assert.ok(dyingBlocks.every((b) => !b.classList.contains("pulse")), "a dead run clears the shine");
const otherBlocks = [shThinkBlock(true)];
markOf(otherBlocks, { handle: "other" })();
assert.ok(!otherBlocks[0].classList.contains("pulse"), "a different run's view clears the shine");
// 000194 close paths: one closeAnimated helper serves the modal and the log pane; the hide waits
// for animationend with a fixed-timeout fallback, a reopen during the close cancels it, reduced
// motion hides at once. The X button, the overlay click and Esc all keep the shared closeModal.
class CloseEl {
	className = "";
	listeners: Array<(e?: unknown) => void> = [];
	classList = {
		add: (cls: string) => { if (!this.classList.contains(cls)) this.className += (this.className ? " " : "") + cls; },
		remove: (cls: string) => { this.className = this.className.split(" ").filter((c) => c !== cls).join(" "); },
		contains: (cls: string) => this.className.split(" ").includes(cls),
	};
	addEventListener(_type: string, fn: (e?: unknown) => void) { this.listeners.push(fn); }
	removeEventListener(_type: string, fn: (e?: unknown) => void) { this.listeners = this.listeners.filter((l) => l !== fn); }
}
const closeTimers: Array<(() => void) | null> = [];
const closeOf = (reduce: boolean) => new Function("matchMedia", "setTimeout", "clearTimeout", page.match(/function closeAnimated\(el\) \{[\s\S]*?\n\}/)![0] + "; return closeAnimated;")(
	() => ({ matches: reduce }),
	(fn: () => void) => { closeTimers.push(fn); return closeTimers.length - 1; },
	(id?: number) => { if (id != null) closeTimers[id] = null; },
);
const closing = new CloseEl();
closeOf(false)(closing);
assert.ok(closing.classList.contains("closing") && !closing.classList.contains("hidden"), "the close starts the exit animation");
closing.listeners[0]();
assert.ok(closing.classList.contains("hidden") && !closing.classList.contains("closing"), "animationend hides the element and drops .closing");
// 000194 review: descendant chunkIn/boxIn ends bubble up, only the element's own exit hides it
const bubbling = new CloseEl();
closeOf(false)(bubbling);
bubbling.listeners[0]({ target: { tag: "pre" } }); // a descendant chunkIn's animationend reaches the pane first
assert.ok(!bubbling.classList.contains("hidden") && bubbling.classList.contains("closing"), "a bubbled descendant animationend does not hide early");
bubbling.listeners[0]({ target: bubbling }); // the element's own exit ends the hide and drops the listener
assert.ok(bubbling.classList.contains("hidden") && !bubbling.classList.contains("closing"), "the element's own animationend hides it");
assert.ok(bubbling.listeners.length === 0, "the hide listener drops after the element's own animationend");
// 000194 review: a reopen drops .closing (the late animationend no-ops above) but the cancelled
// close's fallback timer stays armed; the next close must clear it or it cuts the new exit
const again = new CloseEl();
const timerBase = closeTimers.length;
closeOf(false)(again);
again.classList.remove("closing"); // the reopen inside the fallback window
closeOf(false)(again);
assert.ok(again.classList.contains("closing") && !again.classList.contains("hidden"), "the second close restarts the exit");
assert.ok(closeTimers[timerBase] === null, "the second close clears the cancelled close's stale fallback timer");
closeTimers[timerBase + 1]?.(); // the second close's own fallback fires
assert.ok(again.classList.contains("hidden") && !again.classList.contains("closing"), "the live fallback still hides");
const reopened = new CloseEl();
closeOf(false)(reopened);
reopened.classList.remove("closing"); // openTask/openLog reopen during the close
reopened.listeners[0](); // the late animationend must not re-hide
assert.ok(!reopened.classList.contains("hidden"), "a reopen during the close cancels the pending hide");
const still = new CloseEl();
closeOf(true)(still);
assert.ok(still.classList.contains("hidden") && !still.classList.contains("closing"), "reduced motion hides at once with no exit");
const closeFn = page.match(/function closeModal\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(closeFn.includes("closeLog()") && closeFn.includes("closeAnimated(modal)"), "the modal close clears the log state and runs the shared exit");
// 000251: the loaded log text is the heavy part of the detail card, dropped at close so the tab
// holds no transcript memory while the card is shut; the run cards stay mounted for the reopen
assert.ok(closeFn.includes('getElementById("m-log-text")') && closeFn.includes('textContent = "";'), "the modal close discards the loaded log text");
assert.ok(page.includes('onclick="closeModal()"'), "the X button uses the shared close path");
assert.ok(page.includes('if (e.target.id === "modal") closeModal();'), "the overlay click uses the shared close path");
assert.ok(page.includes('if (e.key === "Escape") closeModal();'), "Esc uses the shared close path");
const closeLogFn = page.match(/function closeLog\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(closeLogFn.indexOf("clearInterval") < closeLogFn.indexOf("closeAnimated") && closeLogFn.includes("logState = null;"), "closeLog clears the poll and the state before the visual hide");
assert.ok(closeLogFn.includes("markActiveAgent();") && closeLogFn.includes("markLiveLine();"), "the active-agent highlight and the shine clear at once too");
assert.ok(page.includes('modal.classList.remove("closing");'), "openTask drops a pending close before reopening");
// 000209: the popup must show the top on every open; the reset runs after the un-hide because a
// scrollTop write while the modal is display: none is discarded and the old offset returns on show
const openTaskSrc = page.match(/function openTask\(file\) \{[\s\S]*?\n\}/)![0];
assert.ok(openTaskSrc.indexOf('classList.remove("hidden")') < openTaskSrc.indexOf("scrollTop = 0"), "openTask resets the scroll after the un-hide, so every open (same-task reopen included) shows the top");
assert.ok(openTaskSrc.includes("fetch(detailUrl(file))"), "000242: openTask fetches the per-task detail");
assert.ok(openTaskSrc.includes("Loading task details"), "000242: openTask shows a loading placeholder while the detail fetch runs");
// 000246: the loading state pairs the existing spinner with the label, the arrival grows the
// modal from the pinned loading height to the content height, and the failure path stays static
assert.ok(openTaskSrc.includes('<div class="empty"><span class="spin"></span>Loading task details…</div>'), "000246: the loading placeholder pairs the spinner with the label");
assert.ok(page.includes("#m-box.grow { transition: height var(--enter) ease-out; }"), "000246: the grow is a CSS height transition, no library");
assert.ok(page.includes("@media (prefers-reduced-motion: reduce) { #m-box.grow { transition: none; } }"), "000246: reduced motion turns the grow off");
assert.ok(openTaskSrc.includes('box.classList.add("grow")') && openTaskSrc.includes('box.style.height = box.offsetHeight + "px"'), "000246: openTask pins the loading height");
assert.ok(openTaskSrc.indexOf('classList.remove("hidden")') < openTaskSrc.indexOf("box.offsetHeight"), "000246: the pin runs after the un-hide, a hidden box measures zero");
assert.ok(openTaskSrc.includes('box.style.height = box.scrollHeight + "px";'), "000246: the arrival transitions to the measured content height");
assert.ok(openTaskSrc.includes('box.style.height = "";'), "000246: the pinned height returns to auto after the grow");
assert.ok(/if \(!d\) \{[\s\S]*?box\.style\.height = ""[\s\S]*?Task details failed to load/.test(openTaskSrc), "000246: a failed fetch unpins the modal before the error shows, so it never grows");
// 000251: no upfront agent render from the light row (the row data carries no doctors and no
// mounted sub boxes, so every card unmounted and remounted on the detail); the mounted cards
// are this task's on a same-task reopen, the row clears once on a switch, and the history
// render keeps mode so the cards mount once and stay mounted
assert.ok(!openTaskSrc.includes("renderAgent(t)") && !openTaskSrc.includes("renderDoctor(t)"), "openTask never renders the agent or doctor rows from the light row");
assert.ok(openTaskSrc.includes("renderAgent({})") && openTaskSrc.includes("renderDoctor({})"), "a task switch clears the stale row once, a same-task reopen keeps the mounted cards");
assert.ok(openTaskSrc.includes("renderAgent(h, keepCards)") && openTaskSrc.includes("renderDoctor(h, keepCards)"), "the history render keeps mode, the cards mount once and stay mounted across opens");
assert.ok(!page.includes("detailGen"), "no detail generation counter, a poll cycle never discards a just-opened task's response");
assert.match(page, /function openLog\(handle, sub\) \{[\s\S]*?p\.classList\.remove\("closing"\);/, "openLog drops a pending close before reopening");
// 000243: opening a log clears the previous agent's content at once and shows the loading state
// until the init payload replaces it; a failed init fetch leaves that loading state in place,
// never the previous agent's log
const openLogBody = page.match(/function openLog\(handle, sub\) \{[\s\S]*?\n\}/)![0];
let logPaneText = "the previous agent's log";
const logTextStub = {
	get textContent() { return logPaneText; },
	set textContent(v: string) { logPaneText = v; },
	classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
};
const logMetaStub = { textContent: "", classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} } };
const logPaneStub = { classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} } };
let openInitMode = "";
const openLogFn = new Function(
	"activeBoard", "modalFile", "logPane", "document", "markActiveAgent", "pullLog", "pollLog", "logUrl", "setInterval", "clearInterval",
	"let logState = null, logTimer = null;\n" + openLogBody + "\nreturn openLog;",
)(
	() => ({ tasks: [{ file: "t.md" }] }),
	"t.md",
	() => logPaneStub,
	{ getElementById: (id: string) => (id === "m-log-text" ? logTextStub : id === "m-log-meta" ? logMetaStub : null) },
	() => {},
	(_qs: string, mode: string) => { openInitMode = mode; },
	() => {},
	() => "",
	() => 1,
	() => {},
);
openLogFn("t.developer.0", null);
assert.equal(logPaneText, "Loading...", "openLog clears the previous agent's log and shows the loading text before the init payload");
assert.equal(openInitMode, "init", "openLog still starts the init fetch after clearing the pane");
const pullLogBody = page.match(/function pullLog\(qs, mode\) \{[\s\S]*?\n\}/)![0];
const failedState: Record<string, any> = { handle: "t.developer.0", sub: null, head: 0, tail: 0, busy: false };
let failedIngest = 0;
const failingPull = new Function(
	"logState", "logPane", "document", "fetch", "ingest", "logFixups", "glide", "atBottom", "markLiveLine",
	pullLogBody + "\nreturn pullLog;",
)(
	failedState,
	() => logPaneStub,
	{ getElementById: (id: string) => (id === "m-log-text" ? logTextStub : logMetaStub) },
	() => Promise.reject(new Error("offline")),
	() => { failedIngest++; },
	() => {},
	() => {},
	() => true,
	() => {},
);
failingPull("", "init");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(failedIngest, 0, "a failed init fetch renders no log content");
assert.equal(logPaneText, "Loading...", "a failed init fetch leaves the loading text visible, never the previous agent's log");

// 000142 the poll refresh updates the agent row in place: an unchanged run set moves only the
// cards' .agent-stats text, so the live run's .spin node keeps its animation across the poll; a
// structure change (a run added or gone, live -> dead) rebuilds the row. runRow builds the row
// the page's rebuild would have produced, with its seeded signature.
const docStub = { createElement: (tag: string) => new El(tag) };
const runRow = (runs: any[]) => {
	const row = new El("div");
	for (const a of runs) {
		const card = new El("button");
		card.className = "agent-card " + (a.alive ? "agent-live" : a.status === "dead" ? "agent-dead" : "agent-past");
		card.dataset.handle = a.handle;
		const mark = new El("span");
		mark.className = a.alive ? "spin" : a.status === "dead" ? "cross" : "check";
		card.appendChild(mark);
		const stats = agentStatsText(a.tokens, a.duration);
		if (stats) { const s = new El("span"); s.className = "agent-stats"; s.textContent = stats; card.appendChild(s); }
		const col = new El("div");
		col.className = "agent-col";
		col.appendChild(card);
		col.appendChild(new El("div")).className = "agent-subs";
		row.appendChild(col);
	}
	row.__sig = agentRowSig(runs);
	return row;
};
const liveRuns = [
	{ role: "developer", run: 0, alive: false, status: "ok", handle: "t.developer.0", tokens: 999, duration: 60000 },
	{ role: "reviewer", run: null, alive: true, status: "live", handle: "t.reviewer", tokens: 42311, duration: 3479 },
];
const agentRow = runRow(liveRuns);
const spin = agentRow.children[1].children[0].children[0];
assert.ok(spin.className === "spin", "the live card carries its spinner");
const grew = [
	{ role: "developer", run: 0, alive: false, status: "ok", handle: "t.developer.0", tokens: 1500, duration: 90000 },
	{ role: "reviewer", run: null, alive: true, status: "live", handle: "t.reviewer", tokens: 999, duration: 90000 },
];
assert.ok(syncAgentStats(agentRow, grew, docStub), "an unchanged run set updates the row in place");
assert.equal(agentRow.children[1].children[0].children[0], spin, "the same .spin node keeps its animation running");
assert.equal(agentRow.children[1].children[0].children[1].textContent, "999 · 1m 30s", "the live card's stats text moved");
assert.equal(agentRow.children[0].children[0].children[1].textContent, "2k · 1m 30s", "the past card's stats text moved too");
assert.equal(agentRow.children[1].children[0].writes, 0, "the card's markup is not rewritten, so nothing restarts");
assert.ok(syncAgentStats(agentRow, grew, docStub), "a second unchanged pass still matches");
assert.equal(agentRow.children[1].children[0].children[1].textContent, "999 · 1m 30s", "unchanged stats keep their text");
assert.equal(syncAgentStats(agentRow, [...grew, { role: "live-tester", run: null, alive: false, status: "ok", handle: "t.live-tester", tokens: null, duration: null }], docStub), false, "a run added rebuilds");
assert.equal(syncAgentStats(agentRow, grew.slice(1), docStub), false, "a run gone rebuilds");
assert.equal(syncAgentStats(agentRow, grew.map((a) => (a.alive ? { ...a, alive: false, status: "ok" } : a)), docStub), false, "live -> dead rebuilds");
assert.equal(syncAgentStats(new El("div"), grew, docStub), false, "a missing row rebuilds");
// a card whose stats were empty carries no span; the span joins when stats arrive and drops when
// they vanish, the markup agentCardHtml renders
const bare = runRow([{ role: "developer", run: null, alive: true, status: "live", handle: "t.developer", tokens: null, duration: null }]);
assert.equal(bare.children[0].children[0].children.length, 1, "empty stats render no span");
assert.ok(syncAgentStats(bare, [{ role: "developer", run: null, alive: true, status: "live", handle: "t.developer", tokens: 999, duration: 1200 }], docStub), "the unchanged run set still updates in place");
assert.equal(bare.children[0].children[0].children[1].textContent, "999 · 1s", "the span joins the card when stats arrive");
assert.ok(syncAgentStats(bare, [{ role: "developer", run: null, alive: true, status: "live", handle: "t.developer", tokens: null, duration: null }], docStub), "the unchanged run set still updates in place");
assert.equal(bare.children[0].children[0].children.length, 1, "the span drops when the stats vanish");
// 000230 the doctor cards slot into their analysed run's column, matched by handle: a doctor
// entry's handle is the parent run's handle plus the .doctor suffix; unmatched cards (run log
// rotated away) keep the residual #m-doctor row. syncStatsLine moves one card's stats line in
// place, the markup agentCardHtml renders, shared by syncAgentStats and the doctor keep pass
const doctorCardEl = (d: any) => {
	const card = new El("button");
	card.className = "agent-card agent-doctor " + (d.alive ? "agent-live" : "agent-past");
	card.dataset.handle = d.handle;
	const mark = new El("span");
	mark.className = d.alive ? "spin" : "check";
	card.appendChild(mark);
	const stats = agentStatsText(d.tokens, d.duration);
	if (stats) { const s = new El("span"); s.className = "agent-stats"; s.textContent = stats; card.appendChild(s); }
	return card;
};
const mkDoc = (handle: string, alive: boolean, tokens: number | null, duration: number | null) =>
	({ role: "doctor", run: 0, alive, status: alive ? "live" : "ok", handle, tokens, duration });
const slotRow = runRow([
	{ role: "developer", run: 0, alive: false, status: "ok", handle: "t.developer.0", tokens: null, duration: null },
	{ role: "reviewer", run: 1, alive: false, status: "ok", handle: "t.reviewer.1", tokens: null, duration: null },
]);
assert.equal(doctorCol(slotRow, "t.developer.0.doctor"), slotRow.children[0], "the doctor handle strips the .doctor suffix and matches the analysed run's column");
assert.equal(doctorCol(slotRow, "t.developer.9.doctor"), null, "no run column carries the handle (run log rotated away), the card falls back to the residual row");
const residual = new El("div");
const doctorDocs = [mkDoc("t.developer.0.doctor", false, 20, 5000), mkDoc("t.missing.0.doctor", true, 30, 60000)];
const doctorCards = doctorDocs.map((d) => {
	const card = doctorCardEl(d);
	(doctorCol(slotRow, d.handle) ?? residual).appendChild(card);
	return card;
});
residual.__sig = agentRowSig(doctorDocs);
const docSpin = doctorCards[1].children[0];
assert.ok(docSpin.className === "spin", "the live doctor card carries its spinner");
assert.equal(doctorCards[0].parentElement, slotRow.children[0], "the matched card slots into its analysed run's column");
assert.equal(doctorCards[1].parentElement, residual, "the unmatched card stays in the residual row");
const doctorGrew = [mkDoc("t.developer.0.doctor", false, 30, 9000), mkDoc("t.missing.0.doctor", true, 40, 90000)];
residual.__sig = agentRowSig(doctorGrew);
assert.ok(syncDoctorCards(doctorCards, doctorGrew, slotRow, residual, docStub), "an unchanged doctor set updates the cards in place");
assert.equal(doctorCards[1].children[0], docSpin, "the same .spin node keeps its animation running");
assert.equal(doctorCards[1].children[1].textContent, "40 · 1m 30s", "the live doctor card's stats line moved");
assert.equal(doctorCards[0].children[1].textContent, "30 · 9s", "the past doctor card's stats line moved too");
assert.equal(doctorCards[1].children[0].children.length, 0, "no stray span lands inside the mark span");
assert.equal(syncDoctorCards(doctorCards, doctorGrew.slice(1), slotRow, residual, docStub), false, "a doctor card gone rebuilds");
assert.equal(syncDoctorCards(doctorCards, [...doctorGrew, mkDoc("t.developer.9.doctor", false, 1, 1)], slotRow, residual, docStub), false, "a doctor card added rebuilds");
const rebuiltRow = runRow([
	{ role: "developer", run: 0, alive: false, status: "ok", handle: "t.developer.0", tokens: null, duration: null },
	{ role: "reviewer", run: 1, alive: false, status: "ok", handle: "t.reviewer.1", tokens: null, duration: null },
]);
assert.equal(syncDoctorCards(doctorCards, doctorGrew, rebuiltRow, residual, docStub), false, "a run-row rebuild detaches the slotted cards, the keep pass rebuilds and re-slots");
residual.__sig = agentRowSig(doctorGrew.map((d) => (d.alive ? { ...d, alive: false, status: "ok" } : d)));
assert.equal(syncDoctorCards(doctorCards, doctorGrew, slotRow, residual, docStub), false, "live -> dead flips the signature, the rebuild swaps the spinner for the check");
const lone = doctorCardEl(mkDoc("t.developer.0.doctor", false, null, null));
assert.equal(lone.children.length, 1, "empty stats render no span");
syncStatsLine(lone, 999, 1200, docStub);
assert.equal(lone.children[1].textContent, "999 · 1s", "the span joins the card when stats arrive");
syncStatsLine(lone, null, null, docStub);
assert.equal(lone.children.length, 1, "the span drops when the stats vanish");
// the page wires the helpers: the rebuild seeds the signature, the keep pass syncs the stats
assert.ok(ra.includes("if (keep && syncAgentStats(el, runs, document))"), "the keep pass updates an unchanged row's stats in place");
assert.ok(ra.includes("el.__sig = agentRowSig(runs)"), "the rebuild seeds the structure signature the keep pass matches");
assert.ok(ra.includes('el.__sig = "";'), "an empty run set clears the signature");
assert.ok(page.includes(String(agentRowSig)) && page.includes(String(syncAgentStats)), "the page runs the tested agent-row helpers");
assert.ok(page.includes(String(syncStatsLine)) && page.includes(String(doctorCol)) && page.includes(String(syncDoctorCards)), "the page runs the tested doctor-slot helpers");
assert.ok(page.includes('for (const b of document.querySelectorAll("#m-agent .agent-card"))'), "markActiveAgent's #m-agent scope still hits the in-column doctor cards");
// 000237 the detail card's relation lines: an SVG layer inside #m-agent (relative, fenced at
// z-index 0 so the sticky #m-head keeps covering the scrolled area) draws the run chain
// right-out/left-in with the board curve and drops a line from each run card's bottom edge into
// every sub and doctor card's left side, dimmed at rest, raised on hover and while selected
const boardPathCss = page.match(/#relations path \{[^}]*\}/)![0];
assert.ok(page.includes('<div id="m-agent"><svg id="agent-relations"></svg><div id="m-agent-btns"></div>'), "the relation SVG ships as #m-agent's first child, before the cards");
assert.ok(page.includes("#m-agent { position: relative; z-index: 0; margin-bottom: 12px; }"), "#m-agent is the SVG's offset parent and its own stacking context, so the z-index-2 cards stay under the sticky #m-head");
const relSvgCss = page.match(/#agent-relations \{[^}]*\}/)![0];
assert.ok(relSvgCss.includes("pointer-events: none") && relSvgCss.includes("z-index: 1"), "the relation SVG never intercepts card clicks and paints below the cards");
const relPathCss = page.match(/#agent-relations path \{ fill[^}]*\}/)![0];
assert.ok(relPathCss.replace("#agent-relations", "#relations") === boardPathCss, "the detail card's path style mirrors the board's #relations path exactly");
assert.ok(page.includes("#agent-relations path.relations-hot, #agent-relations path.relations-sel { stroke-opacity: .8; }"), "hover and selection raise a connected line to the board's hot opacity");
assert.ok(page.includes("#relations path, #agent-relations path { animation: none; }"), "reduced motion stops the dashflow on the detail card's lines too");
assert.ok(agentCardCss.includes("position: relative") && agentCardCss.includes("z-index: 2"), "the agent cards stack at z-index 2 above the lines, like the board's cards");
const drawFn = page.match(/function drawAgentRelations\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(drawFn.includes("curve("), "the run chain reuses the board curve geometry");
assert.ok(drawFn.includes('.replace(/\\.doctor$/, "")'), "a doctor card matches its analysed run by stripping the trailing .doctor (the #230 rule)");
assert.ok(drawFn.includes("if (svg.__html !== html)"), "the rewrite is html-gated, so the dash animation survives a refresh that changes nothing");
assert.ok(drawFn.includes("if (hoverHandle) hotAgentRelations(hoverHandle, true)"), "a rewrite re-applies the hover highlight, so a redraw landing mid-hover does not kill it");
assert.ok(page.includes("hoverHandle = on ? handle : null;"), "the hover helper tracks the hovered handle for the rewrite re-apply");
assert.ok(openTaskSrc.indexOf('classList.remove("hidden")') < openTaskSrc.indexOf("drawAgentRelations()"), "the open draw runs after the un-hide: rects read zero while the modal is display: none");
assert.ok(openTaskSrc.includes("onanimationend"), "the entrance transform skews the first measure, the settled box redraws once");
assert.ok(upd.includes("drawAgentRelations()"), "the poll refresh redraws the lines");
assert.ok(page.includes("markActiveAgent();\n\t\tdrawAgentRelations();"), "sub fetches landing redraw the lines");
assert.ok(page.includes('window.addEventListener("resize", drawAgentRelations);'), "a window resize redraws the lines");
assert.equal([...page.matchAll(/b\.onmouseenter = \(\) => hotAgentRelations\(b\.dataset\.handle, true\);/g)].length, 3, "run, sub and doctor cards all bind the hover raise, mouseleave reverts");
assert.ok(page.includes('for (const path of document.querySelectorAll("#agent-relations path"))'), "markActiveAgent also toggles the selection highlight on the connected lines");
// 000237/000238 run against the served source: the drop leaves the run card's bottom edge heading
// down and enters the sub or doctor card's left side heading right; the horizontal run-in scales
// with the span and clamps to the space left of the card, so a flush card keeps the short hook
const relDrop = new Function(page.match(/function dropCurve\(from, to\) \{[\s\S]*?\n\}/)![0] + "; return dropCurve;")();
const dropPath = relDrop({ x: 0, y: 0, w: 200, h: 40 }, { x: 0, y: 44, w: 200, h: 30 });
assert.ok(dropPath.startsWith("M 100 40 C"), "the drop leaves the run card's bottom edge at its center");
assert.ok(dropPath.endsWith(", 0 59"), "the drop enters the sub card's left side at its vertical middle");
const dropSeg = dropPath.match(/C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/)!;
assert.ok(Number(dropSeg[1]) === 100 && Number(dropSeg[2]) > 40, "the departure control sits below the bottom edge, so the line heads down");
assert.ok(Number(dropSeg[3]) < 0 && Number(dropSeg[4]) === 59, "the arrival control sits left of the left edge at the same y, so the line heads right into the card; a flush card keeps the short 8px hook");
assert.equal(relDrop({ x: 0, y: 0, w: 200, h: 40 }, { x: 300, y: 44, w: 200, h: 30 }), "M 100 40 C 100 49.5, 240 59, 300 59", "a card with space to its left gets a run-in scaled from the span, capped at 60px");
assert.equal(relDrop({ x: 0, y: 0, w: 200, h: 40 }, { x: 20, y: 44, w: 200, h: 30 }), "M 100 40 C 100 49.5, 0 59, 20 59", "the run-in clamps to the space left of the card, so no length hides past the canvas edge");
// 000237 run the served draw against a stub agent area: two run columns with run 2 wrapped below
// run 1, two subs under run 1, one doctor card in the residual #m-doctor row. The wrap must not
// break the chain: curve spans any x/y pair, so the line still connects the wrapped pair
class RelEl {
	className = "";
	dataset: Record<string, string> = {};
	children: RelEl[] = [];
	parentElement: RelEl | null = null;
	scrollLeft = 0;
	scrollTop = 0;
	innerHTML = "";
	__html: string | undefined;
	rect: { left: number; top: number; width: number; height: number };
	constructor(rect: { left: number; top: number; width: number; height: number }) { this.rect = rect; }
	classList = {
		contains: (cls: string) => this.className.split(" ").includes(cls),
		toggle: (cls: string, on: boolean) => { this.className = on ? (this.className ? this.className + " " + cls : cls) : this.className.split(" ").filter((c) => c !== cls).join(" "); },
	};
	querySelector(sel: string): RelEl | null { return this.children.find((c) => c.className.split(" ").includes(sel.replace(".", ""))) ?? null; }
	querySelectorAll(sel: string): RelEl[] { return sel === ".agent-card" ? this.children.filter((c) => c.classList.contains("agent-card")) : []; }
	getBoundingClientRect() { return { left: this.rect.left, top: this.rect.top, width: this.rect.width, height: this.rect.height }; }
}
const relHost = new RelEl({ left: 0, top: 0, width: 760, height: 400 });
const relSvg = new RelEl({ left: 0, top: 0, width: 760, height: 400 });
const relModal = new RelEl({ left: 0, top: 0, width: 800, height: 600 });
const relRun1 = new RelEl({ left: 0, top: 0, width: 200, height: 40 });
relRun1.dataset.handle = "t.dev.0";
const relSubs1 = new RelEl({ left: 0, top: 0, width: 200, height: 68 });
relSubs1.className = "agent-subs";
const relSub1 = new RelEl({ left: 0, top: 44, width: 200, height: 30 });
const relSub2 = new RelEl({ left: 0, top: 78, width: 200, height: 30 });
for (const s of [relSub1, relSub2]) { s.dataset.handle = "t.dev.0"; s.className = "agent-card agent-sub"; s.parentElement = relSubs1; relSubs1.children.push(s); }
const relCol1 = new RelEl({ left: 0, top: 0, width: 200, height: 108 });
relCol1.children = [relRun1, relSubs1];
relRun1.parentElement = relCol1;
const relRun2 = new RelEl({ left: 0, top: 150, width: 200, height: 40 });
relRun2.dataset.handle = "t.rev.1";
const relCol2 = new RelEl({ left: 0, top: 150, width: 200, height: 40 });
relCol2.children = [relRun2];
relRun2.parentElement = relCol2;
const relDoctor = new RelEl({ left: 0, top: 200, width: 200, height: 30 });
relDoctor.dataset.handle = "t.dev.0.doctor";
relDoctor.className = "agent-card agent-doctor agent-past";
const relDoc = {
	getElementById: (id: string) => ({ "m-agent": relHost, "agent-relations": relSvg, "modal": relModal } as Record<string, RelEl>)[id] ?? null,
	querySelectorAll: (sel: string): RelEl[] => sel.includes(":not(.agent-doctor)") ? [relRun1, relRun2] : sel.includes(".agent-doctor") ? [relDoctor] : [],
};
let relMarks = 0;
let relHotApply: string | null = null;
const relDraw = new Function("document", "curve", "esc", "markActiveAgent", "dropCurve", "hotAgentRelations", "hoverHandle", page.match(/function drawAgentRelations\(\) \{[\s\S]*?\n\}/)![0] + "; return drawAgentRelations;")(relDoc, curve, esc, () => { relMarks++; }, relDrop, (h: string | null) => { relHotApply = h; }, "t.dev.0");
relDraw();
assert.equal(relHotApply, "t.dev.0", "the rewrite re-applies the hovered handle's highlight");
const drawn = relSvg.innerHTML.match(/<path [^>]*\/>/g) ?? [];
assert.equal(drawn.length, 4, "two wrapped runs, two subs and one doctor draw four lines");
assert.ok(drawn[0].includes('data-from="t.dev.0"') && drawn[0].includes('data-to="t.rev.1"'), "the chain path carries both run handles");
const chainSeg = drawn[0].match(/d="M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)"/)!;
assert.ok(chainSeg[1] === "200" && chainSeg[2] === "20", "the chain leaves the first run card's right edge");
assert.ok(chainSeg[7] === "0" && chainSeg[8] === "170", "the chain enters the wrapped run card's left edge: the wrap does not break the pair");
assert.ok(drawn[1].includes('data-from="t.dev.0"') && drawn[1].includes('data-to="t.dev.0"') && drawn[1].includes('d="M 100 40 C 100 49.5, -8 59, 0 59"'), "a sub's drop line runs from its run card's bottom edge into its left side");
assert.ok(drawn[3].includes('data-to="t.dev.0.doctor"') && drawn[3].includes('d="M 100 40 C 100 100, -8 215, 0 215"'), "a doctor card in the residual row still drops from its analysed run's card");
relHotApply = null;
relDraw();
assert.equal(relMarks, 1, "the rewrite is html-gated: an unchanged redraw neither rewrites nor re-runs markActiveAgent");
assert.equal(relHotApply, null, "an unchanged redraw re-applies no hover");
relHotApply = null;
relRun2.rect = { left: 0, top: 160, width: 200, height: 40 };
relDraw();
assert.ok(relSvg.innerHTML !== drawn.join("") && relMarks === 2, "a layout change rewrites the lines and re-applies the selection");
assert.equal(relHotApply, "t.dev.0", "a layout change re-applies the hovered handle's highlight");
const htmlHidden = relSvg.innerHTML;
relModal.className = "hidden";
relDraw();
assert.equal(relSvg.innerHTML, htmlHidden, "a draw with the modal hidden bails before measuring display: none rects");
relModal.className = "";
// 000237 hover: the hot function toggles only the paths the hovered card connects to
const hotPath1 = new RelEl({ left: 0, top: 0, width: 0, height: 0 });
hotPath1.dataset.from = "t.dev.0";
hotPath1.dataset.to = "t.rev.1";
const hotPath2 = new RelEl({ left: 0, top: 0, width: 0, height: 0 });
hotPath2.dataset.from = "t.rev.1";
hotPath2.dataset.to = "t.rev.1.doctor";
const hotDoc = { querySelectorAll: (sel: string): RelEl[] => sel.includes("path") ? [hotPath1, hotPath2] : [] };
const relHot = new Function("document", page.match(/function hotAgentRelations\(handle, on\) \{[\s\S]*?\n\}/)![0] + "; return hotAgentRelations;")(hotDoc);
relHot("t.dev.0", true);
assert.ok(hotPath1.classList.contains("relations-hot") && !hotPath2.classList.contains("relations-hot"), "hovering a run card raises its connected lines only");
relHot("t.dev.0", false);
assert.ok(!hotPath1.classList.contains("relations-hot"), "mouseleave reverts the raise");
relHot("t.rev.1.doctor", true);
assert.ok(hotPath2.classList.contains("relations-hot"), "a doctor card's handle matches its drop line");
// 000237 selection: the selected card's connected lines carry .relations-sel while its log is
// open, a sub view selects through the parent's handle, closing the log clears them
const selRun = new RelEl({ left: 0, top: 0, width: 0, height: 0 });
selRun.dataset.handle = "t.dev.0";
const selSub = new RelEl({ left: 0, top: 0, width: 0, height: 0 });
selSub.dataset.handle = "t.dev.0";
selSub.dataset.sub = "2";
const selPath1 = new RelEl({ left: 0, top: 0, width: 0, height: 0 });
selPath1.dataset.from = "t.dev.0";
selPath1.dataset.to = "t.rev.1";
const selPath2 = new RelEl({ left: 0, top: 0, width: 0, height: 0 });
selPath2.dataset.from = "t.other.0";
selPath2.dataset.to = "t.other.1";
const selPane = new RelEl({ left: 0, top: 0, width: 0, height: 0 });
const selDoc = { querySelectorAll: (sel: string): RelEl[] => sel.includes(".agent-card") ? [selRun, selSub] : [selPath1, selPath2] };
const markSel = new Function("logPane", "logState", "document", page.match(/function markActiveAgent\(\) \{[\s\S]*?\n\}/)![0] + "; return markActiveAgent;")(() => selPane, { handle: "t.dev.0", sub: null }, selDoc);
markSel();
assert.ok(selRun.classList.contains("agent-card-active"), "the open run's card is active");
assert.ok(selPath1.className.includes("relations-sel") && !selPath2.className.includes("relations-sel"), "the selected card's connected lines highlight, unconnected ones stay dim");
const markSubSel = new Function("logPane", "logState", "document", page.match(/function markActiveAgent\(\) \{[\s\S]*?\n\}/)![0] + "; return markActiveAgent;")(() => selPane, { handle: "t.dev.0", sub: "2" }, selDoc);
markSubSel();
assert.ok(selSub.classList.contains("agent-card-active") && selPath1.className.includes("relations-sel"), "a sub view selects through the parent run's handle, its run's lines stay lit");
const markNone = new Function("logPane", "logState", "document", page.match(/function markActiveAgent\(\) \{[\s\S]*?\n\}/)![0] + "; return markActiveAgent;")(() => selPane, null, selDoc);
markNone();
assert.ok(!selRun.classList.contains("agent-card-active") && !selPath1.className.includes("relations-sel"), "closing the log clears the active card and the line highlight");
// the cadence: 1 s while the open task has a live agent, 5 s otherwise, log pane open or closed
assert.equal(refreshMs({ agents: [{ alive: true }] }), 1000, "a live agent on the open card ticks the poll at 1 s");
assert.equal(refreshMs({ agents: [{ alive: false }], doctors: [{ alive: true }] }), 1000, "a live doctor with no live agent also ticks the poll at 1 s");
assert.equal(refreshMs({ agents: [{ alive: false }], doctors: [{ alive: false }] }), 5000, "no live agent and no live doctor keeps the 5 s cadence");
assert.equal(refreshMs({ agents: [{ alive: false }] }), 5000, "no live agent keeps the 5 s cadence");
assert.equal(refreshMs({ agents: [] }), 5000, "an empty agent history keeps the 5 s cadence");
assert.equal(refreshMs({}), 5000, "a task without agents keeps the 5 s cadence");
assert.equal(refreshMs(null), 5000, "a closed modal keeps the 5 s cadence");
assert.ok(page.includes(String(refreshMs)), "the page runs the tested cadence helper");

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
const payload = await import(pathToFileURL(process.env.HERE + "/../src/webui/payload.ts").href);
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
writeFileSync(orderPreload, `
const fs = require("node:fs");
const orig = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
	if (String(p).includes(".doctor")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	return orig.apply(this, [p, ...rest]);
};
`);
const orderCode = `
import { pathToFileURL } from "node:url";
const hub = (await import(pathToFileURL(process.env.HERE + "/../src/hub.ts").href)).startHub;
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

// a second hub on the taken port reports failure instead of throwing
assert.equal(await startHub({ name: "webui-test", root, host: "localhost", port: ui.port }), null);
ui.close();
process.env.HOME = realHome;

// daemon wiring: HOME at a config with webUi enabled and port 0 -> OS picks, URL logged
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
writeFileSync(join(home, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, port: 0 } }));
daemon = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", root], {
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
// 000215: the neutral config dir wins over the legacy pi path; the project file overrides both
const neutralHome = join(home, ".config", "se-llm-team");
mkdirSync(neutralHome, { recursive: true });
writeFileSync(join(neutralHome, "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "neutral-host" } }));
assert.equal(loadWebUiConfig(root).host, "neutral-host", "the neutral config is read when present");
rmSync(join(neutralHome, "se-llm-team.json"));
assert.equal(loadWebUiConfig(root).enabled, true, "the legacy config is read when the neutral file is absent");
writeFileSync(join(root, ".kanban", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "project-host" } }));
assert.equal(loadWebUiConfig(root).host, "project-host", "the project file overrides the legacy global");
writeFileSync(join(neutralHome, "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "neutral-host" } }));
assert.equal(loadWebUiConfig(root).host, "project-host", "the project file overrides the neutral global too");
process.env.HOME = realHome;

// 000245 the visible subset and the done cache, in-process over taskPayload: the five cards each
// column renders before "show more" carry the same agent history the detail serves, a card behind
// it carries none; done tasks' stats come from the cache and invalidate when the state leaves done
const statsRoot = mkdtempSync(join(tmpdir(), "webui-stats-"));
mkdirSync(join(statsRoot, ".kanban", ".logs"), { recursive: true });
const statsTasks = Array.from({ length: 6 }, (_, i) => createTask(statsRoot, { name: `feat: stats ${i}`, summary: "s" }));
statsTasks.forEach((t) => setState(statsRoot, t, "reviewing"));
const statsBase = Date.now() / 1000;
statsTasks.forEach((t, i) => utimesSync(join(statsRoot, ".kanban", t.file), statsBase + i, statsBase + i));
const statsRows = (await taskPayload(statsRoot)).filter((r: any) => r.name.startsWith("feat: stats"));
assert.equal(statsRows.length, 6);
for (const r of statsRows)
	assert.equal("agents" in r, r.num !== parseInt(statsTasks[0].file, 10), "the five visible rows carry the stat data, a card behind show more carries none");
const loggedSlug = statsTasks[1].file.replace(/\.md$/, "");
writeFileSync(join(statsRoot, ".kanban", ".logs", `${loggedSlug}.developer.log`), [
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 200, output: 100 } }, timestamp: Date.now() - 2000 }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 300, output: 200 } }, timestamp: Date.now() - 1000 }),
].join("\n") + "\n");
const loggedRow = (await taskPayload(statsRoot)).find((r: any) => r.file === statsTasks[1].file)!;
assert.equal(loggedRow.agents[0].tokens, 800, "a visible card's row sums the run's usage like the detail's history");
assert.deepEqual(loggedRow.agents, (await taskHistory(statsRoot, loggedRow.num))!.agents, "the row carries the same agent history the detail's history serves");

// the done cache: a done task's stats serve from the cache (a rewritten plain log stays stale) and
// leaving done invalidates it, so a re-done task re-caches fresh
const doneRoot = mkdtempSync(join(tmpdir(), "webui-done-"));
mkdirSync(join(doneRoot, ".kanban", ".logs"), { recursive: true });
const doneTask = createTask(doneRoot, { name: "feat: done stats", summary: "s" });
const doneSlug = doneTask.file.replace(/\.md$/, "");
const doneLog = join(doneRoot, ".kanban", ".logs", `${doneSlug}.developer.log`);
const writeDoneLog = (tokens: number) =>
	writeFileSync(doneLog, JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: tokens, output: 0 } }, timestamp: new Date().toISOString() }) + "\n");
const doneRow = () => taskPayload(doneRoot).then((rows: any[]) => rows.find((r: any) => r.file === doneTask.file)!);
setState(doneRoot, doneTask, "done");
writeDoneLog(300);
assert.equal((await doneRow()).agents[0].tokens, 300, "a done card's row carries the run's stats");
writeDoneLog(1500);
assert.equal((await doneRow()).agents[0].tokens, 300, "a done card's stats come from the cache, a rewritten plain log stays stale");
setState(doneRoot, doneTask, "to-do");
assert.equal((await doneRow()).agents[0].tokens, 1500, "leaving done invalidates the cache, the fresh stats serve");
setState(doneRoot, doneTask, "done");
assert.equal((await doneRow()).agents[0].tokens, 1500, "a re-done task re-caches fresh, the pre-done entry never returns");
writeDoneLog(20000);
assert.equal((await doneRow()).agents[0].tokens, 1500, "the re-cached entry is stale again until the next leave-done");

cleanup();
console.log("webui.test.ts: all assertions passed");
