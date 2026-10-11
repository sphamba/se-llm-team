import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, getTask, PRIORITY_RANK, setState } from "./kanban.ts";
import { startHub } from "./hub.ts";
import { agentLabel, boardOf, buildShell, cardHtml, curve, flipDiff, LAYOUT, loadWebUiConfig, LOG_CHUNK, mergeBoards, numLinkHtml, pairLayout, relationPaths, renderLogChunk, spinnerHtml, syncBoard, tabNames, tabsHtml } from "./webui.ts";

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
assert.ok(rendered.includes("── thinking ──\n"), "thinking start renders a thinking line");
assert.ok(rendered.includes("Read the specs first.\n"), "thinking delta renders");
assert.ok(rendered.includes("Starting the run.\n"), "text delta renders as text");
assert.equal(rendered.split("[tool] bash: git status --short").length - 1, 1, "one tool line per call: toolcall_end and execution start deduped by id");
assert.ok(rendered.includes("[tool] bash failed: boom: exit 1\n"), "failed tool execution renders an error line");
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

// GET / mentions all 10 state names; other paths and methods are 404
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
// complexity badge on cards: a quiet chip next to the priority chip, default moderate when absent
const cxCard = cardHtml({ file: "000003_c.md", name: "c", priority: "medium", complexity: "complex" }, "doing");
assert.ok(cxCard.includes('<span class="chip p-medium">medium</span><span class="chip cx">complex</span>'), "the complexity badge sits next to the priority badge");
assert.ok(cardHtml({ file: "000004_d.md", name: "d", priority: "high", complexity: "<x>" }, "doing").includes('<span class="chip cx">&lt;x&gt;</span>'), "the complexity badge is escaped");
assert.ok(userCard.includes('<span class="chip cx">moderate</span>'), "an absent complexity renders as moderate");
assert.ok(page.includes(".chip.cx {"), "the quiet complexity chip style ships in the page css");

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
assert.ok(same[0].startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`), "same column: the path starts at the blocked card's right edge");
assert.ok(same[0].endsWith(`${310 + 280} ${midY(rects["000004_d.md"])}`), "same column: both ends sprout from the right sides, the path ends at the blocker's right edge");
// stacked pair columns share one x: different states at one x still loop out of the right sides
assert.equal(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#4" },
	{ file: "000004_d.md", state: "doing", blockedBy: "" },
], rectOf)[0], same[0], "a different state at the same x (stacked pair) loops out of the right sides too, never through the cards");
const cross = relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#1, #3" },
	{ file: "000001_a.md", state: "backlog", blockedBy: "" },
	{ file: "000003_c.md", state: "to-review", blockedBy: "" },
], rectOf);
assert.equal(cross.length, 2, "multiple blockers draw one curve each");
assert.ok(cross[0].startsWith(`M 310 ${midY(rects["000002_b.md"])}`) && cross[0].endsWith(`280 ${midY(rects["000001_a.md"])}`), "blocker left of blocked: blocked's left edge to the blocker's right edge");
assert.ok(cross[1].startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`) && cross[1].endsWith(`620 ${midY(rects["000003_c.md"])}`), "blocker right of blocked: blocked's right edge to the blocker's left edge");
assert.equal(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#3" },
	{ file: "000003_c.md", state: "done", blockedBy: "" },
], rectOf).length, 0, "a done blocker draws nothing");
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#9, junk, , " }], rectOf).length, 0, "ghost and unparseable refs draw nothing");
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#1" }], (f) => (f === "000001_a.md" ? rects["000001_a.md"] : null)).length, 0, "a ref whose card is not rendered draws nothing, and so does an unrendered blocked card");
assert.deepEqual(relationPaths([{ file: "000002_b.md", state: "to-do" }], rectOf), [], "an older payload without blockedBy draws nothing");

// the page runs the tested helpers and ships the overlay wiring
assert.ok(page.includes(String(numLinkHtml)) && page.includes(String(curve)) && page.includes(String(relationPaths)), "the page ships the tested id-link and relation helpers");
assert.match(page, /#board \{[^}]*position: relative/, "#board is the overlay's containing block, so the lines scroll with the content");
assert.ok(page.includes("#relations { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }"), "the overlay sits above the cards and never intercepts their clicks");
assert.ok(page.includes('setAttribute("pointer-events", "none")'), "the overlay is created non-interactive");
assert.ok(page.includes("stroke-dasharray: 6 4"), "the relation paths render dashed");
assert.ok(page.includes("@keyframes dashflow { to { stroke-dashoffset: -10; } }"), "dashes flow along the path, from the blocked task towards the blocker");
assert.match(page, /@media \(prefers-reduced-motion: reduce\) \{ \.spin \{ animation: none; \} #relations path \{ animation: none; \} \}/, "reduced motion renders the relation paths static");
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
assert.ok(modalZ && relationsZ && Number(modalZ) > Number(relationsZ), "the #modal backdrop and card stack above the #relations lines (000119)");
assert.ok(page.includes("render(true); // no FLIP across boards"), "a tab switch never flips from the other board's layout");
assert.ok(page.includes("Promise.all(projects.map(t => fetch(url(t))"), "every tab polls each cycle");
assert.ok(page.includes("setInterval(refresh, 5000)"), "the poll keeps the 5 s cadence");
assert.ok(page.includes('(active ? "&project=" + encodeURIComponent(active) : "")'), "agent-log polls carry the active tab's project");

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
	page.includes("\"<div><span>complexity</span><span class='chip cx'>\" + esc(t.complexity || \"moderate\")"),
	"the detail card gives the complexity badge its own labeled row",
);
assert.ok(
	page.includes("\"<div><span>priority</span><span class='chip p-\" + esc(t.priority) + \"'>\" + esc(t.priority) + \"</span></div>\" +"),
	"the detail card keeps the priority row with only the priority chip",
);
assert.ok(page.includes("#m-log.hidden { display: none; }"), "log pane hides");
assert.ok(page.includes("/api/agent-log"), "page uses the agent log endpoint");
assert.ok(page.includes('<span class="check">✓</span>'), "past agent buttons render a green checkmark");
assert.ok(page.includes(".agent-btn-active"), "the shown agent button gets an active class");
// 000076: the small font belongs to the log text, not the selector buttons, and the buttons share
// one wrapping row, oldest leftmost, the live agent last
const agentBtnCss = page.match(/\.agent-btn \{[^}]*\}/)![0];
assert.ok(agentBtnCss.includes("font-size: 12px") && agentBtnCss.includes("padding: 3px 10px"), ".agent-btn keeps its original 12px size");
assert.ok(page.match(/#m-log pre \{[^}]*\}/)![0].includes("font-size: 10px"), "the agent log text drops to 10px");
assert.ok(/display: flex; flex-wrap: wrap/.test(page.match(/#m-agent-btns \{[^}]*\}/)![0]), "the button container is one wrapping flex row");
assert.ok(!page.includes(".agent-past {") && !page.includes(".agent-live {"), "no per-button block row styles remain");
const pastAt = page.indexOf('class="agent-btn agent-past"');
const liveAt = page.indexOf('class="agent-btn agent-live"');
assert.ok(pastAt >= 0 && liveAt > pastAt, "buttons render chronologically: oldest first, live agent last");
assert.ok(!page.includes("openAgentLog(&quot;"), "no run handle reaches inline JS: quotes and backslashes would break the onclick");
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
assert.deepEqual(working.agents, [{ role: "developer", run: null, alive: true, handle: `${slug}.developer` }], "legacy role log, live agent only");

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
		{ role: "developer", run: null, alive: true, handle: `${slug}.developer` },
		{ role: "reviewer", run: null, alive: false, handle: `${slug}.reviewer` },
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
		{ role: "developer", run: null, alive: false, handle: `${slug}.developer` },
		{ role: "reviewer", run: null, alive: false, handle: `${slug}.reviewer` },
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
assert.ok(servedLog.text.includes("Checking the board.\n"), "endpoint renders the thinking line");
assert.ok(servedLog.text.includes("[tool] read: src/webui.ts\n"), "endpoint renders the tool line");
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
		{ role: "merger", run: 0, alive: false, handle: `${slug}.merger.0` },
		{ role: "developer", run: null, alive: false, handle: `${slug}.developer` },
		{ role: "developer", run: 0, alive: false, handle: `${slug}.developer.0` },
		{ role: "developer", run: 1, alive: true, handle: `${slug}.developer.1` },
		{ role: "live-tester", run: 0, alive: false, handle: `${slug}.live-tester.0` },
		{ role: "reviewer", run: 0, alive: false, handle: `${slug}.reviewer.0` },
		{ role: "live-tester", run: 1, alive: false, handle: `${slug}.live-tester.1` },
		{ role: "merger", run: 1, alive: false, handle: `${slug}.merger.1` },
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

// 000088 subagent transcripts: the Agent tool result in the parent log names each background agent
// and its .output file; sub=list enumerates them, sub=<n> serves the n-th through the same payload
mkdirSync("/tmp/pi-subagents-1000", { recursive: true });
const subDir = mkdtempSync("/tmp/pi-subagents-1000/webui-test-");
const out0 = join(subDir, "aaaaaaaa-0000-0000-0000-000000000000.output");
const out1 = join(subDir, "bbbbbbbb-0000-0000-0000-000000000000.output");
writeFileSync(out0, "SUB ZERO\n");
writeFileSync(out1, JSON.stringify({ isSidechain: true, agentId: "bbbbbbbb", type: "user", message: { role: "user", content: "do the thing" } }) + "\nplain fallback\n");
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
		{ id: "aaaaaaaa-0000-0000-0000-000000000000", index: 0 },
		{ id: "bbbbbbbb-0000-0000-0000-000000000000", index: 1 },
	],
	"sub=list enumerates background agents in log order and drops non-transcript records and paths outside pi's .output dir",
);
const subZero = await (await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=0`)).json();
assert.equal(subZero.text, "SUB ZERO\n", "sub=0 serves the first subagent transcript through the chunked payload");
const subOne = await (await fetch(`${base}/api/agent-log?file=${rvEnc}&sub=1`)).json();
assert.equal(subOne.text, "plain fallback\n", "a sidechain record renders to nothing through renderLogChunk, its non-JSON line passes through (no special casing)");
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

// restore the board for the daemon section below
rmSync(join(root, ".kanban", ".pids", `${slug}.pid`));
for (const f of [dev0, dev1, lt0, lt1, rv0, mg0, mg1]) rmSync(f, { force: true });
rmSync(subDir, { recursive: true, force: true });
setState(root, getTask(root, task.file)!, "backlog");

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
