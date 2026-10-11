import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, getTask, setState } from "./kanban.ts";
import { boardOf, buildShell, cardHtml, flipDiff, LAYOUT, loadWebUiConfig, LOG_CHUNK, mergeBoards, pairLayout, renderLogChunk, spinnerHtml, startWebUi, syncBoard, tabNames, tabsHtml } from "./webui.ts";

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
// blank lines in legacy print-mode text pass through unchanged: an empty line fails JSON.parse
const legacy = "first paragraph\n\nsecond paragraph\n\nthird paragraph\n";
assert.equal(renderLogChunk(legacy), legacy, "blank paragraph lines in non-JSON text pass through");
// a blank line also flushes buffered JSONL text instead of being skipped
const mixed = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "paragraph" } }) + "\n\nlegacy line\n";
assert.equal(renderLogChunk(mixed), "paragraph\n\nlegacy line\n", "a blank line flushes pending text and passes through");

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
assert.equal(listed[0].issuer, "user", "absent issuer reads as user");
assert.equal(listed[0].updated, statSync(join(root, ".kanban", task.file)).mtimeMs);
assert.match(listed[0].body, /# Summary\nDashboard smoke/);

// issuer flows to /api/tasks: the creation value for task-issued tasks
const issued = createTask(root, { name: "feat: issued by 42", summary: "s", issuer: "#42" });
const issuedRow = (await (await fetch(`${base}/api/tasks`)).json()).find((t) => t.file === issued.file);
assert.equal(issuedRow.issuer, "#42");
rmSync(join(root, ".kanban", issued.file)); // the daemon section below expects a one-task board

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

// 000047 stacked pairs: the six middle states render as three .pair wrappers (to-do over doing,
// to-review over reviewing, to-live-test over live-testing), backlog and done stay single columns.
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
assert.deepEqual(boardEl.children.map((c) => c.className), ["col c-backlog", "pair", "pair", "pair", "col c-done"], "backlog and done stay single side columns, the six middle states sit in three pairs");
assert.deepEqual(
	boardEl.children.slice(1, 4).map((p) => p.children.map((c) => c.className)),
	[["col c-to-do", "col c-doing"], ["col c-to-review", "col c-reviewing"], ["col c-to-live-test", "col c-live-testing"]],
	"to-do over doing, to-review over reviewing, to-live-test over live-testing",
);
assert.deepEqual(LAYOUT, ["backlog", ["to-do", "doing"], ["to-review", "reviewing"], ["to-live-test", "live-testing"], "done"], "the states between backlog and done pair up in pipeline order");
assert.deepEqual(pairLayout([...STATE_NAMES.slice(0, -1), "to-merge", "merging", "done"]), ["backlog", ["to-do", "doing"], ["to-review", "reviewing"], ["to-live-test", "live-testing"], ["to-merge", "merging"], "done"], "the queued to-merge/merging states become a fourth pair with no change here");
assert.ok(LAYOUT.every((part) => (typeof part === "string" ? cols[part] : part.every((st) => cols[st]))), "every layout state gets a column");
assert.ok(page.includes(JSON.stringify(LAYOUT)), "the page ships the tested layout");
assert.ok(page.includes(String(buildShell)) && page.includes(String(syncBoard)), "the page runs the tested shell and card pass");

// the state picks the animation: only the states the orchestrator works on carry the spinner
assert.ok(spinnerHtml("doing").includes('<span class="spin">') && spinnerHtml("live-testing").includes('<span class="spin">'), "working states render the spinner");
assert.equal(spinnerHtml("to-do") + spinnerHtml("to-review") + spinnerHtml("done"), "", "waiting and finished states render no spinner");
assert.ok(cardHtml({ file: "000047_fix_x.md", name: "a & b", priority: "high" }, "doing").includes('<span class="num">#47</span>a &amp; b'), "a card carries its short number and escaped name");
// issuer on cards: user-issued keeps full contrast with a plain user chip, task-issued dims the
// name and carries a small #<num> badge
const userCard = cardHtml({ file: "000001_a.md", name: "a", priority: "high" }, "doing");
assert.ok(userCard.includes('<span class="chip">user</span>'), "a user-issued card shows a plain user chip");
assert.ok(!userCard.includes("issued"), "a user-issued card keeps full-contrast styling");
const issuedCard = cardHtml({ file: "000002_b.md", name: "b", priority: "low", issuer: "#42" }, "to-do");
assert.ok(issuedCard.includes('<div class="name issued">'), "a task-issued card dims its name");
assert.ok(issuedCard.includes('<span class="chip issuer">#42</span>'), "a task-issued card carries a small #num badge");
assert.ok(page.includes(".chip.issuer {") && page.includes(".issued {"), "the differentiation classes ship in the page css");

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

// tabs: one per registered project; a single project keeps the old ui, no tab bar
assert.deepEqual(tabNames([{ name: "alpha" }, { name: "beta" }]), ["alpha", "beta"], "one tab per registered project");
assert.deepEqual(tabNames([{ name: "solo" }]), [], "a single project renders no tab bar");
assert.deepEqual(tabNames([]), [], "an empty registry renders no tab bar");
assert.equal(
	tabsHtml(["alpha", "beta"], "beta"),
	'<button class="tab" data-project="alpha">alpha</button><button class="tab active" data-project="beta">beta</button>',
	"the projects list renders one tab per project, the active one marked",
);
assert.equal(tabsHtml(["solo"], "solo"), "", "a single project renders no tab bar html");
assert.equal(
	tabsHtml(["a<b>", "b"], "b"),
	'<button class="tab" data-project="a&lt;b&gt;">a&lt;b&gt;</button><button class="tab active" data-project="b">b</button>',
	"tab labels are escaped",
);
assert.ok(
	[tabNames, tabsHtml, boardOf, mergeBoards].every((fn) => page.includes(String(fn))),
	"the page ships the tested tab helpers",
);
assert.ok(page.includes('<nav id="tabs"></nav>'), "page has the tab bar");
assert.ok(page.includes("switchTab(b.dataset.project)"), "each tab button switches the active board");
assert.match(page, /function switchTab\(name\) \{[\s\S]*?closeModal\(\);[\s\S]*?\}/, "a tab switch closes the open modal");
assert.ok(page.includes("render(true); // no FLIP across boards"), "a tab switch never flips from the other board's layout");
assert.ok(page.includes("Promise.all(projects.map(name => fetch(url(name))"), "every tab polls each cycle");
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

// single-project mode is unchanged: no registry, one bare board, no project param
assert.equal((await fetch(`${base}/api/projects`)).status, 404, "the single-project server has no registry");
assert.ok(page.includes('projects = names.length ? names : [""]'), "the page falls back to one unnamed tab");
assert.ok(
	page.includes('name ? "/api/tasks?project=" + encodeURIComponent(name) : "/api/tasks"'),
	"the single-project fallback polls /api/tasks bare",
);

// agent info: null for a backlog task; populated for a working task with a live pid
assert.equal(listed[0].agent, null);
assert.deepEqual(listed[0].agents, [], "no role logs yet, empty agent history");
assert.ok(page.includes('id="m-agent"'), "modal has the agent area");
assert.ok(!page.includes("<div><span>name</span>"), "the detail card drops the name attribute row the title already shows");
assert.ok(page.includes('"<div><span>issuer</span>" + esc(t.issuer || "user")'), "the detail card shows the issuer row");
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
