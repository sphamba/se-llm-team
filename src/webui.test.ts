import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, getTask, PRIORITY_RANK, setState } from "./kanban.ts";
import { startHub } from "./hub.ts";
import { agentLabel, boardOf, buildShell, cardHtml, curve, flipDiff, fmtDur, fmtTokens, LAYOUT, loadWebUiConfig, LOG_CHUNK, mergeBoards, numLinkHtml, pairLayout, relationPaths, renderLogChunk, spinnerHtml, syncBoard, tabNames, tabsHtml } from "./webui.ts";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_NAMES = ["backlog", "to-do", "doing", "to-review", "reviewing", "to-live-test", "live-testing", "to-merge", "merging", "done"];

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
assert.ok(rendered.includes('<details class="lg-think" data-open="think"><summary>Thinking</summary><pre>Read the specs first.</pre></details>'), "the thinking block renders as a collapsed details with a Thinking summary, left open at the chunk end for the next chunk's deltas");
assert.ok(rendered.includes("Starting the run.\n"), "text delta renders as text");
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
assert.equal(renderLogChunk(mixed), "paragraph\n\nlegacy line\n", "a blank line flushes pending text and passes through");

// 000122 collapsible log blocks: thinking_end closes with the authoritative content, the tool
// summary one-liner caps at 80 chars on the first line only, and a tool end whose block lives in
// an earlier chunk renders the joinable span the client resolves
const closed = renderLogChunk([
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } }),
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reconstructed" } }),
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "authoritative thinking" } }),
].join("\n") + "\n");
assert.ok(closed.includes('<details class="lg-think"><summary>Thinking</summary><pre>authoritative thinking</pre></details>'), "thinking_end closes the block with the authoritative content");
assert.ok(!closed.includes("data-open"), "a closed thinking block carries no continuation marker");

const longCmd = "curl -s " + "x".repeat(120) + " \\\n  --header 'Accept: application/json'";
const toolChunk = renderLogChunk(JSON.stringify({ type: "tool_execution_start", toolCallId: "t2", toolName: "bash", args: { command: longCmd } }) + "\n");
const sum = toolChunk.match(/<summary>([^<]*)<\/summary>/)![1];
assert.ok(sum.startsWith("bash: curl -s ") && sum.length <= "bash: ".length + 80, "the tool summary one-liner caps at 80 chars");
assert.ok(!sum.includes("--header"), "the tool summary shows the first line of the command only");
assert.ok(toolChunk.includes("x".repeat(120)), "the full command stays in the block body");

const joinChunk = renderLogChunk(JSON.stringify({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: { content: [{ type: "text", text: "boom: exit 1" }] }, isError: true }) + "\n");
assert.ok(joinChunk.includes('<span class="lg-tres" data-tc="t1" data-sum="bash failed: boom: exit 1">boom: exit 1</span>'), "a tool end whose block lives in an earlier chunk renders the joinable span, errors carrying the summary text");

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
assert.ok(side.includes("Reading the diff.\n"), "sidechain text blocks render as message text");
assert.ok(side.includes('<span class="lg-tres" data-tc="t9">diff looks fine</span>'), "a sidechain toolResult without its toolcall renders the joinable result span");
assert.ok(side.includes('<details class="lg-think"><summary>Thinking</summary><pre>Plan the fix.</pre></details>'), "a sidechain thinking block renders as a collapsed details");
assert.equal(side.split("<summary>read: /r/SPECS.md</summary>").length - 1, 1, "one tool block per call: the toolcall args render once");
assert.ok(!side.includes('lg-tres" data-tc="t8'), "a sidechain toolResult dedupes against its toolcall within the chunk");
assert.ok(side.includes('<pre class="lg-out">specs</pre>'), "the sidechain toolResult fills its tool block");
assert.ok(!side.includes('"type"'), "sidechain records never leak raw JSON");
assert.ok(!renderLogChunk(sidechain + "partial-without-newline").includes("partial"), "a partial trailing sidechain record is dropped too");

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
assert.match(listed[0].body, /# Summary\nDashboard smoke/);

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

// 000134 webui reload: the hub references the webui functions through a dynamically imported
// module and re-imports it when the file's mtime changes, so a browser reload serves edited
// page and handler code without a daemon restart; the hub's own state (registry, heartbeats,
// election) stays in the running process, and hub.ts itself still needs a restart by design
const reloadHome = mkdtempSync(join(tmpdir(), "webui-reload-"));
writeFileSync(join(reloadHome, "package.json"), JSON.stringify({ type: "module" })); // the stub's dir needs an esm scope
const stubPath = join(reloadHome, "stub-webui.ts");
const stubPage = (marker: string) =>
	`export const PAGE = "<!doctype html><title>stub ${marker}</title>";\nexport const taskPayload = (root) => [];\nexport const agentLogPayload = (root, q) => null;\n`;
const touch = (file: string, seconds: number) => utimesSync(file, seconds, seconds);
writeFileSync(stubPath, stubPage("one"));
touch(stubPath, Date.now() / 1000 - 100);
const reloader = await startHub({ name: "webui-reload", root, host: "localhost", port: 0, webuiPath: stubPath });
assert.ok(reloader, "hub starts pointing at a stub webui module");
const reloadBase = `http://localhost:${reloader.port}`;
assert.ok((await (await fetch(`${reloadBase}/`)).text()).includes("stub one"), "the hub serves the stub webui page");
writeFileSync(stubPath, stubPage("two"));
touch(stubPath, Date.now() / 1000 - 95);
const reloaded = await (await fetch(`${reloadBase}/`)).text();
assert.ok(reloaded.includes("stub two"), "a browser reload serves the edited webui page without a daemon restart");
assert.ok(!reloaded.includes("stub one"), "the stale page is gone after the reload");
const kept = await (await fetch(`${reloadBase}/api/projects`)).json();
assert.equal(kept.length, 1, "the hub keeps serving after a reload and its registry entry survives");
assert.equal(kept[0].root, root);
assert.equal((await fetch(`${reloadBase}/api/tasks`)).status, 200, "the api keeps answering through the reloaded module");
reloader.close();
rmSync(reloadHome, { recursive: true, force: true });

// the real hub keeps serving after a webui reload too: an mtime bump (a branch switch bumps it)
// makes the loader re-import the real module graph with a fresh query, page and api stay up
const realWebui = fileURLToPath(new URL("./webui.ts", import.meta.url));
const was = statSync(realWebui).mtime;
utimesSync(realWebui, new Date(was.getTime() + 1000), new Date(was.getTime() + 1000));
assert.equal((await fetch(`${base}/`)).status, 200, "the hub keeps serving the real page after a webui reload");
assert.equal((await fetch(`${base}/api/tasks`)).status, 200, "the hub keeps serving the real api after a webui reload");
utimesSync(realWebui, was, was); // the mtime bump is test scaffolding, leave the file as it was

// GET / mentions all 10 state names; other paths and methods are 404
const pageRes = await fetch(`${base}/`);
assert.equal(pageRes.headers.get("cache-control"), "no-cache", "the page serves with a no-cache header so a browser reload re-fetches");
const page = await pageRes.text();
assert.doesNotThrow(() => new Function(page.match(/<script>([\s\S]*?)<\/script>/)![1]), "the served client script parses");
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

// 000047 stacked pairs: the eight middle states render as four .pair wrappers (to-do over doing,
// to-review over reviewing, to-live-test over live-testing, to-merge over merging), backlog and done
// stay single columns.
// El is a minimal element stub: buildShell and syncBoard only touch this DOM surface.
class El {
	tag: string;
	className = "";
	textContent = "";
	dataset: Record<string, string> = {};
	style: Record<string, string> = {};
	children: El[] = [];
	parent: El | null = null;
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
assert.deepEqual(boardEl.children.map((c) => c.className), ["col c-backlog", "pair", "pair", "pair", "pair", "col c-done"], "backlog and done stay single side columns, the eight middle states sit in four pairs");
assert.deepEqual(
	boardEl.children.slice(1, 5).map((p) => p.children.map((c) => c.className)),
	[["col c-to-do", "col c-doing"], ["col c-to-review", "col c-reviewing"], ["col c-to-live-test", "col c-live-testing"], ["col c-to-merge", "col c-merging"]],
	"to-do over doing, to-review over reviewing, to-live-test over live-testing, to-merge over merging",
);
assert.deepEqual(LAYOUT, ["backlog", ["to-do", "doing"], ["to-review", "reviewing"], ["to-live-test", "live-testing"], ["to-merge", "merging"], "done"], "the states between backlog and done pair up in pipeline order");
assert.deepEqual(pairLayout(STATE_NAMES), LAYOUT, "the pairs derive from the state list, with no state-specific wiring");
assert.ok(LAYOUT.every((part) => (typeof part === "string" ? cols[part] : part.every((st) => cols[st]))), "every layout state gets a column");
assert.ok(page.includes(JSON.stringify(LAYOUT)), "the page ships the tested layout");
assert.ok(page.includes(String(buildShell)) && page.includes(String(syncBoard)), "the page runs the tested shell and card pass");
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
assert.ok(cxCard.includes('<span class="chip p-medium">medium</span><span class="chip cx cx-complex">complex</span>'), "the complexity badge carries its value class next to the priority badge");
assert.ok(cardHtml({ file: "000004_d.md", name: "d", priority: "high", complexity: "<x>" }, "doing").includes('<span class="chip cx cx-&lt;x&gt;">&lt;x&gt;</span>'), "the complexity badge is escaped");
assert.ok(userCard.includes('<span class="chip cx cx-moderate">moderate</span>'), "an absent complexity renders as moderate");
assert.ok(page.includes(".chip.cx {"), "the base complexity chip style ships in the page css as the fallback");
assert.ok(page.includes(".chip.cx-simple {") && page.includes(".chip.cx-moderate {") && page.includes(".chip.cx-complex {"), "the per-value complexity chip styles ship in the page css");

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
assert.ok(same[0].d.startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`), "same column: the path starts at the blocked card's right edge");
assert.ok(same[0].d.endsWith(`${310 + 280} ${midY(rects["000004_d.md"])}`), "same column: both ends sprout from the right sides, the path ends at the blocker's right edge");
// stacked pair columns share one x: different states at one x still loop out of the right sides
assert.deepEqual(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#4" },
	{ file: "000004_d.md", state: "doing", blockedBy: "" },
], rectOf)[0], same[0], "a different state at the same x (stacked pair) loops out of the right sides too, never through the cards");
const cross = relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#1, #3" },
	{ file: "000001_a.md", state: "backlog", blockedBy: "" },
	{ file: "000003_c.md", state: "to-review", blockedBy: "" },
], rectOf);
assert.equal(cross.length, 2, "multiple blockers draw one curve each");
assert.ok(cross[0].d.startsWith(`M 310 ${midY(rects["000002_b.md"])}`) && cross[0].d.endsWith(`280 ${midY(rects["000001_a.md"])}`), "blocker left of blocked: blocked's left edge to the blocker's right edge");
assert.ok(cross[1].d.startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`) && cross[1].d.endsWith(`620 ${midY(rects["000003_c.md"])}`), "blocker right of blocked: blocked's right edge to the blocker's left edge");
assert.equal(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#3" },
	{ file: "000003_c.md", state: "done", blockedBy: "" },
], rectOf).length, 0, "a done blocker draws nothing");
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#9, junk, , " }], rectOf).length, 0, "ghost and unparseable refs draw nothing");
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#1" }], (f) => (f === "000001_a.md" ? rects["000001_a.md"] : null)).length, 0, "a ref whose card is not rendered draws nothing, and so does an unrendered blocked card");
assert.deepEqual(relationPaths([{ file: "000002_b.md", state: "to-do" }], rectOf), [], "an older payload without blockedBy draws nothing");

// 000127: far-apart columns bend the line into an S (the control offsets scale with the span,
// capped); near pairs and same-column loops keep the fixed bow. The path format is fixed, so the
// control points parse straight out of the d string
const parseCurve = (d: string) => d.match(/^M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/)!.slice(1).map(Number);
const [sx1, , sc1x, , sc2x, , sx2] = parseCurve(same[0].d);
assert.equal(sc1x, sx1 + 40, "same-column loops keep the fixed bow");
assert.equal(sc2x, sx2 + 40, "same-column loops keep the fixed bow");
const [nx1, , nc1x, , nc2x, , nx2] = parseCurve(cross[0].d);
assert.equal(nc1x, nx1 - 40, "adjacent columns keep the fixed bow, the small span never triggers the S");
assert.equal(nc2x, nx2 + 40, "adjacent columns keep the fixed bow, the small span never triggers the S");
const farRects = { ...rects, "000005_e.md": { x: 1240, y: 0, w: 280, h: 60 }, "000006_f.md": { x: 2000, y: 0, w: 280, h: 60 } };
const farOf = (f: string) => farRects[f] ?? null;
const farTasks = (file: string) => [
	{ file, state: "to-do", blockedBy: "#1" },
	{ file: "000001_a.md", state: "backlog", blockedBy: "" },
];
const [fx1, fy1, fc1x, fc1y, fc2x, fc2y, fx2, fy2] = parseCurve(relationPaths(farTasks("000005_e.md"), farOf)[0].d);
const farSpan = Math.abs(fx2 - fx1);
assert.equal(fc1y, fy1, "the S leaves the source card horizontally");
assert.equal(fc2y, fy2, "the S arrives into the target card horizontally");
assert.equal(fc1x, fx1 - farSpan * 0.35, "far-apart columns: the near control offset scales with the span, the line bends into an S");
assert.equal(fc2x, fx2 + farSpan * 0.35, "far-apart columns: the far control scales too, so the S crosses in the middle");
const capped = parseCurve(relationPaths(farTasks("000006_f.md"), farOf)[0].d);
assert.equal(capped[2], capped[0] - 480, "an extreme width caps the control offset at 480 so it never overshoots the board");
assert.equal(capped[4], capped[6] + 480, "an extreme width caps both controls");

// the page runs the tested helpers and ships the overlay wiring
assert.ok(page.includes(String(numLinkHtml)) && page.includes(String(curve)) && page.includes(String(relationPaths)), "the page ships the tested id-link and relation helpers");
assert.match(page, /#board \{[^}]*position: relative/, "#board is the overlay's containing block, so the lines scroll with the content");
assert.ok(page.includes("#relations { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }"), "the overlay stays at z-index 1, above the static columns and behind the cards, and never intercepts their clicks");
assert.match(page, /\.card \{ position: relative; z-index: 2;[^}]*background: color-mix\(in srgb, var\(--panel\) 85%, transparent\)/, "task cards stack above the relation lines with a semi-transparent background, so a line under a card shows through faintly in both themes");
assert.ok(page.includes('setAttribute("pointer-events", "none")'), "the overlay is created non-interactive");
assert.ok(page.includes("stroke-dasharray: 6 4"), "the relation paths render dashed");
assert.ok(page.includes("@keyframes dashflow { to { stroke-dashoffset: -10; } }"), "dashes flow along the path, from the blocked task towards the blocker");
assert.match(page, /@media \(prefers-reduced-motion: reduce\) \{ \.spin \{ animation: none; \} #relations path \{ animation: none; \} \}/, "reduced motion renders the relation paths static");
const pathRule = page.match(/#relations path \{([^}]*)\}/)?.[1] ?? "";
const baseOpacity = Number(pathRule.match(/stroke-opacity: ([\d.]+)/)?.[1]);
assert.ok(baseOpacity > 0 && baseOpacity < 1, "the relation lines draw at a reduced opacity, a subtle hint behind the semi-transparent cards");
const hotOpacity = Number(page.match(/#relations path\.relations-hot \{ stroke-opacity: ([\d.]+)/)?.[1]);
assert.ok(hotOpacity > baseOpacity, "hovering a card raises its lines' opacity clearly above the subtle base");
assert.match(pathRule, /transition: stroke-opacity/, "the opacity change transitions smoothly, the dash animation continues");
assert.ok(page.includes("el.onmouseenter = () => hotRelations(file, true)") && page.includes("el.onmouseleave = () => hotRelations(file, false)"), "the card hover wires the highlight on mouseenter and reverts on mouseleave");
assert.ok(page.includes('if (p.dataset.file === file) p.classList.toggle("relations-hot", on)'), "the hover matches paths by the blocked task's file in the dataset, no quote-unsafe selector interpolation");
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
const sync = (list: any[], open: Set<string> = new Set()) => syncBoard(cols, list, open, els, make, 5);
const shown = (st: string) => cols[st].cards.children.filter((c: El) => c.className === "card").map((c: El) => c.dataset.file);
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
assert.ok(page.includes("setInterval(refresh, 5000)"), "the poll keeps the 5 s cadence");
assert.ok(page.includes('(active ? "&project=" + encodeURIComponent(active) : "")'), "agent-log polls carry the active tab's project");
// 000122: the live auto-scroll glides smoothly, reduced motion falls back to an instant auto;
// the client post-processes every insert, joining cross-chunk tool results and thinking deltas
assert.ok(page.includes('const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";'), "reduced motion falls back to an instant auto scroll");
assert.ok(page.includes("p.scrollTo({ top: p.scrollHeight, behavior: behavior });"), "the live auto-scroll glides smoothly to the bottom");
assert.ok(page.includes('details.lg-tool[data-tc]'), "the client dedupes tool blocks across poll windows by toolCallId");
assert.ok(page.includes('#m-log-text .lg-tres, #m-log-text .lg-cont { display: block; }'), "a joinable span left unresolved by the loaded window still renders as its own line");
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

// agent info: null for a backlog task; populated for a working task with a live pid
assert.equal(listed[0].agent, null);
assert.deepEqual(listed[0].agents, [], "no role logs yet, empty agent history");
assert.ok(page.includes('id="m-agent"'), "modal has the agent area");
assert.ok(!page.includes("<div><span>name</span>"), "the detail card drops the name attribute row the title already shows");
assert.ok(page.includes('"<div><span>issuer</span>" + esc(t.issuer || "user")'), "the detail card shows the issuer row");
assert.ok(
	page.includes("\"<div><span>complexity</span><span class='chip cx cx-\" + esc(t.complexity || \"moderate\") + \"'>\""),
	"the detail card complexity row carries the value class",
);
assert.ok(
	page.includes("\"<div><span>priority</span><span class='chip p-\" + esc(t.priority) + \"'>\" + esc(t.priority) + \"</span></div>\" +"),
	"the detail card keeps the priority row with only the priority chip",
);
assert.ok(page.includes("#m-log.hidden { display: none; }"), "log pane hides");
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
assert.ok(agentCardCss.includes("font-size: 12px") && agentCardCss.includes("padding: 6px 10px"), ".agent-card is a bit larger than the old button");
// 000122: the log text renders in the page's sans serif stack, blocks are collapsed details
const logCss = page.match(/#m-log-text \{[^}]*\}/)![0];
assert.ok(logCss.includes("font-size: 10px"), "the agent log text keeps its 10px size");
assert.ok(logCss.includes("system-ui") && !logCss.includes("monospace"), "the agent log text renders in the page's sans serif stack");
assert.ok(page.includes("#m-log-text pre { font: inherit;"), "log block bodies inherit the sans serif font");
assert.ok(page.includes("#m-log-text summary { cursor: pointer;"), "collapsed log summaries read as clickable");
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
// 000121: the 5 s refresh re-derives the open detail card in place: title and attrs freely, the
// body html-gated, the run cards re-rendered without touching the log pane or its state
const upd = page.match(/function updateOpenTask\(t\) \{[\s\S]*?\n\}/)![0];
assert.ok(page.includes("if (t) updateOpenTask(t); else closeModal();"), "the refresh updates the open card in place and closes it when its task is gone");
assert.ok(upd.includes("writeHead(t)") && upd.includes("renderAgent(t, true)") && upd.includes("setBody(t)"), "the refresh re-derives title, attrs, agent row and body from the fresh payload");
assert.ok(!upd.includes("closeLog") && !upd.includes("logState"), "the refresh path never touches the log pane, logState or the log timer");
assert.ok(page.includes('<div id="m-agent"><div id="m-agent-btns"></div><div id="m-log" class="hidden"><div id="m-log-text"></div></div></div>'), "the log pane is static markup split from the buttons row, so a run-card rebuild never clears it");
assert.ok(!page.includes(`+ '</div><div id="m-log"`), "renderAgent no longer rebuilds the log pane with the run cards");
const setBodySrc = page.match(/function setBody\(t\) \{[\s\S]*?\n\}/)![0];
assert.ok(setBodySrc.includes("if (el.__html === html) return;"), "the body rewrite is html-gated: an unchanged body keeps its node and the reader's scroll");
const ra = page.match(/function renderAgent\(t, keep\) \{[\s\S]*?\n\}/)![0];
assert.ok(ra.includes('.agent-subs").replaceWith(box)'), "a refresh carries the fetched sub boxes over by handle");
// 000130: the keep refresh re-fetches only the live run's sub list, so a sub spawned after the
// card was opened gets its button without re-opening the run; past runs' lists are never re-fetched
assert.ok(ra.includes('if (live) fetchSubs(agentGen, live,') && ra.includes('.agent-col:last-child > .agent-subs'), "the keep refresh re-fetches only the live run's (last column's) sub list");
assert.ok(ra.indexOf("if (keep) {") < ra.indexOf("++agentGen"), "the keep refresh passes the current generation, only an openTask render bumps agentGen");
// 000130: a sub transcript of a still-alive parent keeps polling (an empty poll is not proof a
// growing transcript stopped); a past run's log still stops after the first empty poll
const pollSrc = page.match(/function pollLog\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(pollSrc.includes("const live = !!liveRun && liveRun.handle === logState.handle;"), "a sub view of a still-alive parent stays live: the pane keeps its poll timer after an empty poll");
assert.ok(!pollSrc.includes("logState.sub == null"), "a sub view is no longer hard-wired non-live, which froze the pane after the first empty poll");
assert.ok(pollSrc.includes("if (!live && logState.idle) {"), "a past run's log still stops the timer after the first empty poll");
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
assert.deepEqual(working.agents, [{ role: "developer", run: null, alive: true, status: "live", handle: `${slug}.developer`, tokens: null, duration: null }], "legacy role log, live agent only, no stats in a non-JSON log");

// 000128: the bounce's per-run .dead marker drives the entry status: a run with a sibling
// marker is dead, a markerless run advanced the state itself, the newest run of the live role
// stays live; the stable mtime sort keeps the legacy file before the indexed runs
writeFileSync(join(root, ".kanban", ".logs", `${slug}.developer.0.log`), "run zero\n");
writeFileSync(join(root, ".kanban", ".logs", `${slug}.developer.0.dead`), "424242\n");
writeFileSync(join(root, ".kanban", ".logs", `${slug}.developer.1.log`), "run one\n");
const marked = (await (await fetch(`${base}/api/tasks`)).json())[0];
assert.deepEqual(
	marked.agents.map((a) => [a.run, a.status]),
	[[null, "ok"], [0, "dead"], [1, "live"]],
	"the .dead marker marks its own run dead, markerless runs read ok, the newest run of the live role reads live",
);
rmSync(join(root, ".kanban", ".logs", `${slug}.developer.0.log`));
rmSync(join(root, ".kanban", ".logs", `${slug}.developer.0.dead`));
rmSync(join(root, ".kanban", ".logs", `${slug}.developer.1.log`));

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

// unknown files and unknown roles are rejected; merger handles are allowlisted now
assert.equal((await fetch(`${base}/api/agent-log?file=nope.developer`)).status, 404, "a handle needs its task on the board");
assert.equal((await fetch(`${base}/api/agent-log?file=${encodeURIComponent(slug + ".auditor")}`)).status, 404, "an unknown role is rejected");
assert.equal((await fetch(`${base}/api/agent-log?file=${encodeURIComponent(slug + ".merger")}`)).status, 200, "a merger handle is allowlisted (empty until a merger runs)");
assert.equal((await fetch(`${base}/api/agent-log`)).status, 404);

// a past role log lists as a dead agent and streams through the same endpoint
writeFileSync(join(root, ".kanban", ".logs", `${slug}.reviewer.log`), "REVIEW\n");
const past = (await (await fetch(`${base}/api/tasks`)).json())[0];
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
const stale = (await (await fetch(`${base}/api/tasks`)).json())[0];
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

// a record split at the chunk head (init fetch of a log bigger than LOG_CHUNK) drops its partial
// line instead of rendering raw JSON
const bigRecord = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "z".repeat(100000) } });
writeFileSync(logFile, JSON.stringify({ type: "session", id: "s" }) + "\n" + bigRecord + "\n" + JSON.stringify({ type: "message_end", message: { role: "user", content: "tail" } }) + "\n");
const splitLog = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(splitLog.text, "[prompt] tail\n", "a record split at the chunk head drops its partial line, later records still render");

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
	assert.equal(second.text, "splittable record\n", `split at ${at}: the record renders once its newline arrives`);
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
assert.equal((await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${uniFirst.tail}`)).json()).text, "→ done\n", "a record split mid-multibyte renders whole once its newline arrives");

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
const history = (await (await fetch(`${base}/api/tasks`)).json())[0];
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
assert.equal(fmtDur(3479), "3.5s", "a duration below 10s keeps one decimal");
assert.equal(fmtDur(60000), "1m", "a whole minute drops the zero seconds");
assert.equal(fmtDur(86592), "1m 27s", "minutes and seconds");
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
assert.ok(walkedRun.text.includes("final output line\n") && walkedRun.head === 0, "an unrenderable tail of a run log walks back to renderable content");

// 000120 usage stats: agentHistory entries carry tokens (the sum of the turn_end
// message.usage.totalTokens, cache reads included) and duration (the last record timestamp minus
// the first); timestamps arrive as ISO strings and epoch-ms numbers alike
writeFileSync(dev1, [
	JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "2026-10-11T09:35:54.121Z" }),
	JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "working" } }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 1500, cost: { total: 0 } } }, timestamp: Date.parse("2026-10-11T09:36:24.121Z") }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { totalTokens: 27500 } }, timestamp: "2026-10-11T09:37:24.121Z" }),
].join("\n") + "\n");
const statEntry = (await (await fetch(`${base}/api/tasks`)).json())[0].agents.find((a) => a.handle === `${slug}.developer.1`);
assert.equal(statEntry.tokens, 29000, "tokens sums the turn_end totals across the run log");
assert.equal(statEntry.duration, 90000, "duration is the last record timestamp minus the first (the session record here), ISO and epoch-ms alike");

// 000088 subagent transcripts: the Agent tool result in the parent log names each background agent
// and its .output file; sub=list enumerates them, sub=<n> serves the n-th through the same payload
mkdirSync("/tmp/pi-subagents-1000", { recursive: true });
const subDir = mkdtempSync("/tmp/pi-subagents-1000/webui-test-");
const out0 = join(subDir, "aaaaaaaa-0000-0000-0000-000000000000.output");
const out1 = join(subDir, "bbbbbbbb-0000-0000-0000-000000000000.output");
writeFileSync(out0, "SUB ZERO\n");
writeFileSync(out1, [
	JSON.stringify({ isSidechain: true, agentId: "bbbbbbbb", type: "user", message: { role: "user", content: "do the thing" }, timestamp: "2026-10-11T09:40:00.000Z" }),
	JSON.stringify({ isSidechain: true, type: "assistant", message: { role: "assistant", usage: { totalTokens: 11000 } }, timestamp: "2026-10-11T09:40:11.239Z" }),
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
	JSON.stringify({ isSidechain: true, agentId: "11111111", type: "system", message: { role: "system", content: "x".repeat(LOG_CHUNK) } }),
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
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { totalTokens: 29000 } }, timestamp: Date.parse("2026-10-11T09:36:24.121Z") }),
].join("\n") + "\n")));
rmSync(dev0);
const gzEntry = (await (await fetch(`${base}/api/tasks`)).json())[0].agents.find((a) => a.handle === `${slug}.developer.0`);
assert.ok(gzEntry, "a gzipped run stays in the agent history");
assert.equal(gzEntry.tokens, 29000, "the gzipped run's stats parse from the decompressed records");
assert.ok((await (await get(`${slug}.developer.0`)).json()).text.includes("from the gzipped run\n"), "/api/agent-log serves the gzipped run with renderable content");
// the unrenderable tail walk-back indexes the decompressed text the same way
writeFileSync(`${dev0}.gz`, gzipSync(Buffer.from(terminalLog)));
const gzWalk = await (await get(`${slug}.developer.0`)).json();
assert.ok(gzWalk.text.includes("final output line\n") && gzWalk.head === 0, "an unrenderable tail of a gzipped log walks back on the decompressed text");
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
	(await (await fetch(`${base}/api/tasks`)).json())[0].agents.some((a) => a.handle === `${slug}.developer`),
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
const swept = (await (await fetch(`${base}/api/tasks`)).json())[0];
assert.deepEqual(
	swept.agents.map((a) => a.handle),
	[`${slug}.developer.1`, `${slug}.developer`, `${slug}.developer.0`],
	"in-log first-record timestamps order the swept runs chronologically, the timestamp-less legacy log still sorts by mtime",
);
rmSync(logFile, { force: true });
rmSync(`${dev0}.gz`, { force: true });
rmSync(`${dev1}.gz`, { force: true });

// a second hub on the taken port reports failure instead of throwing
assert.equal(await startHub({ name: "webui-test", root, host: "localhost", port: ui.port }), null);
ui.close();
process.env.HOME = realHome;

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
