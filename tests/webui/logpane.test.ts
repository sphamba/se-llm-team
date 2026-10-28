import assert from "node:assert/strict";
import { logFixups, md, renderLogChunk } from "../../src/webui.ts";
// not re-exported by the webui barrel: the role constants live in the logpane module
import { AGENT_ROLE, LOG_ROLES } from "../../src/webui/logpane.ts";

// minimal element stub for the log-pane fixups: only the DOM surface logFixups touches
class LogEl {
	tag: string;
	className = "";
	textContent = "";
	innerHTML = "";
	style: Record<string, string> = {};
	dataset: Record<string, string> = {};
	children: LogEl[] = [];
	parent: LogEl | null = null;
	classList = { contains: (cls: string) => this.className.split(/\s+/).includes(cls) };
	constructor(tag: string) { this.tag = tag; }
	get tagName(): string { return this.tag.toUpperCase(); }
	sibling(step: number): LogEl | null {
		const p = this.parent;
		return p ? p.children[p.children.indexOf(this) + step] ?? null : null;
	}
	get previousElementSibling(): LogEl | null { return this.sibling(-1); }
	get nextElementSibling(): LogEl | null { return this.sibling(1); }
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

// #291 GFM pipe tables: a header row plus a |---| separator row renders as a wrapper > table with
// a pinned first column, per-column alignment from the separator colons and ragged rows
// normalized to the header count; cell text goes through inline() after esc()
assert.equal(
	md("| a | b |\n| --- | --- |\n| 1 | 2 |"),
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin">a</th><th>b</th></tr></thead><tbody><tr><td class="md-pin">1</td><td>2</td></tr></tbody></table></div>',
	"a GFM pipe table renders as a wrapper > table with thead/tbody and a pinned first column",
);
assert.equal(
	md("| l | c | r |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |"),
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin">l</th><th style="text-align:center">c</th><th style="text-align:right">r</th></tr></thead><tbody><tr><td class="md-pin">1</td><td style="text-align:center">2</td><td style="text-align:right">3</td></tr></tbody></table></div>',
	"the separator colons set per-column alignment: bare is left, :--: center, --: right",
);
assert.equal(
	md("| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |"),
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin">a</th><th>b</th><th>c</th></tr></thead><tbody><tr><td class="md-pin">1</td><td></td><td></td></tr><tr><td class="md-pin">1</td><td>2</td><td>3</td></tr></tbody></table></div>',
	"a short row pads with empty cells and a long row clips to the header count",
);
assert.equal(
	md("| a | b |\n| c | d |"),
	"<p>| a | b |</p><p>| c | d |</p>",
	"a block of pipe lines without a separator row stays paragraphs",
);
assert.equal(
	md("| **b** | `c` | [l](u) |\n| --- | --- | --- |"),
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin"><b>b</b></th><th><code>c</code></th><th><a href="u" target="_blank" rel="noopener">l</a></th></tr></thead><tbody></tbody></table></div>',
	"cell content renders through inline(): bold, code and links work inside a cell",
);
assert.equal(
	md("| a<b | c&d |\n| --- | --- |\n| \"q\" | 'x' |"),
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin">a&lt;b</th><th>c&amp;d</th></tr></thead><tbody><tr><td class="md-pin">&quot;q&quot;</td><td>&#39;x&#39;</td></tr></tbody></table></div>',
	"HTML metacharacters in a cell are escaped before inline() applies markup",
);
assert.equal(
	md("| a \\| b | c |\n| --- | --- |"),
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin">a | b</th><th>c</th></tr></thead><tbody></tbody></table></div>',
	"an escaped pipe stays inside its cell instead of splitting the row",
);
assert.equal(
	md("```\n| a | b |\n| --- | --- |\n```"),
	"<pre><code>| a | b |\n| --- | --- |\n</code></pre>",
	"a table inside a fenced block stays pre/code, never a rendered table",
);

// #310 blockquotes: consecutive `> ` lines form one blockquote rendered through inline(), a lone
// `>` separates paragraphs inside that blockquote, a blank line closes it, and a `>` inside a fence
// stays literal text
assert.equal(
	md("> Covered summary"),
	"<blockquote><p>Covered summary</p></blockquote>",
	"a quoted line renders as one blockquote paragraph, never a paragraph of literal &gt; text",
);
assert.equal(
	md("> one\n>\n> two"),
	"<blockquote><p>one</p><p>two</p></blockquote>",
	"a lone > separates paragraphs inside one blockquote instead of emitting an empty p",
);
assert.equal(
	md("> use `x` here"),
	"<blockquote><p>use <code>x</code> here</p></blockquote>",
	"inline code inside a quote renders a code element inside the blockquote",
);
assert.equal(
	md("> **bold** [l](u)"),
	'<blockquote><p><b>bold</b> <a href="u" target="_blank" rel="noopener">l</a></p></blockquote>',
	"bold and links inside a quote render through inline()",
);
assert.equal(
	md("```\n> not a quote\n```"),
	"<pre><code>&gt; not a quote\n</code></pre>",
	"a > inside a fenced block stays literal text",
);
assert.equal(
	md("> quote\n\nafter the quote"),
	"<blockquote><p>quote</p></blockquote><p>after the quote</p>",
	"a blank line after the quote closes it, so the next line is a normal paragraph",
);
assert.equal(
	md("- a\n> q"),
	"<ul><li>a</li></ul><blockquote><p>q</p></blockquote>",
	"a quote closes the open list first",
);

// #299 open-table merge, server half: a table whose row run reaches the end of the input is
// marked open, so the client can absorb the rows a later chunk appends to it; any content after
// the table closes it, and a chunk that ends mid-line splits that line off and drops the marker
assert.equal(
	md("| a | b |\n| --- | --- |\n| 1 | 2 |"),
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin">a</th><th>b</th></tr></thead><tbody><tr><td class="md-pin">1</td><td>2</td></tr></tbody></table></div>',
	"a table that runs to the end of the input stays open",
);
assert.ok(!md("| a | b |\n| --- | --- |\n| 1 | 2 |\nafter the table").includes("data-open"), "a paragraph after the table closes it");
assert.ok(!md("| a | b |\n| --- | --- |\n| 1 | 2 |\n```\nfence\n```").includes("data-open"), "a fence after the table closes it too");
assert.ok(!md("```\n| a | b |\n| --- | --- |\n```").includes("data-open"), "a table inside a fence never opens");
const tableDelta = (t: string) => JSON.stringify({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: t } });
const wholeTable = renderLogChunk(tableDelta("| a | b |\n| --- | --- |\n| 1 | 2 |\n") + "\n");
assert.ok(wholeTable.includes('data-open="tbl"'), "a chunk whose line closed keeps the table open for the next chunk's rows");
const cutTable = renderLogChunk(tableDelta("| a | b |\n| --- | --- |\n| 1 | 2 |\n") + "\n" + tableDelta("| 3 | 4") + "\n");
assert.ok(cutTable.includes('<tbody><tr><td class="md-pin">1</td><td>2</td></tr></tbody>'), "the table ends at its last complete row");
assert.ok(!cutTable.includes("data-open"), "a trailing line with no newline leaves md()'s input, so the table takes no open marker");
assert.ok(cutTable.endsWith("<p>| 3 | 4</p>"), "the trailing run renders as its own paragraph");

// #299 open-table merge, client half: a table marked open absorbs the row paragraphs that follow
// it into its tbody, on the head's column count and alignment, and the pane scan covers both
// insert orders; a non-row sibling stops the absorb and closes the table, while a run that
// absorbs its last sibling leaves it open for the next poll's rows
const logTable = (cols: string[][]) => {
	const wrap = new LogEl("div");
	wrap.className = "md-table-wrap";
	wrap.dataset.open = "tbl";
	const table = new LogEl("table");
	const headRow = new LogEl("tr");
	const thead = new LogEl("thead");
	for (const [text, align] of cols) {
		const th = new LogEl("th");
		th.textContent = text;
		th.style.textAlign = align;
		headRow.appendChild(th);
	}
	thead.appendChild(headRow);
	const tbody = new LogEl("tbody");
	table.append(thead, tbody);
	wrap.appendChild(table);
	return { wrap, tbody };
};
const logRow = (html: string) => {
	const p = new LogEl("p");
	p.innerHTML = html;
	p.textContent = html;
	return p;
};
const cols = [["a", ""], ["b", "center"], ["c", "right"]];
const closedPane = new LogEl("div");
const closedTable = logTable(cols);
closedPane.appendChild(closedTable.wrap);
closedPane.appendChild(logRow("| 1 | 2 |"));
closedPane.appendChild(logRow("| 3 |"));
closedPane.appendChild(logRow("| 1 | 2 | 3 | 4 |"));
closedPane.appendChild(logRow("after the table"));
logFixups(closedPane, logDoc);
assert.equal(closedTable.tbody.children.length, 3, "every pipe paragraph after the open table becomes a row");
assert.equal(
	closedTable.tbody.children[0].innerHTML,
	'<tr><td class="md-pin">1</td><td style="text-align:center">2</td><td style="text-align:right"></td></tr>',
	"a short row pads to the head's columns and copies each column's alignment",
);
assert.equal(
	closedTable.tbody.children[1].innerHTML,
	'<tr><td class="md-pin">3</td><td style="text-align:center"></td><td style="text-align:right"></td></tr>',
	"a one-cell row pads the rest empty",
);
assert.equal(
	closedTable.tbody.children[2].innerHTML,
	'<tr><td class="md-pin">1</td><td style="text-align:center">2</td><td style="text-align:right">3</td></tr>',
	"a long row clips to the head's column count",
);
assert.deepEqual(closedPane.children.map((c) => c.tag), ["div", "p"], "the absorbed paragraphs leave the pane, the non-row sibling stays");
assert.equal(closedPane.children[1].innerHTML, "after the table", "the non-row sibling is left untouched");
assert.ok(!("open" in closedTable.wrap.dataset), "a non-row sibling stops the absorb and clears the marker");
const openPane = new LogEl("div");
const openTable = logTable([["a", ""], ["b", ""]]);
openPane.appendChild(openTable.wrap);
openPane.appendChild(logRow("| 5 | 6 |"));
logFixups(openPane, logDoc);
assert.equal(openPane.children.length, 1);
assert.equal(openTable.tbody.children.length, 1, "the last sibling absorbs too");
assert.equal(openTable.wrap.dataset.open, "tbl", "a run that absorbs its last sibling keeps the table open for the next poll");
logFixups(openPane, logDoc);
assert.equal(openTable.tbody.children.length, 1, "a repeat pass over the same pane absorbs nothing twice");
const raggedPane = new LogEl("div");
const raggedTable = logTable([["a", ""], ["b", ""]]);
raggedPane.appendChild(raggedTable.wrap);
raggedPane.appendChild(logRow("| x \\| y | z |"));
logFixups(raggedPane, logDoc);
assert.equal(raggedTable.tbody.children[0].innerHTML, '<tr><td class="md-pin">x | y</td><td>z</td></tr>', "an escaped pipe stays inside its cell, like the server-side table split");
const escapedPane = new LogEl("div");
const escapedTable = logTable([["a", ""], ["b", ""]]);
escapedPane.appendChild(escapedTable.wrap);
escapedPane.appendChild(logRow("| <b>bold</b> | &lt;img&gt; |"));
logFixups(escapedPane, logDoc);
assert.equal(escapedTable.tbody.children[0].innerHTML, '<tr><td class="md-pin"><b>bold</b></td><td>&lt;img&gt;</td></tr>', "the cell html goes in as it renders, never escaped a second time");

// the role constants the payload builders read: a working state maps to its agent role, and
// LOG_ROLES (derived from the map's values) enumerates the per-task run logs
assert.equal(AGENT_ROLE["live-testing"], "live-tester", "the live-testing state maps to the live-tester role");
assert.ok(LOG_ROLES.includes("live-tester"), "the live-tester's per-task run logs are enumerated");
assert.equal(LOG_ROLES[LOG_ROLES.length - 1], "doctor", "the doctor analysis role stays last");
