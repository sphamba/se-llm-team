// the webui page group: the served client contract (one stylesheet, one script, element ids,
// endpoint list, state slugs, poll cadence, token integrity, focus floor), the docked panel and the
// bottom console, and the behaviour of the helpers the page runs. Every literal CSS pin moved to a structural or behavioural equivalent
// (#364), so a redesign of the stylesheet does not edit this file.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, setState, STATES } from "../../src/kanban.ts";
import { startHub } from "../../src/hub.ts";
import { agentLabel, agentRowSig, agentStatsText, ARCHIVE_PAGE, archivePage, archiveTasks, boardOf, curve, decodeFilters, doctorCol, emptyFilters, encodeFilters, FILTER_DEBOUNCE, filterReason, filtersActive, filtersCount, filterTasks, fmtDur, fmtTokens, isHeld, logFixups, matchesFilters, mergeBoards, MOBILE_MAX, PALETTE_MAX, paletteResults, refreshMs, syncAgentStats, syncDoctorCards, syncStatsLine } from "../../src/webui.ts";
// not re-exported by the webui barrel: import directly from the logpane module
import { esc } from "../../src/webui/logpane.ts";
import * as filtersMod from "../../src/webui/filters.ts";

const root = mkdtempSync(join(tmpdir(), "webui-page-test-"));
const home = mkdtempSync(join(tmpdir(), "webui-page-home-"));
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

// HOME at the temp home keeps the hub registry and lock out of the real global dir
const task = createTask(root, { name: "feat: webui smoke", summary: "Dashboard smoke", specs: "Render the board" });
process.env.HOME = home;
const stages = { reviews: false, liveTesting: true, integrationTesting: false };
const ui = await startHub({ name: "webui-test", root, host: "localhost", port: 0, stages });
if (!ui) throw new Error("hub did not start");
const base = `http://localhost:${ui.port}`;
const page = await (await fetch(`${base}/`)).text();
const histPayload = await (await fetch(`${base}/api/task-history?num=${parseInt(task.file, 10)}`)).json();

// 1. the served client contract: one stylesheet, one script, and the script parses
assert.equal((page.match(/<style>/g) ?? []).length, 1, "the page serves exactly one <style> block");
assert.equal((page.match(/<script>/g) ?? []).length, 1, "the page serves exactly one <script> block");
const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
assert.doesNotThrow(() => new Function(script), "the extracted client script parses");
// #375 the filter helpers reach the client as interpolated source, so a helper the script calls
// must be a declaration the page emits: a dropped interpolation throws on boot, before any card
const filterFns = Object.entries(filtersMod).filter(([, v]) => typeof v === "function").map(([k]) => k);
const scriptFns = new Set([...script.matchAll(/function ([A-Za-z0-9_$]+)\(/g)].map((m) => m[1]));
assert.deepEqual(filterFns.filter((n) => new RegExp(`(^|[^\\w$.])${n}\\(`).test(script) && !scriptFns.has(n)), [], "the served script defines every filter helper it calls, so syncFilterToggle cannot throw on boot");
// the hub shell keeps the element ids the client addresses
const sheetIds = ["theme", "board", "tabs", "updated", "panel", "p-title", "p-facts", "p-prio", "p-actions", "p-runs", "p-body", "console", "c-handle", "c-head", "c-title", "c-meta", "c-log", "c-text"];
for (const id of sheetIds) assert.ok(page.includes(`id="${id}"`), `the page keeps #${id}, an element the client addresses`);
// #412 the hub footer and its stale-code line go, so nothing writes #hub and no writer survives it
assert.ok(!page.includes('id="hub"') && !page.includes("renderHub"), "#412 the footer and its renderHub writer are gone from the page");
// #412 the title is the served root's directory name: the heading takes an id, the static string stays
// for the first paint and the no-hub fallback, and one helper writes both the heading and the tab title
assert.ok(page.includes('<h1 id="title">Software Engineering LLM Team</h1>') && page.includes("<title>Software Engineering LLM Team</title>"), "#412 the heading takes an id and the static title stays served");
const titleSource = page.match(/function syncTitle\(\) \{[\s\S]*?\n\}/);
assert.ok(titleSource, "#412 the client ships the title helper");
const titleOfRoot = (act: string, hub: string, served = "") => {
	const head = { textContent: "Software Engineering LLM Team" };
	const doc: any = { title: "", getElementById: (id: string) => (id === "title" ? head : null) };
	new Function("document", "active", "hubRoot", "servedRoot", "TITLE", titleSource![0] + "; return syncTitle;")(doc, act, hub, served, "Software Engineering LLM Team")();
	return [doc.title, head.textContent];
};
assert.deepEqual(titleOfRoot("/home/me/repos/se-llm-team", ""), ["se-llm-team", "se-llm-team"], "#412 the title is the active root's directory name, in the heading and the tab");
assert.deepEqual(titleOfRoot("", "/srv/hub/"), ["hub", "hub"], "#412 a trailing slash is stripped and the single-project root comes from /api/hub");
assert.deepEqual(titleOfRoot("", "/hub/checkout", "/x/y-alpha"), ["y-alpha", "y-alpha"], "#414 the served project's root beats the hub's own checkout");
assert.deepEqual(titleOfRoot("", "/hub/checkout"), ["checkout", "checkout"], "#414 a hub without a projects list keeps its own checkout root");
assert.match(page, /servedRoot = list\.length === 1[^;]*;/, "#414 the projects handler records the one served root");
assert.deepEqual(titleOfRoot("", ""), ["Software Engineering LLM Team", "Software Engineering LLM Team"], "#412 a missing root keeps the static title");
assert.deepEqual(titleOfRoot("/", "x"), ["Software Engineering LLM Team", "Software Engineering LLM Team"], "#412 a root of / keeps the static title");
assert.match(page.match(/function render\(skipFlip\) \{[\s\S]*?\n\}/)![0], /\n\tsyncTitle\(\);\n\}/, "#412 render writes the title last, so a tab switch follows");
// every state slug reaches the page source, and the layout covers each one exactly once
for (const st of STATES) assert.ok(page.includes(st), `the page source names the ${st} state`);
// the client still calls every hub endpoint the board, the detail card and the tabs need
for (const ep of ["/api/tasks", "/api/task-detail", "/api/task-history", "/api/card-stats", "/api/agent-log", "/api/hub", "/api/projects", "/api/task-block", "/api/task-priority"]) assert.ok(page.includes(ep), `the client still calls ${ep}`);

// 2. the panel and the console: the retired modal ids are gone, the panel is a labelled
// complementary landmark holding its five sections in spec order, and the console is the last
// painted surface in the body
for (const dead of ["modal", "m-box", "m-head", "m-attrs", "m-actions", "m-body", "m-log", "m-log-meta", "m-log-text", "m-agent"])
	assert.ok(!page.includes(`id="${dead}"`), `the retired #${dead} id is gone from the page`);
for (const dead of ["closeModal", "openLog(", "closeLog(", "renderAgent", "renderDoctor", "fetchSubs", "drawAgentRelations"])
	assert.ok(!page.includes(dead), `the retired ${dead} entry point is gone from the client`);
assert.ok(page.includes('<aside id="panel" class="hidden" aria-label="Task detail">'), "the panel is a labelled complementary landmark");
const panelOrder = ["p-head", "p-facts", "p-prio-wrap", "p-actions", "p-runs", "p-body"].map((id) => page.indexOf(`id="${id}"`));
assert.ok(panelOrder.every((at, i) => at > 0 && (i === 0 || at > panelOrder[i - 1])), "the panel holds the header, the priority control, the actions, the runs and the body in spec order");
assert.ok(!page.includes('id="p-history"') && !page.includes("writeHistory"), "the footer history block and its writer are gone, so no block sits between the runs and their children");
assert.ok(page.indexOf('id="console"') > page.indexOf('id="panel"') && page.indexOf('id="console"') < page.indexOf("<script>"), "the console follows the panel in the body, the last painted surface");
assert.ok(page.includes('<div id="c-handle" role="separator" tabindex="0"') && page.includes('aria-orientation="horizontal"'), "the resize handle is a focusable separator that names its orientation");
assert.match(page, /#panel \{[^}]*top: var\(--chrome\)[^}]*bottom: var\(--console-h\)/, "the panel starts under the page chrome and stops above the console, so neither surface covers the other's close control");
assert.match(page, /#console \{[^}]*height: var\(--console-h\)/, "the console takes its height from the one page variable");
assert.ok(page.includes("syncPanelTop()") && page.includes('setProperty("--chrome"'), "the panel measures the page chrome on open and on resize");
assert.ok(!/backdrop-filter|::backdrop|\.backdrop \{/.test(page) && /#panel \{[^}]*position: fixed/.test(page), "the panel is a fixed dock with no backdrop rule, so the board keeps its width");
// the assigned height is honoured: the console is a flex item in the body column, so without a fixed
// flex basis the row shrinks it below the 60vh the variable names
assert.match(page, /#console \{[^}]*flex: 0 0 auto/, "the console holds the height the variable assigns instead of shrinking in the body column");
// the panel heading carries the number and the task name, and only rewrites when the text changes
const titleEl = { textContent: "" };
const titleOf = new Function("document", "numOf", page.match(/function writeTitle\(t\) \{[\s\S]*?\n\}/)![0] + "; return writeTitle;")(
	{ getElementById: (id: string) => (id === "p-title" ? titleEl : null) },
	(f: string) => parseInt(f.slice(0, 6), 10),
) as (t: any) => void;
titleOf({ file: "000263_demo.md", name: "feat: docked panel probe" });
assert.equal(titleEl.textContent, "#263 feat: docked panel probe", "the panel heading names the number and the task name");
assert.ok(page.match(/function writePanel\(t, withBody\) \{[\s\S]*?\n\}/)![0].includes("writeTitle(t)"), "every panel write refreshes the heading");

// 3. token integrity: no rule reads a name nothing declares, both themes declare the same names,
// and every raw hex value sits in a token block. --ac and --shine-base stay rule-local: the column
// classes and the pulse rules set them per element
const themeCss = page.match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, "");
const tokenBlocks = themeCss.match(/\{ --canvas: [^}]*\}/g)!;
const tokenNames = (block: string) => new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const declared = new Set([...page.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const used = new Set([...page.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
assert.deepEqual([...used].filter((n) => !declared.has(n)), [], "every var(--token) the stylesheet uses is declared in it, so no rule reads a dangling name");
assert.equal(tokenBlocks.length, 3, "the stylesheet declares the token set once per theme path: light, the data-theme override and the media query");
assert.deepEqual(tokenBlocks.slice(1).flatMap((b) => [...tokenNames(b)].filter((n) => !tokenNames(tokenBlocks[0]).has(n))), [], "no dark token block declares a name the light :root block lacks, so all three theme paths resolve the same tokens");
const withoutTokens = tokenBlocks.reduce((css, block) => css.split(block).join(""), themeCss);
assert.equal(withoutTokens.match(/#[0-9a-fA-F]{3,8}\b/g), null, "the stylesheet keeps every raw hex value inside a token block, theme.ts sets colour only through tokens");

// 4. accessibility floor: every selector the stylesheet marks with cursor: pointer answers
// keyboard focus, with a visible outline rather than a colour-only cue
const subjects = new Set<string>();
for (const seg of themeCss.split("}")) {
	if (!/cursor:\s*pointer/.test(seg)) continue;
	const parts = seg.split("{");
	for (const one of parts[parts.length - 2].split(",")) subjects.add(one.trim().split(/\s+/).pop()!);
}
assert.equal(subjects.size, 15, "fifteen selectors mark an element interactive with cursor: pointer, #motion gone with #377");
assert.deepEqual([...subjects].filter((s) => !page.includes(`${s}:focus-visible`)), [], "every interactive selector the stylesheet marks with cursor: pointer has a :focus-visible rule");
assert.match(page.match(/[^{}]*:focus-visible[^{}]*\{[^}]*\}/)![0], /outline: 2px solid var\(--link\)/, "the focus ring is a visible outline in the link colour");

// 5. the cadence: 1 s while the open task has a live agent or doctor, 5 s otherwise
assert.equal(refreshMs({ agents: [{ alive: true }] }), 1000, "a live agent on the open card ticks the poll at 1 s");
assert.equal(refreshMs({ agents: [], doctors: [{ alive: true }] }), 1000, "a live doctor with no live agent also ticks the poll at 1 s");
for (const t of [{ agents: [{ alive: false }], doctors: [{ alive: false }] }, { agents: [] }, {}, null]) assert.equal(refreshMs(t), 5000, "no live agent and no live doctor keeps the 5 s cadence");
assert.ok(page.includes(String(refreshMs)), "the page runs the tested cadence helper");

// 6. the served md renderer: a GFM table body, the wrapper and the pinned first cells
const mdStart = script.indexOf("function md(src) {");
assert.ok(mdStart >= 0, "the page serves the md renderer for task bodies and log text");
const mdEnd = script.indexOf("\n}\n", mdStart);
assert.ok(mdEnd > mdStart, "the served md function closes");
const servedMd = new Function(
	script.match(/const esc = .*;\n/)![0] +
	script.match(/const inline = [\s\S]*?;\n/)![0] +
	script.slice(mdStart, mdEnd + 2) +
	"; return md;",
)() as (s: string) => string;
assert.equal(
	servedMd("| a | b |\n| --- | --- |\n| 1 | 2 |"),
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin">a</th><th>b</th></tr></thead><tbody><tr><td class="md-pin">1</td><td>2</td></tr></tbody></table></div>',
	"the served md renders a GFM table body with the wrapper, thead and pinned first cells",
);

// 7. the served logFixups merges a cut table across chunks: the older chunk (header, separator,
// one body row, still open) prepends above the row paragraphs the newer chunk already left in the
// pane, and the pass absorbs them into the table as rows
const lfStart = script.indexOf("function logFixups(el, doc) {");
assert.ok(lfStart >= 0, "the page serves the logFixups pass");
const lfEnd = script.indexOf("\n}\n", lfStart);
assert.ok(lfEnd > lfStart, "the served logFixups function closes");
const servedLogFixups = new Function("CSS", script.slice(lfStart, lfEnd + 2) + "; return logFixups;")() as (el: any, doc: any) => void;
class FixEl {
	tag: string;
	className = "";
	innerHTML = "";
	textContent = "";
	dataset: Record<string, string> = {};
	style: Record<string, string> = {};
	children: FixEl[] = [];
	parent: FixEl | null = null;
	classList = { contains: (cls: string) => this.className.split(/\s+/).includes(cls) };
	constructor(tag: string) { this.tag = tag; }
	get tagName() { return this.tag.toUpperCase(); }
	sibling(step: number): FixEl | null { const p = this.parent; return p ? p.children[p.children.indexOf(this) + step] ?? null : null; }
	get previousElementSibling() { return this.sibling(-1); }
	get nextElementSibling() { return this.sibling(1); }
	querySelectorAll(sel: string): FixEl[] {
		const out: FixEl[] = [];
		const walk = (n: FixEl) => { for (const c of n.children) { if (fixMatches(c, sel)) out.push(c); walk(c); } };
		walk(this);
		return out;
	}
	querySelector(sel: string): FixEl | null { return this.querySelectorAll(sel)[0] ?? null; }
	appendChild(c: FixEl): FixEl { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }
	append(...cs: FixEl[]) { for (const c of cs) this.appendChild(c); }
	prepend(c: FixEl) { this.children.unshift(c); c.parent = this; }
	remove() { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); this.parent = null; }
	replaceWith(c: FixEl) { const p = this.parent; if (!p) return; p.children[p.children.indexOf(this)] = c; c.parent = p; this.parent = null; }
}
const fixMatches = (c: FixEl, sel: string) => {
	const m = sel.match(/^(?:([a-z]+))?(?:\.([\w-]+))?(?:\[data-([\w-]+)(?:="([^"]*)")?\])?$/);
	if (!m) return c.tag === sel;
	const [, tag, cls, attr, val] = m;
	return (!tag || c.tag === tag) && (!cls || c.classList.contains(cls)) && (attr === undefined || (val !== undefined ? c.dataset[attr] === val : attr in c.dataset));
};
(globalThis as any).CSS ??= { escape: (s: string) => s };
const fixDoc = { createElement: (tag: string) => new FixEl(tag) };
const fixEl = (tag: string) => new FixEl(tag);
const fixPane = new FixEl("div");
const paneRow = (html: string) => { const p = fixEl("p"); p.innerHTML = html; p.textContent = html; fixPane.appendChild(p); return p; };
paneRow("| 1 | 2 |");
paneRow("| 3 | 4 |");
const prose = paneRow("Done.");
const olderWrap = fixEl("div");
olderWrap.className = "md-table-wrap";
olderWrap.dataset.open = "tbl";
const olderTable = fixEl("table");
const olderHead = fixEl("thead");
const olderHeadRow = fixEl("tr");
for (const text of ["a", "b"]) { const th = fixEl("th"); th.textContent = text; th.style.textAlign = ""; olderHeadRow.appendChild(th); }
olderHead.appendChild(olderHeadRow);
const olderBody = fixEl("tbody");
const olderRow = fixEl("tr");
for (const text of ["1", "2"]) { const td = fixEl("td"); td.textContent = text; olderRow.appendChild(td); }
olderBody.appendChild(olderRow);
olderTable.append(olderHead, olderBody);
olderWrap.appendChild(olderTable);
fixPane.prepend(olderWrap);
servedLogFixups(fixPane, fixDoc);
assert.equal(olderBody.children.length, 3, "the served pass absorbs both row paragraphs into the older chunk's table");
assert.equal(olderBody.children[1].innerHTML, '<tr><td class="md-pin">1</td><td>2</td></tr>', "the first absorbed row renders the exact md() row markup");
assert.equal(olderBody.children[2].innerHTML, '<tr><td class="md-pin">3</td><td>4</td></tr>', "the second absorbed row joins it");
assert.deepEqual(fixPane.children.map((c) => c.tag), ["div", "p"], "the absorbed paragraphs leave the pane, the prose after them stays");
assert.ok(fixPane.children[1] === prose && !("open" in olderWrap.dataset), "the non-row sibling keeps its node and the prose closes the table, so the marker clears");
assert.ok(page.includes(String(logFixups)), "the page runs the tested log fixups: dedupe, joins, orphan promotions");

// 8. per-project payloads map to their own tab; a null payload keeps that tab's previous data
const boards = {};
mergeBoards(boards, [["alpha", [{ file: "000001_a.md" }]], ["beta", [{ file: "000002_b.md" }]]]);
assert.deepEqual([boardOf(boards, "alpha").tasks[0].file, boardOf(boards, "beta").tasks[0].file], ["000001_a.md", "000002_b.md"], "each payload lands under its own project");
boardOf(boards, "alpha").expanded.add("backlog");
mergeBoards(boards, [["alpha", [{ file: "000003_c.md" }]], ["beta", null]]);
assert.ok(boardOf(boards, "alpha").expanded.has("backlog") && boardOf(boards, "beta").tasks[0].file === "000002_b.md", "fold choices stay with their project and a failed project fetch keeps that tab's previous data");
assert.ok(boardOf(boards, "gamma").tasks.length === 0 && boardOf(Object.create(null), "__proto__").tasks.length === 0, "an unvisited tab starts as an empty board, and a project named like an object key gets its own board");

// 9. the hub registry answers /api/projects with its own entry, and the history endpoint answers
const projects = await (await fetch(`${base}/api/projects`)).json();
assert.equal(projects.length, 1, "the hub registry lists its own entry");
assert.ok(projects[0].root === root && JSON.stringify(projects[0].stages) === JSON.stringify(stages), "the hub registry carries the daemon's root and stage flags");
// agent info: null for a backlog task; no role logs yet, so the history carries an empty list
assert.ok(histPayload.agent === null && histPayload.agents.length === 0, "the task history reports no agent for a backlog task and an empty run list");

// 10. the agent row keeps its node identity across a poll: an unchanged run set moves only the
// cards' .agent-stats text, so the live run's .spin node keeps its animation across the poll; a
// structure change (a run added or gone, live -> dead) rebuilds the row. runRow builds the row the
// page's rebuild would have produced, with its seeded signature.
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
assert.ok(agentRow.children[1].children[0].children[0] === spin && agentRow.children[1].children[0].writes === 0, "the same .spin node keeps its animation: the card markup is not rewritten");
assert.deepEqual(
	[agentRow.children[0].children[0].children[1].textContent, agentRow.children[1].children[0].children[1].textContent],
	["2k · 1m 30s", "999 · 1m 30s"],
	"both cards' stats lines moved to the fresh values",
);
const rebuilds = [
	[...grew, { role: "live-tester", run: null, alive: false, status: "ok", handle: "t.live-tester", tokens: null, duration: null }],
	grew.slice(1),
	grew.map((a) => (a.alive ? { ...a, alive: false, status: "ok" } : a)),
];
assert.deepEqual(rebuilds.map((r) => syncAgentStats(agentRow, r, docStub)), [false, false, false], "a run added, a run gone or live -> dead rebuilds the row");
assert.equal(syncAgentStats(new El("div"), grew, docStub), false, "a missing row rebuilds too");
// a card whose stats were empty carries no span; the span joins when stats arrive and drops when
// they vanish, the markup agentCardHtml renders
const bare = runRow([{ role: "developer", run: null, alive: true, status: "live", handle: "t.developer", tokens: null, duration: null }]);
assert.equal(bare.children[0].children[0].children.length, 1, "empty stats render no span");
assert.ok(syncAgentStats(bare, [{ ...grew[1], handle: "t.developer", role: "developer", run: null }], docStub) && bare.children[0].children[0].children[1].textContent === "999 · 1m 30s", "the span joins the card when stats arrive");
assert.ok(syncAgentStats(bare, [{ role: "developer", run: null, alive: true, status: "live", handle: "t.developer", tokens: null, duration: null }], docStub) && bare.children[0].children[0].children.length === 1, "the span drops when the stats vanish");

// 11. the doctor cards slot into their analysed run's column, matched by handle: a doctor entry's
// handle is the parent run's handle plus the .doctor suffix; unmatched cards (run log rotated
// away) keep the residual #m-doctor row
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
assert.ok(doctorCol(slotRow, "t.developer.0.doctor") === slotRow.children[0] && doctorCol(slotRow, "t.developer.9.doctor") === null, "the doctor handle strips the .doctor suffix and matches the analysed run's column, a rotated-away run gets none");
const residual = new El("div");
const doctorDocs = [mkDoc("t.developer.0.doctor", false, 20, 5000), mkDoc("t.missing.0.doctor", true, 30, 60000)];
const doctorCards = doctorDocs.map((d) => {
	const card = doctorCardEl(d);
	(doctorCol(slotRow, d.handle) ?? residual).appendChild(card);
	return card;
});
residual.__sig = agentRowSig(doctorDocs);
const docSpin = doctorCards[1].children[0];
assert.ok(doctorCards[0].parentElement === slotRow.children[0] && doctorCards[1].parentElement === residual, "a matched card slots into its analysed run's column, an unmatched card stays in the residual row");
const doctorGrew = [mkDoc("t.developer.0.doctor", false, 30, 9000), mkDoc("t.missing.0.doctor", true, 40, 90000)];
residual.__sig = agentRowSig(doctorGrew);
assert.ok(syncDoctorCards(doctorCards, doctorGrew, slotRow, residual, docStub), "an unchanged doctor set updates the cards in place");
assert.ok(doctorCards[1].children[0] === docSpin && doctorCards[1].children[1].textContent === "40 · 1m 30s" && doctorCards[0].children[1].textContent === "30 · 9s", "the live doctor card keeps its .spin node and both stats lines move");
assert.equal(doctorCards[1].children[0].children.length, 0, "no stray span lands inside the mark span");
const rebuiltRow = runRow([
	{ role: "developer", run: 0, alive: false, status: "ok", handle: "t.developer.0", tokens: null, duration: null },
	{ role: "reviewer", run: 1, alive: false, status: "ok", handle: "t.reviewer.1", tokens: null, duration: null },
]);
assert.deepEqual(
	[
		syncDoctorCards(doctorCards, doctorGrew.slice(1), slotRow, residual, docStub),
		syncDoctorCards(doctorCards, [...doctorGrew, mkDoc("t.developer.9.doctor", false, 1, 1)], slotRow, residual, docStub),
		syncDoctorCards(doctorCards, doctorGrew, rebuiltRow, residual, docStub),
	],
	[false, false, false],
	"a doctor card added or gone, and a run-row rebuild that detaches the slotted cards, each rebuild",
);
residual.__sig = agentRowSig(doctorGrew.map((d) => (d.alive ? { ...d, alive: false, status: "ok" } : d)));
assert.equal(syncDoctorCards(doctorCards, doctorGrew, slotRow, residual, docStub), false, "live -> dead flips the signature, the rebuild swaps the spinner for the check");
const lone = doctorCardEl(mkDoc("t.developer.0.doctor", false, null, null));
assert.equal(lone.children.length, 1, "empty stats render no span");
syncStatsLine(lone, 999, 1200, docStub);
assert.equal(lone.children[1].textContent, "999 · 1s", "the span joins the card when stats arrive");
syncStatsLine(lone, null, null, docStub);
assert.equal(lone.children.length, 1, "the span drops when the stats vanish");
// the integration tester's label comes from the shared agentLabel pass (the role capitalized,
// 1-based when the role has several runs)
assert.equal(agentLabel({ role: "integration-tester", run: 0 }, { "integration-tester": 1 }), "Integration-tester", "the integration-tester run card reads its role as a label");

// 12. 000194 markLiveLine, run against the served source: the pulse lands on the LATEST open
// thinking/tool block only, and clears on run death or on another run's view
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
	const mark = new Function("openDetail", "panelFile", "logPane", "logState", "document", page.match(/function markLiveLine\(\) \{[\s\S]*?\n\}/)![0] + "; return markLiveLine;")(
		{ file: "t.md", agents: [{ handle: "h", alive: opts.alive !== false }] },
		"t.md",
		() => pane,
		{ handle: opts.handle ?? "h" },
		{ getElementById: (id: string) => (id === "c-text" ? container : null) },
	);
	return () => mark();
};
const thinkBlocks = [shThinkBlock(false), new ShineEl("p"), shThinkBlock(true)];
markOf(thinkBlocks)();
assert.ok(thinkBlocks[2].classList.contains("pulse") && !thinkBlocks[0].classList.contains("pulse") && !thinkBlocks[1].classList.contains("pulse"), "the pulse lands on the latest open thinking block, an earlier closed block and plain text never shine");
const toolBlocks = [shToolBlock(true), shThinkBlock(false), shToolBlock(false)];
markOf(toolBlocks)();
assert.ok(toolBlocks[2].classList.contains("pulse") && !toolBlocks[0].classList.contains("pulse"), "the pulse lands on the latest executing tool block, an ended one does not shine");
const idleBlocks = [new ShineEl("p"), shThinkBlock(false), shToolBlock(true), new ShineEl("p")];
markOf(idleBlocks)();
assert.ok(idleBlocks.every((b) => !b.classList.contains("pulse")), "no block shines between blocks or on plain text");
const dyingBlocks = [shThinkBlock(true), shToolBlock(false)];
markOf(dyingBlocks, { alive: false })();
assert.ok(dyingBlocks.every((b) => !b.classList.contains("pulse")), "a dead run clears the shine");
const otherBlocks = [shThinkBlock(true)];
markOf(otherBlocks, { handle: "other" })();
assert.ok(!otherBlocks[0].classList.contains("pulse"), "a different run's view clears the shine");

// 13. 000194 close paths: one closeAnimated helper serves the modal and the log pane; the hide
// waits for the element's own animationend with a fixed-timeout fallback, a bubbled descendant
// animationend is ignored, a reopen during the close cancels the pending hide, and reduced motion
// hides at once
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
const closeOf = (reduce: boolean) => new Function("noMotion", "setTimeout", "clearTimeout", page.match(/function closeAnimated\(el\) \{[\s\S]*?\n\}/)![0] + "; return closeAnimated;")(
	() => reduce,
	(fn: () => void) => { closeTimers.push(fn); return closeTimers.length - 1; },
	(id?: number) => { if (id != null) closeTimers[id] = null; },
);
const closing = new CloseEl();
closeOf(false)(closing);
assert.ok(closing.classList.contains("closing") && !closing.classList.contains("hidden"), "the close starts the exit animation");
closing.listeners[0]();
assert.ok(closing.classList.contains("hidden") && !closing.classList.contains("closing"), "the element's own animationend hides it and drops .closing");
const bubbling = new CloseEl();
closeOf(false)(bubbling);
bubbling.listeners[0]({ target: { tag: "pre" } });
assert.ok(!bubbling.classList.contains("hidden") && bubbling.classList.contains("closing"), "a bubbled descendant animationend does not hide early");
bubbling.listeners[0]({ target: bubbling });
assert.ok(bubbling.classList.contains("hidden") && bubbling.listeners.length === 0, "the element's own animationend hides it and drops the listener");
const again = new CloseEl();
const timerBase = closeTimers.length;
closeOf(false)(again);
again.classList.remove("closing");
closeOf(false)(again);
assert.ok(again.classList.contains("closing") && closeTimers[timerBase] === null, "the second close restarts the exit and clears the cancelled close's stale fallback timer");
closeTimers[timerBase + 1]?.();
assert.ok(again.classList.contains("hidden") && !again.classList.contains("closing"), "the live fallback still hides");
const reopened = new CloseEl();
closeOf(false)(reopened);
reopened.classList.remove("closing");
reopened.listeners[0]();
assert.ok(!reopened.classList.contains("hidden"), "a reopen during the close cancels the pending hide");
const still = new CloseEl();
closeOf(true)(still);
assert.ok(still.classList.contains("hidden") && !still.classList.contains("closing"), "reduced motion hides at once with no exit");
// the panel and the console keep one close path each: the panel close clears the hash so back and
// forward stay in step, and the console close clears the poll and the state before the visual hide
const closePanelSrc = page.match(/function closePanel\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(closePanelSrc.includes('location.hash = archiveView ? "archive" : ""') && closePanelSrc.includes("hidePanel()"), "the user close clears the hash, or returns to the archive, and lets the route hide the panel");
const hideSrc = page.match(/function hidePanel\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(hideSrc.includes("closeAnimated(p)") && hideSrc.indexOf("panelFile = null") < hideSrc.indexOf("closeAnimated(p)"), "hidePanel clears the open task before the shared exit");
assert.ok(hideSrc.includes("cardEls.get(openerFile)") && hideSrc.includes("card.focus()"), "on close, focus returns to the card that opened the panel");
const closeConsoleSrc = page.match(/function closeConsole\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(closeConsoleSrc.indexOf("clearInterval") < closeConsoleSrc.indexOf("closeAnimated") && closeConsoleSrc.includes("logState = null;"), "closeConsole clears the poll and the state before the visual hide");
assert.ok(closeConsoleSrc.includes('getElementById("c-text")') && closeConsoleSrc.includes('textContent = "";'), "the console close discards the loaded log text, the heavy part of the view");
assert.ok(page.includes('onclick="closeConsole()"') && page.includes('onclick="closePanel()"'), "the two close buttons use their own shared close paths");
assert.ok(!hideSrc.includes("closeConsole") && !closeConsoleSrc.includes("hidePanel"), "closing the panel keeps the console open and closing the console keeps the panel open");
assert.ok(page.includes('if (e.key !== "Escape") return;') && page.includes('if (!document.getElementById("console").classList.contains("hidden")) return closeConsole();'), "Escape closes the console first when it is open, then the panel");

// 14. the priority control: four options, never a select; the write is optimistic, a poll that
// lands mid-flight never clobbers it, a non-200 reverts and names the reason inline, and only a
// confirming poll drops the optimistic value
class PrioEl {
	children: Array<{ dataset: { p: string }; pressed: string; setAttribute(k: string, v: string): void }> = [];
	__html: string | undefined;
	#html = "";
	get innerHTML() { return this.#html; }
	set innerHTML(v: string) {
		this.#html = v;
		// the only markup this stub parses: one button per priority, in source order
		this.children = [...v.matchAll(/data-p="(\w+)"/g)].map((m) => ({
			dataset: { p: m[1] },
			pressed: "",
			setAttribute(_k: string, val: string) { this.pressed = val; },
		}));
	}
	querySelectorAll(sel: string) { return sel === ".seg" ? this.children : []; }
}
const prioEl = new PrioEl();
const prioErr = { textContent: "" };
let prioFetch: any = null;
const prioSrc = page.slice(page.indexOf("const PRIOS = ["), page.indexOf("// payload role to row marker class"));
const makePrio = () => new Function("document", "fetch", "render", "activeBoard", "pollDetail", "numOf",
	'let openDetail = null, panelFile = null; const active = "";\n' + prioSrc +
	"\n; return { writePriority: writePriority, setPriority: setPriority, prioValue: prioValue, get want() { return prioWant; }, set open(v) { openDetail = v; }, set file(v) { panelFile = v; } };")(
	{ getElementById: (id: string) => (id === "p-prio" ? prioEl : id === "p-prio-err" ? prioErr : null) },
	(u: string, init: unknown) => prioFetch(u, init),
	() => {},
	() => ({ tasks: [] }),
	() => Promise.resolve(),
	(f: string) => parseInt(f.slice(0, 6), 10),
);
const prio = makePrio();
const pressed = () => prioEl.children.filter((b) => b.pressed === "true").map((b) => b.dataset.p);
prio.file = "000263_task.md";
const t263 = { file: "000263_task.md", priority: "medium" };
prio.open = t263;
prio.writePriority(t263);
assert.deepEqual(prioEl.children.map((b) => b.dataset.p), ["low", "medium", "high", "critical"], "the control is a four-option segmented control, never a select");
assert.deepEqual(pressed(), ["medium"], "the stored priority is the only pressed option");
let resolveWrite: (v: unknown) => void = () => {};
prioFetch = () => new Promise((res) => { resolveWrite = res; });
prio.setPriority("high");
assert.deepEqual(pressed(), ["high"], "the chosen priority shows at once, before the response");
prio.writePriority({ file: "000263_task.md", priority: "medium" });
assert.deepEqual(pressed(), ["high"], "a poll that lands during the in-flight write never clobbers the optimistic value");
resolveWrite({ ok: false, json: () => Promise.resolve({ error: "priority not allowed" }) });
await new Promise((r) => setTimeout(r, 0));
assert.deepEqual(pressed(), ["medium"], "a non-200 response reverts the control to the stored priority");
assert.ok(prioErr.textContent.includes("priority not allowed"), "the failure reason shows inline under the control");
prioErr.textContent = "";
resolveWrite = () => {};
prioFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
prio.setPriority("high");
await new Promise((r) => setTimeout(r, 0));
assert.deepEqual(pressed(), ["high"], "a saved write keeps the chosen value on screen");
prio.writePriority({ file: "000263_task.md", priority: "medium" });
assert.deepEqual(pressed(), ["high"], "a stale poll started before the write still cannot revert it");
prio.writePriority({ file: "000263_task.md", priority: "high" });
assert.equal(prio.want, null, "the confirming poll drops the optimistic value");
prio.writePriority({ file: "000263_task.md", priority: "medium" });
assert.deepEqual(pressed(), ["medium"], "after the confirmation the control follows the file again");

// 15. the run rows: one row per run with its role, start, duration and tokens, a spinner on a live
// run, a red cross on a dead one, the subagent rows stacked under their run, and the row that
// matches the open console carrying the active marker
const writeGatedSrc = page.match(/function writeGated\(el, html\) \{[\s\S]*?\n\}/)![0];
const groupRunsSrc = page.match(/function groupRuns\(agents, doctors\) \{[\s\S]*?\n\}/)![0];
const runsSrc = groupRunsSrc + page.slice(page.indexOf("const ROLE_CLS = "), page.indexOf("// the panel heading"));
const liveSpans: Record<string, any>[] = [];
const makeSpan = (handle: string) => {
	const span: Record<string, any> = { dataset: { liveHandle: handle }, firstChild: null };
	Object.defineProperty(span, "textContent", {
		get: () => (span.firstChild ? span.firstChild.data : ""),
		set: (v: string) => {
			if (!v) span.firstChild = null;
			else span.firstChild = { data: v };
		},
	});
	return span;
};
const runsEl: Record<string, any> = { __html: undefined, __dom: "", querySelectorAll: (sel: string) => (sel === ".row-meta[data-live-handle]" ? liveSpans : []) };
Object.defineProperty(runsEl, "innerHTML", {
	get: () => runsEl.__dom,
	set: (v: string) => {
		liveSpans.length = 0;
		for (const m of v.matchAll(/data-live-handle="([^"]*)"/g)) liveSpans.push(makeSpan(m[1]));
		runsEl.__dom = v;
	},
});
const runLog = { handle: "t.dev.1", sub: null as number | null };
let subFetches: string[] = [];
const makeRuns = () => new Function("esc", "fmtDur", "fmtTokens", "logState", "agentLabel", "document", "fetch", "encodeURIComponent", "projectParam", "openConsole",
	writeGatedSrc + "\nlet openDetail = null, panelFile = null;\n" + runsSrc +
	"\n; return { writeRuns: writeRuns, subCache: subCache, set open(v) { openDetail = v; }, set file(v) { panelFile = v; } };")(
	esc, fmtDur, fmtTokens, runLog, agentLabel,
	{ getElementById: (id: string) => (id === "p-runs" ? runsEl : null) },
	(u: string) => { subFetches.push(u); return new Promise(() => {}); },
	encodeURIComponent,
	() => "",
	() => {},
);
const runs = makeRuns();
runs.file = "000263_task.md";
runs.open = { file: "000263_task.md", agents: [{ role: "developer", handle: "t.dev.1", run: 0, alive: true, start: 1700000000000, duration: 65000, tokens: 1234 }] };
runs.writeRuns();
const liveRow = runsEl.innerHTML as string;
assert.ok(liveRow.includes("agent-developer") && liveRow.includes("agent-live") && liveRow.includes('<span class="spin"></span>'), "a live run keeps its role class and its spinner");
assert.ok(liveRow.includes('data-handle="t.dev.1"') && liveRow.includes('data-role="developer"'), "the row carries the run handle and role the console click needs");
// #420 a live row's numbers move in place, so its html carries an empty slot and no values
assert.ok(liveRow.includes('<span class="row-meta" data-live-handle="t.dev.1"></span>'), "a live run's meta text is an empty slot that carries its handle");
assert.ok(!liveRow.includes(fmtTokens(1234)) && !liveRow.includes(fmtDur(65000)), "a live run's html carries neither the tokens nor the duration");
assert.equal(liveSpans.length, 1, "the runs block holds one live slot");
assert.equal(liveSpans[0].textContent, [new Date(1700000000000).toLocaleTimeString(), fmtTokens(1234), fmtDur(65000)].join(" · "), "the slot shows the start, the duration and the tokens");
assert.ok(liveSpans[0].textContent.indexOf(fmtTokens(1234)) < liveSpans[0].textContent.indexOf(fmtDur(65000)), "the run row reads the start, then the tokens before the time");
const headEls: Record<string, any> = { "c-title": {}, "c-state": {}, "c-tokens": {} };
const makeHead = new Function("fmtDur", "fmtTokens", "logState", "document",
	"let openDetail = null, panelFile = null;\n" + page.match(/function writeConsoleHead\(\) \{[\s\S]*?\n\}/)![0] +
	"\n; return { write: writeConsoleHead, set open(v) { openDetail = v; }, set file(v) { panelFile = v; } };") (
	fmtDur, fmtTokens, { handle: "t.dev.1", num: 263, role: "developer", sub: null },
	{ getElementById: (id: string) => headEls[id] },
);
makeHead.file = "000263_task.md";
makeHead.open = { file: "000263_task.md", agents: [{ role: "developer", handle: "t.dev.1", run: 0, alive: true, start: 1700000000000, duration: 65000, tokens: 1234 }] };
makeHead.write();
assert.equal(headEls["c-tokens"].textContent, `${fmtTokens(1234)} · ${fmtDur(65000)}`, "the console head reads the tokens before the time");
assert.equal(subFetches.length, 1, "a run with no cached sub list starts exactly one fetch");
// #420 the pulse runs on one node: the live row's html stays byte-identical across a poll and
// only the slot's text moves, while a dead row keeps its values inline
const before = runsEl.innerHTML as string;
const slot = liveSpans[0];
runs.open = { file: "000263_task.md", agents: [{ role: "developer", handle: "t.dev.1", run: 0, alive: true, start: 1700000000000, duration: 66000, tokens: 1244 }] };
runs.writeRuns();
assert.equal(runsEl.innerHTML, before, "a poll that only advances the numbers keeps the live row's html");
assert.equal(liveSpans[0], slot, "the unchanged html keeps the slot node itself");
assert.equal(slot.textContent, [new Date(1700000000000).toLocaleTimeString(), fmtTokens(1244), fmtDur(66000)].join(" · "), "the slot's text moves to the new numbers");
const sameNode = slot.firstChild;
runs.writeRuns();
assert.equal(slot.firstChild, sameNode, "an unchanged poll leaves the slot's text node in place");
runs.open = { file: "000263_task.md", agents: [{ role: "developer", handle: "t.dev.1", run: 0, alive: true }] };
runs.writeRuns();
assert.ok((runsEl.innerHTML as string).includes('data-live-handle="t.dev.1"'), "an alive run with no numbers still renders its slot");
assert.equal(liveSpans[0].textContent, "", "a live run with no numbers leaves its slot empty, with no stray separator");
runs.open = { file: "000263_task.md", agents: [{ role: "developer", handle: "t.dev.1", run: 0, alive: false, status: "dead", start: 1700000000000, duration: 65000, tokens: 1234 }] };
runs.writeRuns();
assert.ok(!(runsEl.innerHTML as string).includes("data-live-handle"), "a dead run renders no live slot");
assert.ok((runsEl.innerHTML as string).includes(fmtTokens(1234)) && (runsEl.innerHTML as string).includes(fmtDur(65000)), "a dead run keeps its values inline");
// #420 an alive doctor row is a live run row too, so its numbers fill its slot in place
runs.open = { file: "000263_task.md", agents: [], doctors: [{ role: "doctor", run: 0, alive: true, status: "live", handle: "t.dev.1.doctor", start: 1700000000000, duration: 9000, tokens: 77 }] };
runs.writeRuns();
assert.equal(liveSpans.length, 1, "an alive doctor row renders one live slot");
assert.equal(liveSpans[0].textContent, [new Date(1700000000000).toLocaleTimeString(), fmtTokens(77), fmtDur(9000)].join(" · "), "an alive doctor's numbers fill its slot in place");
runs.open = { file: "000263_task.md", agents: [{ role: "developer", handle: "t.dev.1", run: 0, alive: true, start: 1700000000000, duration: 65000, tokens: 1234 }] };
runs.writeRuns();
const rowOf = new Function("esc", "fmtDur", "fmtTokens", "logState", "ROLE_CLS", "startText", "runMeta", page.slice(page.indexOf("function runRowHtml("), page.indexOf("// the subagent rows of one run")) + "; return runRowHtml;")(esc, fmtDur, fmtTokens, runLog, { developer: "agent-developer", reviewer: "agent-reviewer" }, (ms: number) => "T" + ms,
	new Function("startText", "fmtTokens", "fmtDur", page.match(/const runMeta = .*?\n/)![0] + "; return runMeta;")((ms: number) => "T" + ms, fmtTokens, fmtDur));
assert.ok(rowOf({ role: "developer", handle: "d", status: "dead", tokens: 0, duration: 0 }, "", "Developer", null).includes("agent-dead"), "a dead run keeps its red marker");
assert.ok(rowOf({ role: "developer", handle: "d", status: "dead", tokens: 0, duration: 0 }, "", "Developer", null).includes("cross"), "the dead marker is the cross");
assert.ok(rowOf({ role: "developer", handle: "d", status: "done", tokens: 0, duration: 0 }, "", "Developer", null).includes("agent-past"), "a finished run keeps the past marker");
// #415 the three marks share one slot, so the role label starts at the same x in every state
const runMarkOf = (a: any) => ((rowOf({ role: "developer", handle: "d", tokens: 0, duration: 0, ...a }, "", "Developer", null) as string).match(/<span class="run-mark">.*?<\/span><\/span>/) as string[])[0];
assert.equal(runMarkOf({ alive: true }), '<span class="run-mark"><span class="spin"></span></span>', "a live run wraps its dot in the shared slot");
assert.ok(runMarkOf({ status: "dead" }).startsWith('<span class="run-mark"><span class="cross">'), "a dead run wraps its cross in the same slot");
assert.ok(runMarkOf({ status: "done" }).startsWith('<span class="run-mark"><span class="check">'), "a past run wraps its check in the same slot");
// #419 the marks take the row's agent tint, which the .agent-* rules set on the row
assert.ok(rowOf({ role: "developer", handle: "d", status: "done", tokens: 0, duration: 0 }, "", "Developer", null).includes("agent-developer"), "a developer run wears its agent tint");
assert.ok(rowOf({ role: "reviewer", handle: "r", status: "done", tokens: 0, duration: 0 }, "", "Reviewer", null).includes("agent-reviewer"), "a reviewer run wears its agent tint");
runs.subCache["t.dev.1"] = [{ index: 0, tokens: 10, duration: 2000 }, { index: 1, tokens: 0, duration: 0 }];
runs.writeRuns();
assert.ok(runsEl.innerHTML.includes('data-sub="0"') && runsEl.innerHTML.includes('data-sub="1"'), "the subagent rows stack under their run, each with its sub index");
assert.equal(subFetches.length, 1, "the cached sub list means no second fetch");
assert.ok(runsEl.innerHTML.includes("Sub-developer"), "a sub row names itself under its run's role");
runLog.handle = "t.dev.1";
runLog.sub = 1;
runsEl.__html = undefined;
runs.writeRuns();
assert.ok((runsEl.innerHTML as string).includes("agent-row-active"), "the row that matches the open console carries the active marker");

// #379 the panel's run tree: the doctor hangs under its run after the subagent rows, both at
// depth 1, and a doctor whose run is pruned renders after the last run under a label row
runLog.sub = null;
runsEl.__html = undefined;
runs.open = {
	file: "000263_task.md",
	agents: [{ role: "developer", handle: "t.dev.1", run: 0, alive: true, start: 1700000000000, duration: 65000, tokens: 1234 }],
	doctors: [
		{ role: "doctor", handle: "t.dev.1.doctor", run: 0, alive: false, status: "ok", duration: 1000, tokens: 5 },
		{ role: "doctor", handle: "t.dev.9.doctor", run: 9, alive: false, status: "ok", duration: 1000, tokens: 5 },
	],
};
runs.writeRuns();
const tree = runsEl.innerHTML as string;
assert.ok(
	tree.indexOf('data-handle="t.dev.1"') < tree.indexOf('data-sub="0"') && tree.indexOf('data-sub="1"') < tree.indexOf('data-handle="t.dev.1.doctor"'),
	"the run row comes first, its subagent rows next and its doctor last",
);
assert.ok(tree.includes('class="run-group run-group-live"'), "the group carries the live run's accent, so the guide follows the run");
assert.ok(
	tree.indexOf("no matching run") < tree.indexOf('data-handle="t.dev.9.doctor"') && tree.indexOf('data-handle="t.dev.9.doctor"') > tree.indexOf('data-handle="t.dev.1.doctor"'),
	"a doctor whose run is pruned renders after the last run under the label row, so nothing is lost",
);
assert.match(page, /\.run-row\.agent-sub, \.run-row\.agent-doctor \{[^}]*padding-left: var\(--sp-5\)/, "a child row indents one scale step under its run");
assert.ok(page.includes(".run-group-live { --guide: var(--link); }"), "a live run's guide takes the run-level accent");

// 16. the actions row: a done or unheld merging task offers no hold button, a held task offers
// Unhold, every other state Hold, no copy button remains, and a failed toggle re-enables the
// button
const actionsOf = new Function("esc", "numOf", "isHeld", page.match(/function actionsHtml\(t\) \{[\s\S]*?\n\}/)![0] + "; return actionsHtml;")(esc, (f: string) => parseInt(f.slice(0, 6), 10), isHeld) as (t: any) => string;
const file = "000263_task.md";
assert.ok(actionsOf({ state: "doing", file }).includes('"m-action m-block"') && actionsOf({ state: "doing", file }).includes("<rect"), "an unheld task offers Hold with the stop icon");
assert.ok(actionsOf({ state: "doing", file, blockedBy: "user" }).includes('"m-action m-unblock"') && actionsOf({ state: "doing", file, blockedBy: "user" }).includes("<path"), "a held task offers Unhold with the play icon");
assert.ok(!actionsOf({ state: "done", file, blockedBy: "user" }).includes("toggleHold") && !actionsOf({ state: "merging", file, blockedBy: "" }).includes("toggleHold"), "a done task offers no hold button, and neither does the merging task before a user hold");
assert.equal(actionsOf({ state: "done", file }), "", "a done task returns the empty string, so the :empty row collapses");
assert.equal(actionsOf({ state: "merging", file }), "", "a merging task before a user hold returns the empty string");
assert.ok(!actionsOf({ state: "doing", file, worktree: ".worktrees/x" }).includes("data-copy"), "a doing task offers no copy button");
assert.ok(!page.includes("copyText") && !page.includes("data-copy"), "the page has no copy helper and no copy button");
assert.ok(page.includes("writeGated(actions, actionsHtml(t))"), "the panel redraws the actions from the task through the html gate");
assert.ok(page.includes('"/api/task-block?num=" + numOf(panelFile) + projectParam()') && page.includes("body: JSON.stringify({ action })"), "the toggle posts the open task number and the action as JSON");
assert.ok(page.includes("btn.disabled = false"), "a failed toggle re-enables the button");
// the issuer row: a task-issued issuer links to its card when that task is on the active board;
// "user", the orchestrator's "auto", an absent issuer or an off-board number stays plain text
const issuerOf = new Function("esc", "numLinkHtml", "taskByNum", page.match(/function issuerCell\(t\) \{[\s\S]*?\n\}/)![0] + "; return issuerCell;")(esc, (f: string) => `[${f}]`, (ref: string) => (ref === "#42" ? { file: "000042_x.md" } : undefined)) as (t: any) => string;
assert.equal(issuerOf({ issuer: "#42" }), "[000042_x.md]", "a task-issued issuer links to its card");
assert.equal(issuerOf({ issuer: "auto" }), "auto", "an auto issuer stays plain text, never a task link");

// 17. the open path: the panel un-hides before the detail lands, the light row paints the shell
// while the heavy detail loads, the detail fetch precedes the history fetch, and a response that
// lands after another open is discarded
const openPanelSrc = page.match(/function openPanel\(t\) \{[\s\S]*?\n\}/)![0];
assert.ok(openPanelSrc.indexOf("showPanel()") < openPanelSrc.indexOf("fetch(detailUrl(t.file))"), "the panel un-hides before the detail request, so the loading line is on screen");
assert.ok(openPanelSrc.indexOf("fetch(detailUrl(t.file))") < openPanelSrc.indexOf("fetch(historyUrl(t.file))"), "the open path requests the light detail before the heavy history");
assert.ok(openPanelSrc.includes("panelFile !== t.file || !visible()"), "a detail that lands after another open is discarded");
const pollSrc = page.match(/function pollDetail\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(pollSrc.indexOf("fetch(detailUrl(file))") < pollSrc.indexOf("fetch(historyUrl(file))"), "the poll chains the detail before the history");
assert.ok(pollSrc.includes("panelFile !== d.file"), "a poll response for another file never paints");
const openTaskSrc = page.match(/function openTask\(file\) \{[\s\S]*?\n\}/)![0];
assert.ok(openTaskSrc.includes('location.hash = "task/" + t.num'), "a card click routes to the task number, so back closes the panel");

// 18. the console height: clamped between 120px and 60vh, rounded, persisted under one key, the
// assigned height exposed on the handle, and the page variable written only while the console shows
class StubEl {
	className = "";
	attrs: Record<string, string> = {};
	setAttribute(k: string, v: string) { this.attrs[k] = v; }
	classList = { contains: (c: string) => this.className.split(" ").includes(c) };
}
const heightSrc = page.slice(page.indexOf("const CONSOLE_KEY = "), page.indexOf("try { const stored = Number(localStorage"));
const heightStore: Record<string, string> = {};
const makeHeight = (visible: boolean, narrow = false) => {
	const consoleEl = new StubEl();
	const handleEl = new StubEl();
	if (!visible) consoleEl.className = "hidden";
	const vars: Record<string, string> = {};
	const api = new Function("document", "innerHeight", "localStorage", "verticalSpine", heightSrc + "\n; return { applyConsoleH: applyConsoleH, get h() { return consoleH; } };")(
		{
			getElementById: (id: string) => (id === "console" ? consoleEl : id === "c-handle" ? handleEl : null),
			body: { style: { setProperty: (k: string, v: string) => { vars[k] = v; } } },
		},
		900,
		{ setItem: (k: string, v: string) => { heightStore[k] = v; } },
		() => narrow,
	);
	return { api, handleEl, consoleEl, vars };
};
const shown = makeHeight(true);
shown.api.applyConsoleH(10);
assert.equal(shown.api.h, 120, "a drag below the floor clamps to the 120px minimum");
shown.api.applyConsoleH(9999);
assert.equal(shown.api.h, 540, "a drag above the ceiling clamps to 60 percent of the viewport");
shown.api.applyConsoleH(300);
assert.equal(shown.vars["--console-h"], "300px", "the visible console carries its height in the page variable");
assert.equal(shown.handleEl.attrs["aria-valuenow"], "300", "the handle exposes its position to assistive technology");
assert.equal(shown.handleEl.attrs["aria-valuemin"], "120", "the handle names the minimum");
assert.equal(shown.handleEl.attrs["aria-valuemax"], "540", "the handle names the maximum");
assert.equal(heightStore.consoleHeight, "300", "the height persists under one key");
const hiddenHeight = makeHeight(false);
hiddenHeight.api.applyConsoleH(300);
assert.deepEqual(hiddenHeight.vars, {}, "a closed console writes no height, so the panel keeps the full viewport");
// #405 the phone sheet floors at the collapsed height and carries its own variable, so the two widths
// never write each other's height
const phoneHeight = makeHeight(true, true);
phoneHeight.api.applyConsoleH(10);
assert.equal(phoneHeight.api.h, 92, "a phone drag below the floor clamps to the collapsed 92px sheet, not the desktop 120px");
assert.equal(phoneHeight.handleEl.attrs["aria-valuemin"], "92", "the phone handle names the same 92px minimum the drag clamps to");
phoneHeight.api.applyConsoleH(300);
assert.deepEqual([phoneHeight.vars["--console-h-touch"], phoneHeight.vars["--console-h"]], ["300px", undefined], "at phone width the drag writes the touch height only, so the desktop dock keeps its own");

// 19. the routing: an empty hash closes the panel, #task/<num> opens the matching task once the
// board has served, an unknown number writes the not-found line, and a superseded response never
// paints into the open panel
const routeSrc = page.slice(page.indexOf("function syncRoute() {"), page.indexOf("const visible = () =>"));
const panelEl = { className: "hidden" as string, classList: { contains: (c: string) => panelEl.className.split(" ").includes(c) } };
const nav = { opened: [] as any[], notFound: [] as number[], closed: 0, view: [] as boolean[], board: { tasks: [{ file: "000263_task.md", num: 263 }] }, served: false };
const route = new Function("document", "location", "activeBoard", "openPanel", "writeNotFound", "hidePanel", "visible", "numOf", "showView",
	'let routeNum = null, panelFile = null, notFoundNum = null, served = false;\n' + routeSrc +
	"\n; return { syncRoute: syncRoute, hashNum: hashNum, set served(v) { served = v; }, set file(v) { panelFile = v; } };")(
	{ getElementById: () => panelEl },
	{ get hash() { return nav.hash; } },
	() => nav.board,
	(t: any) => nav.opened.push(t.file),
	(n: number) => nav.notFound.push(n),
	() => { nav.closed++; },
	() => false,
	(f: string) => parseInt(f.slice(0, 6), 10),
	(archive: boolean) => nav.view.push(archive),
);
nav.hash = "#task/263";
assert.equal(route.hashNum(), 263, "a task hash resolves to its number");
for (const bad of ["", "#other", "#task/", "#task/x", "#task/0"]) {
	nav.hash = bad;
	assert.equal(route.hashNum(), null, "a hash that is not a task route resolves to null");
}
nav.hash = "";
panelEl.className = ""; // an open panel: the empty hash closes it
route.syncRoute();
assert.equal(nav.closed, 1, "an empty hash closes the open panel");
assert.deepEqual(nav.view, [false], "an empty hash shows the board");
nav.hash = "#archive";
route.syncRoute();
assert.deepEqual(nav.view, [false, true], "the archive hash shows the archive view");
panelEl.className = "hidden";
nav.hash = "#task/263";
route.syncRoute();
assert.deepEqual(nav.opened, ["000263_task.md"], "#task/263 opens that task");
nav.hash = "#task/999";
route.served = false;
route.syncRoute();
assert.deepEqual(nav.notFound, [], "an unknown number shows nothing before the board has served");
route.served = true;
route.syncRoute();
assert.deepEqual(nav.notFound, [999], "once the board has served, an unknown number writes the not-found line");
const pollGate = new Function("document", "fetch", "detailUrl", "historyUrl", "openDetail", "panelFile", "writePanel", "markLiveLine", "visible",
	page.match(/function pollDetail\(\) \{[\s\S]*?\n\}/)![0] + "; return pollDetail;")(
	{},
	() => Promise.resolve({ ok: true, json: () => Promise.resolve({ file: "000999_other.md", body: "x" }) }),
	(f: string) => "/d?" + f,
	(f: string) => "/h?" + f,
	{ file: "000263_task.md" },
	"000263_task.md",
	() => { throw new Error("a superseded poll response painted into the panel"); },
	() => {},
	() => true,
);
await pollGate();

// 20. #368 the filter bar: the codec round-trips every field, a corrupt value decodes to no filter,
// and the matcher reads the priority, the complexity, the issuer, the hold and live
const allFilters = { q: "café 263", priorities: ["high", "low"], complexities: ["moderate", "complex"], issuer: "user", held: true, live: true };
assert.deepEqual(decodeFilters(encodeFilters(allFilters)), allFilters, "the filter encoding round-trips every field, a unicode query and two chips per group included");
// #378 a link that still carries the retired phase key keeps its other keys
assert.deepEqual(decodeFilters(btoa(JSON.stringify({ q: "x", p: ["work", "done"], pr: ["high"], i: "user" }))), { q: "x", priorities: ["high"], complexities: [], issuer: "user", held: false, live: false }, "a legacy phase key in an old link is ignored, never the whole filter");
assert.deepEqual([decodeFilters(encodeFilters(emptyFilters())), decodeFilters(""), decodeFilters(null), decodeFilters("!!!!"), decodeFilters("e30=")].map(filtersActive), [false, false, false, false, false], "an empty, absent, unreadable or non-object filter value decodes to no filter");
// #382 the bar shows one user chip, so a retired issuer value in an old link must not filter the board
const issuerOfLink = (i: string) => decodeFilters(btoa(JSON.stringify({ i }))).issuer;
assert.equal(issuerOfLink("auto"), "", "a legacy auto issuer decodes to no issuer filter");
assert.equal(issuerOfLink("#366"), "", "a legacy task-issued issuer decodes to no issuer filter");
assert.equal(issuerOfLink("user"), "user", "the user issuer survives a decode");
const hostile = btoa(JSON.stringify({ q: 5, p: ["work", "nope"], pr: "high", cx: ["complex", 7], i: {}, h: "yes", l: true }));
assert.deepEqual(decodeFilters(hostile), { q: "", priorities: [], complexities: ["complex"], issuer: "", held: false, live: true }, "a value of the wrong shape keeps only the well-typed fields and never throws");
const filterRows = [
	{ file: "000263_docked.md", name: "feat: docked panel", summary: "the console moves", state: "reviewing", priority: "high", complexity: "moderate", issuer: "user", updated: 3, agents: [{ alive: true }] },
	{ file: "000300_old.md", name: "fix: old thing", summary: "a repair", state: "done", priority: "low", complexity: "simple", issuer: "#263", updated: 9 },
];
const filesOf = (rows: any[]) => rows.map((t) => t.file);
assert.equal(filterTasks(filterRows, emptyFilters()), filterRows, "no active filter passes the payload through untouched");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), q: "#263" })), ["000263_docked.md"], "a number query matches the task number");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), q: "console" })), ["000263_docked.md"], "the text query reads the summary as well as the name");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), priorities: ["low", "high"] })), ["000263_docked.md", "000300_old.md"], "#378 a second priority chip widens the set instead of replacing it");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), priorities: ["low"], complexities: ["simple"] })), ["000300_old.md"], "the priority and complexity chip groups narrow together");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), issuer: "#263" })), ["000300_old.md"], "the issuer filter matches the stored issuer");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), issuer: "user" })), ["000263_docked.md"], "#378 the user chip hides the auto and task-issued work");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), held: true })), [], "held only drops an unheld task");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), live: true })), ["000263_docked.md"], "has live agent keeps the task with the live run");
assert.ok(filterReason({ ...emptyFilters(), q: "x", held: true }).startsWith("no task matches: ") && filterReason(emptyFilters()) === "", "the empty reason names the active filters, and stays empty when nothing filters");
assert.deepEqual([emptyFilters(), { ...emptyFilters(), q: "x", held: true }, { ...emptyFilters(), priorities: ["high", "low"], complexities: ["complex"], issuer: "user", live: true }].map(filtersCount), [0, 2, 5], "the phone button's badge counts one step per active filter dimension");
assert.equal(matchesFilters(filterRows[0], { ...emptyFilters(), priorities: ["high"], complexities: ["moderate"] }), true, "the membership test the panel's outside-filter notice runs reads the same filter");
assert.equal(matchesFilters(filterRows[1], { ...emptyFilters(), issuer: "user" }), false, "a task-issued task sits outside the user chip");

// 21. #368 the command palette: a subsequence match over the name and the number, the 12-result cap
// with the +N more count, and an empty query naming the newest tasks
const palRows = Array.from({ length: 30 }, (_, i) => ({ file: `${1000 + i}_task.md`, name: `feat: task ${i}`, state: "to-do", updated: i }));
const cappedHits = paletteResults(palRows, "task");
assert.equal(PALETTE_MAX, 12, "the palette caps its result list at 12");
assert.equal(cappedHits.hits.length, 12, "a query matching 30 tasks returns 12 rows");
assert.equal(cappedHits.more, 18, "the dim line counts the results past the cap");
assert.equal(cappedHits.hits[0].file, "1029_task.md", "equal scores fall back to the newest update");
assert.deepEqual(filesOf(paletteResults(palRows, "#1003").hits), ["1003_task.md"], "an exact number query finds the task, with or without the hash");
assert.equal(paletteResults([{ file: "000263_docked.md", name: "feat: docked panel", state: "reviewing", updated: 1 }], "ftp").hits.length, 1, "the fuzzy match reads the name as a subsequence");
assert.equal(paletteResults(palRows, "zzz").hits.length, 0, "no match returns no rows");
assert.equal(paletteResults(palRows, "").hits.length, 12, "an empty query still fills the newest 12 rows");
assert.equal(paletteResults([], "x").more, 0, "an empty project has no more line");

// 22. #368 the done archive: only done tasks, newest update first, 50 rows per page with a footer
assert.equal(ARCHIVE_PAGE, 50, "the archive page size constant is 50");
const doneRows = Array.from({ length: 120 }, (_, i) => ({ file: `${2000 + i}_done.md`, name: `done ${i}`, state: "done", updated: i }));
const archived = archiveTasks([...doneRows, { file: "000999_open.md", name: "open", state: "doing", updated: 500 }], emptyFilters());
assert.equal(archived.length, 120, "the archive holds only done tasks");
assert.equal(archived[0].updated, 119, "the archive lists the newest update first");
const firstPage = archivePage(archived, 0);
assert.deepEqual([firstPage.page, firstPage.pages, firstPage.start, firstPage.end, firstPage.rows.length], [0, 3, 0, 50, 50], "the first page holds 50 rows of three");
const lastPage = archivePage(archived, 5);
assert.deepEqual([lastPage.page, lastPage.start, lastPage.end, lastPage.rows.length], [2, 100, 120, 20], "the last page holds the remainder and a page past the end clamps");
assert.deepEqual([archivePage([], 0).pages, archivePage([], 0).rows.length], [1, 0], "an empty archive names one empty page");
assert.deepEqual(filesOf(archiveTasks(filterRows, emptyFilters())), ["000300_old.md"], "the archive applies the active filter too");

// 23. the served chrome: one filter bar above the spine, the labelled palette dialog over the panel,
// the archive section, the debounce and the Done overflow that opens the archive
for (const id of ["filters", "f-q", "f-prio", "f-cx", "f-user", "f-held", "f-live", "f-clear", "palette", "pal-input", "pal-list", "pal-empty", "pal-more", "archive", "arch-count", "arch-list", "arch-empty", "arch-page", "arch-more", "arch-newer", "arch-back", "p-outside"])
	assert.ok(page.includes(`id="${id}"`), `the page serves #${id}`);
// #378 the two chip groups replace the native multi-selects and the phase chips, and one user chip
// replaces the 61-option issuer select
assert.ok(!page.includes("<select") && !page.includes('id="f-issuer"'), "#378 no select remains in the bar, so neither a multiple select nor the issuer select does");
assert.ok(!page.includes('id="f-phases"') && !page.includes("togglePhase"), "#378 the seven phase chips are gone from the markup and the client");
assert.ok(page.includes('id="f-prio" class="f-group" role="group" aria-label="Priority"') && page.includes('id="f-cx" class="f-group" role="group" aria-label="Complexity"'), "#378 priority and complexity are labelled chip groups");
assert.ok(page.includes('id="f-user" class="f-chip" aria-pressed="false">user<'), "#378 one user chip replaces the issuer select");
assert.ok(page.indexOf('id="f-q"') < page.indexOf('id="f-prio"') && page.indexOf('id="f-prio"') < page.indexOf('id="f-cx"') && page.indexOf('id="f-cx"') < page.indexOf('id="f-user"') && page.indexOf('id="f-user"') < page.indexOf('id="f-held"'), "#378 the bar reads search, priority, complexity, user, held left to right");
// #412 every chip sits in a group with a visible label, and the priority order runs lowest to highest
assert.equal(filtersMod.FILTER_PRIORITIES.join(), "low,medium,high,critical", "#412 the priority chips read low to critical");
const barGroups = [...page.matchAll(/<div class="f-group" role="group" aria-label="(\w+)">([\s\S]*?)<\/div>/g)].map((m) => ({ name: m[1], inner: m[2] }));
assert.deepEqual(barGroups.map((g) => g.name), ["Issuer", "State"], "#412 the loose chips sit in two labelled groups");
assert.deepEqual(barGroups.filter((g) => !g.inner.includes(`<span class="f-label" aria-hidden="true">${g.name.toLowerCase()}</span>`)).map((g) => g.name), [], "#412 each static group leads with its own label, aria-hidden so the group name reads once");
assert.deepEqual([...barGroups[1].inner.matchAll(/id="(f-[a-z]+)"/g)].map((m) => m[1]), ["f-held", "f-live"], "#412 the state group holds held and live");
const chipsSource = page.match(/function renderChips\(id, field\) \{[\s\S]*?\n\}/);
assert.ok(chipsSource, "#412 the client ships the chip renderer");
assert.match(chipsSource![0], /<span class="f-label" aria-hidden="true">' \+ CHIP_LABEL\[field\]/, "#412 the two rendered groups lead with their label too, so all four groups carry one");
assert.match(themeCss, /\.f-label \{[^}]*color: var\(--dim\)/, "#412 a group label takes the dim hue");
assert.match(themeCss, /\.f-group \{[^}]*align-items: center/, "#412 a group centres its label on the chips");
assert.match(themeCss, /#filters \{[^}]*gap: 6px 12px/, "#412 the bar widens the column gap, so one group breaks from the next");
// #412 the URL write is absolute: a fragment-only reference keeps the query, so an emptied filter must
// not write the hash alone, or a reload restores the filter that was just cleared
const saveSource = page.match(/function saveFilters\(\) \{[\s\S]*?\n\}/);
assert.ok(saveSource, "#412 the client ships the filter URL writer");
const saveOf = (state: any, loc: any) => {
	let written: string | null = null;
	new Function("filters", "filtersActive", "encodeFilters", "history", "localStorage", "location", saveSource![0] + "; return saveFilters;")(
		state, filtersActive, encodeFilters, { replaceState: (_a: unknown, _b: unknown, url: string) => { written = url; } }, { setItem: () => {} }, loc)();
	return written;
};
assert.equal(saveOf(emptyFilters(), { pathname: "/board", hash: "#hash" }), "/board#hash", "#412 an emptied filter drops the ?f= query instead of keeping it");
assert.ok(saveOf({ ...emptyFilters(), priorities: ["high"] }, { pathname: "/board", hash: "" })!.startsWith("/board?f="), "#412 a set filter writes its query under the pathname");
assert.match(themeCss, /\.f-chip \{[^}]*min-height: 28px/, "#378 a desktop chip clears the 28px pointer floor");
for (const hue of ["pr-critical", "pr-high", "pr-medium", "pr-low", "cx-trivial", "cx-simple", "cx-moderate", "cx-complex"])
	assert.ok(themeCss.includes(`.f-chip.${hue}[aria-pressed="true"]`), `#378 a pressed ${hue} chip takes its own value hue`);
// one click applies: the second chip joins the set and a second click drops it, against the served source
const chipSource = page.match(/function toggleChip\(field, value\) \{[\s\S]*?\n\}/);
assert.ok(chipSource, "#378 the client ships the chip toggle");
const chipFilters = { ...emptyFilters(), priorities: ["high"] };
let chipApplied = 0;
const toggleChip = new Function("filters", "applyFilters", chipSource![0] + "; return toggleChip;")(chipFilters, () => chipApplied++) as (field: string, value: string) => void;
toggleChip("priorities", "critical");
assert.deepEqual([chipFilters.priorities, chipApplied], [["high", "critical"], 1], "#378 a second priority chip adds to the set and applies on that click");
toggleChip("priorities", "high");
assert.deepEqual([chipFilters.priorities, chipApplied], [["critical"], 2], "#378 clicking an active chip removes it from the set");
assert.ok(page.indexOf('id="filters"') > page.indexOf('id="tabs"') && page.indexOf('id="filters"') < page.indexOf('id="board"'), "the filter bar is one row above the spine");
assert.ok(page.includes('data-value="') && page.includes('String(chosen.includes(b.dataset.value))'), "#378 a chip carries its value and reads its pressed state from the filter");
assert.ok(page.indexOf('id="archive"') > page.indexOf('id="board"') && page.indexOf('id="archive"') < page.indexOf('id="panel"'), "the archive replaces the spine, above the panel in the body");
assert.ok(page.includes('id="palette" class="hidden" role="dialog" aria-modal="true" aria-label="Find a task"'), "the palette is a labelled modal dialog");
assert.ok(page.includes("input.focus()") && page.includes('id="pal-input" type="text" role="combobox"'), "the palette autofocuses a combobox input");
assert.ok(page.includes("FILTER_DEBOUNCE = " + FILTER_DEBOUNCE) && FILTER_DEBOUNCE === 120, "the text input debounces at 120 ms");
assert.ok(page.includes("localStorage.getItem(FILTERS_KEY)") && page.includes('new URLSearchParams(location.search)'), "the filter state reads the URL first and localStorage second");
assert.ok(page.includes('id === "done" ? openArchive'), "the Done overflow opens the archive instead of unfolding in place");
assert.ok(!readFileSync(new URL("../../src/webui/board.ts", import.meta.url), "utf8").includes("unfolds in place"), "the spine's temporary done comment is gone");
assert.ok(page.includes("writeOutside(t)") && page.includes("matchesFilters(t, filters)"), "the panel notices a task the active filter hides");
assert.ok(page.includes('h === "archive"') && page.includes('location.hash = archiveView ? "archive" : ""'), "the archive is a hash route and closing a task opened from it returns to the archive");
for (const fn of [encodeFilters, decodeFilters, emptyFilters, filtersActive, matchesFilters, filterTasks, filterReason, paletteResults, archiveTasks, archivePage]) assert.ok(page.includes(String(fn)), `the page ships ${fn.name || "the helper"}`);

// 24. #369 the motion layer: one token set, one reduced-motion block, one policy attribute the system
// ask alone can force to none, and every duration and easing read from a token. Only two pre-existing
// effects animate a property other than transform or opacity. #377 drops the live/purposeful/none
// selector: live is the default and the system preference the only override
const motionCss = themeCss;
for (const tok of ["--t-fast: 120ms", "--t-base: 180ms", "--t-slow: 240ms", "--t-breathe: 2s", "--t-wave: 12s", "--t-slot: calc(var(--t-wave) / 7)", "--ease-enter:", "--ease-exit:"])
	assert.ok(tokenBlocks[0].includes(tok), `the light :root block declares ${tok.split(":")[0]}, the one motion token set`);
const stripVars = (s: string) => s.replace(/var\(--[\w-]+(?:,[^)]*)?\)/g, "");
const ruleBodies = [...motionCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const timed = ruleBodies.filter((r) => /(^|;)\s*(animation|transition)(-[a-z]+)?\s*:/.test(r.body));
assert.ok(timed.length >= 8, "the stylesheet carries the animating rules the audit reads");
assert.deepEqual(timed.filter((r) => /\d+m?s\b/.test(stripVars(r.body))).map((r) => r.sel), [], "every animation and transition duration reads a motion token, no raw milliseconds outside the token block");
assert.deepEqual(timed.filter((r) => /\b(cubic-bezier|ease|ease-in|ease-out|ease-in-out|steps)\b/.test(stripVars(r.body))).map((r) => r.sel), [], "every easing reads a motion token too, the linear keyword aside");
const kfLines = motionCss.split("\n").filter((l) => l.startsWith("@keyframes"));
assert.ok(kfLines.length >= 6, "the keyframes the audit reads are declared");
const kfProps = (line: string) => [...line.replace(/@keyframes [\w-]+/, "").matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
assert.deepEqual([...new Set(kfLines.flatMap(kfProps).filter((p) => p !== "opacity" && p !== "transform"))].sort(), ["background-position", "stroke-dashoffset"], "only the two pre-existing effects, the SVG dash flow and the letter-band shimmer, animate a property other than transform or opacity");
assert.equal((page.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).length, 1, "the stylesheet keeps exactly one reduced-motion block");
assert.equal((page.match(/prefers-reduced-motion/g) ?? []).length, 2, "the page names the reduced-motion ask once in the stylesheet and once in the policy store");
assert.match(motionCss, /\[data-motion="none"\][^{]*\{[^}]*animation: none !important[^}]*transition: none !important/, "the none policy disables every animation and transition, the inlined FLIP travel included");
const desktopSheet = motionCss.slice(0, motionCss.indexOf(`@media (max-width: ${MOBILE_MAX}px)`));
const phoneSlice = motionCss.slice(motionCss.indexOf(`@media (max-width: ${MOBILE_MAX}px)`));
const spineRule = ruleBodies.find((r) => r.sel === ".spine")!;
const barLadder = spineRule.body.match(/background-image: linear-gradient\(90deg,[^;]*/)?.[0] ?? "";
assert.deepEqual([...barLadder.matchAll(/var\((--accent-[\w-]+)\)/g)].map((m) => m[1]).filter((v, i, a) => v !== a[i - 1]), ["--accent-backlog", "--accent-todo", "--accent-review", "--accent-merge", "--accent-live", "--accent-integration", "--accent-done"], "the one bar carries the seven station tints in pipeline order, one fixed equal slot each");
assert.ok(!/animation/.test(spineRule.body) && spineRule.sel === ".spine", "the ladder paints in every motion mode: the bar rule takes no motion gate and no animation");
const headZ = Number(motionCss.match(/^\.st-head \{[^}]*z-index: (\d+)/m)?.[1] ?? NaN), spineZ = Number(spineRule.body.match(/z-index: (\d+)/)?.[1] ?? NaN);
assert.ok(spineZ > headZ, "the bar paints above the head ticks, so the 1px crossing at each junction does not cut the line");
assert.ok(!/@keyframes sweep\b/.test(motionCss) && !declared.has("--t-sweep"), "the old sweep keyframe and its token are gone");
const barBand = motionCss.match(/\[data-motion="live"\] \.spine::after \{([^}]*)\}/)?.[1] ?? "";
assert.match(barBand, /animation: beamRun var\(--t-wave\) linear infinite/, "the band crosses the bar once over the wave token, so one pass covers the full board");
const beamToken = tokenBlocks[0].match(/--beam:\s*([\d.]+)%/)?.[1];
assert.equal(beamToken, "85", "--beam is the spine band white mix at 85%");
const shineToken = tokenBlocks[0].match(/--shine:\s*([\d.]+)%/)?.[1];
assert.equal(shineToken, "45", "--shine stays 45%, so the card and console highlights cannot drift with the bar");
const spineBandRule = ruleBodies.find((r) => r.sel === ".spine::after")!;
assert.ok(/var\(--beam\)/.test(spineBandRule.body) && !/var\(--shine\)/.test(spineBandRule.body), "the spine band reads --beam, never the 45% --shine of the card and console");
const bandWidth = spineBandRule.body.match(/width:\s*([\d.]+)%/)?.[1];
const beamTravel = motionCss.match(/@keyframes beamRun \{ from \{ transform: translateX\(-100%\); \} to \{ transform: translateX\(([\d.]+)%\); \} \}/)?.[1];
assert.ok(bandWidth && beamTravel, "the band width and the beamRun travel are both declared");
assert.ok(Math.abs(Number(beamTravel) - 100 / (Number(bandWidth) / 100)) < 1e-3, "the band travel equals 100 / its own width, so the pair can never drift apart on its own");
assert.match(motionCss, /\.spine::after \{[^}]*opacity: 0;/, "the band rests hidden, so motion none and reduced motion paint the ladder with no band");
assert.match(barBand, /opacity: 1/, "the live gate alone reveals the band, so its shine never paints on a motion-off sheet");
assert.ok(!/\.st-head::after/.test(desktopSheet) && /\.st-head::after \{[^}]*top: -1px/.test(phoneSlice), "the desktop board carries one continuous bar and no per-head glow, while the phone keeps its glow on the head rule");
assert.match(motionCss, /\[data-motion="live"\] \.spin \{[^}]*animation: breathe var\(--t-breathe\) var\(--ease-breathe\)/, "the running dot breathes over the 2 s token");
assert.match(motionCss, /^\.card\.running \{ --p: 0; \}/m, "the running card starts at zero in both motion modes");
assert.match(motionCss, /^\.card\.running::after \{[^}]*transform: scaleX\(var\(--p\)\)/m, "the progress line advances by a scale transform, never a width");
assert.ok(!/^\.card\.running::after \{[^}]*animation/m.test(motionCss), "the geometry rule paints in both motion modes, so no animation sits in it");
assert.match(motionCss, /^\[data-motion="live"\] \.card\.running::after \{[^}]*background-size: 300% 100%[^}]*animation: shimmer var\(--t-breathe\) linear infinite/m, "the live line takes the streaming log's band, and the shine is the only live part of it");
assert.ok(!/\.running::after \{[^}]*width: calc/.test(motionCss), "the progress line never animates its width");
const pausedRule = motionCss.match(/html\.motion-paused [^{]+\{[^}]*animation-play-state: paused[^}]*\}/)?.[0] ?? "";
assert.ok(/\.spine::after/.test(pausedRule) && /\.st-head::after/.test(pausedRule) && page.includes('classList.toggle("motion-paused", document.hidden)'), "one paused rule freezes the bar and the head glow while the tab is hidden, and visibilitychange resumes them");
assert.match(motionCss, /\[data-motion="live"\] #c-text > \.pulse/, "the newest streaming line shines only in live mode, so historical lines never do");
assert.equal((page.match(/buildShell\(board, document\)/g) ?? []).length, 1, "the shell, and with it the heads the glow rides, is built once, so a poll never recreates it");
assert.ok(readFileSync(new URL("../../src/webui/board.ts", import.meta.url), "utf8").includes('el.classList.toggle("running"'), "the card pass marks the running card every poll on the node it keeps");
assert.match(page, /el\.style\.setProperty\("--p", String\(progressOf\(/, "the tick writes the progress line from progressOf, never a pixel share of the card width");
assert.ok(!/--p", String\([^)]*offsetWidth/.test(page) && page.includes("syncTicker") && page.includes("polledAt"), "nothing reads offsetWidth for progress, and the tick reseeds from the authoritative poll value");
const tickerSrc = page.slice(page.indexOf("function syncTicker() {"), page.indexOf("function tickCards() {"));
assert.ok(!tickerSrc.includes("tickCards()"), "the ticker only manages the interval: applyMotion calls it at init, before cardEls is declared, so a seed there throws a TDZ error");
assert.match(page, /polledAt = Date\.now\(\);\s*syncTicker\(\);[\s\S]{0,400}?\n\ttickCards\(\);/, "the poll tail seeds --p once, after syncBoard fills cardEls");
// #377 the selector is gone: no control, no mode list, no stored choice, no cycle handler
assert.ok(!page.includes('id="motion"'), "the served page carries no motion control");
assert.ok(!/MOTIONS|motionWant|cycleMotion|syncMotionBtn|MOTION_KEY/.test(page), "no motion list, stored choice or cycle handler survives");
assert.ok(!/data-motion="purposeful"/.test(motionCss), "the purposeful mode is gone from the stylesheet");
assert.match(motionCss, /@media \(prefers-reduced-motion: reduce\) \{ \[data-motion\]/, "the stylesheet keeps the reduced-motion block that turns every animation off");
assert.match(page, /function syncTicker\(\) \{[\s\S]{0,200}?if \(document\.hidden\) return;/, "the ticker runs whenever the tab is visible, whatever the motion mode");
// the reduced-motion path stays: the system ask forces none and the JS gates read the same helper
const motionSrc = page.slice(page.indexOf("const reduceMq = "), page.indexOf("const inline = "));
const makeMotion = (reduce: boolean) => {
	const rootEl = { dataset: {} as Record<string, string> };
	const mq = { matches: reduce, addEventListener() {} };
	const api = new Function("rootEl", "matchMedia", "document", "syncTicker", motionSrc +
		"\n; return { applyMotion: applyMotion, noMotion: noMotion };")(
		rootEl,
		() => mq,
		{ addEventListener() {} },
		() => {},
	) as any;
	return { api, rootEl };
};
assert.equal(makeMotion(false).rootEl.dataset.motion, "live", "the policy defaults to live with no stored choice");
assert.equal(makeMotion(false).api.noMotion(), false, "the default state animates");
assert.equal(makeMotion(true).rootEl.dataset.motion, "none", "the system reduced-motion ask forces the none state");
assert.equal(makeMotion(true).api.noMotion(), true, "the one helper the JS gates read answers for the system ask");

// #397 the liveness mark is a circle on the station accent's -text step, not a spinner ring: the pulse
// fades on opacity alone, the dead rotate keyframes and its token go
const spinRule = ruleBodies.find((r) => r.sel === ".spin")!;
assert.match(spinRule.body, /width: 7px; height: 7px/, "the liveness mark is a 7px circle, not a 9px ring");
assert.match(spinRule.body, /border: 0;/, "the mark paints no ring frame");
assert.match(spinRule.body, /border-radius: 50%;/, "the mark has round corners");
assert.match(spinRule.body, /background: var\(--ac-t, var\(--ac, var\(--link\)\)\)/, "the mark fills from the station accent's -text step, falling back to the link colour in the panel");
assert.match(motionCss, /\.s-work \{ --ac: var\(--accent-todo\); --ac-t: var\(--accent-todo-text\); --ac-prev: var\(--accent-backlog\); \}/, "each station points --ac-t at its accent's contrast-safe step and --ac-prev at the station before it");
assert.match(motionCss, /\.st-head h2 \.spin \{ margin-right: 0; \}/, "the head's flex gap owns the space, so the dot drops its own right margin");
// #415 one fixed slot for the run marks, and two close buttons that never shrink under their label
const markSlot = ruleBodies.find((r) => r.sel === ".run-row > .run-mark")!;
assert.match(markSlot.body, /flex: 0 0 11px;/, "the run mark takes one fixed 11px slot, so the role label never moves with its width");
assert.match(markSlot.body, /display: inline-flex; justify-content: center;/, "the slot centres the glyph and keeps its baseline");
const innerMark = ruleBodies.find((r) => r.sel === ".run-mark > .spin, .run-mark > .check, .run-mark > .cross")!;
assert.match(innerMark.body, /margin-right: 0;/, "the slot owns the gap, so the inner mark drops its own right margin");
// #419 the check and the dot inherit the row's agent colour instead of a priority green and the link blue
const checkRule = ruleBodies.find((r) => r.sel === ".check")!;
assert.doesNotMatch(checkRule.body, /color:/, "the check paints no colour of its own, so it never falls back to a priority colour");
const runSpin = ruleBodies.find((r) => r.sel === ".run-mark > .spin")!;
assert.match(runSpin.body, /background: currentColor;/, "the run's dot reads the row's tint, not the link blue");
assert.match(ruleBodies.find((r) => r.sel === ".agent-developer")!.body, /color: var\(--accent-todo-text\)/, "the developer tint is the readable -text step");
assert.match(ruleBodies.find((r) => r.sel === ".agent-reviewer")!.body, /color: var\(--accent-review-text\)/, "the reviewer tint is the readable -text step");
assert.match(ruleBodies.find((r) => r.sel === ".cross")!.body, /color: var\(--error-text\)/, "the cross stays red");
assert.equal(ruleBodies.find((r) => r.sel === "#p-close")!.body.match(/flex: ([^;]+);/)![1], "0 0 auto", "the panel's close button never shrinks under its label");
assert.equal(ruleBodies.find((r) => r.sel === "#c-close")!.body.match(/flex: ([^;]+);/)![1], "0 0 auto", "the console's close button never shrinks under its label");
assert.match(motionCss, /@keyframes breathe \{ 0%, 100% \{ opacity: 1; \} 50% \{ opacity: \.4; \} \}/, "the pulse fades on opacity alone, so the circle never changes size");
assert.ok(!/@keyframes spin /.test(motionCss) && !declared.has("--t-spin"), "the dead rotate keyframes and its token are gone");
const lumOf = (hex: string) => {
	const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const themeTok = (block: string, name: string) => block.match(new RegExp(name + ": (#[0-9a-f]{6})"))![1];
const contrastOnCanvas = (block: string) => {
	const [hi, lo] = [lumOf(themeTok(block, "--accent-todo-text")), lumOf(themeTok(block, "--canvas"))].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};
assert.ok(contrastOnCanvas(tokenBlocks[0]) >= 3 && contrastOnCanvas(tokenBlocks[1]) >= 3, "the doing square clears the 3:1 floor that a mark carrying state needs, in both themes");
// #410 the ladder: the seven dark accents share one OKLCH lightness, so a later hue change that misses it fails
const oklchL = (hex: string) => {
	const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
};
const ladder = ["backlog", "todo", "review", "merge", "live", "integration", "done"].map((n) => oklchL(themeTok(tokenBlocks[1], `--accent-${n}`)));
assert.ok(Math.max(...ladder) - Math.min(...ladder) <= 0.01, `the seven dark accents step one OKLCH lightness within 0.01, so the ladder reads by hue alone: ${ladder.map((v) => v.toFixed(3)).join(" ")}`);
const contrastOnRaised = (name: string) => {
	const [hi, lo] = [lumOf(themeTok(tokenBlocks[0], name)), lumOf(themeTok(tokenBlocks[0], "--raised"))].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};
const lightTexts = [...["backlog", "todo", "review", "merge", "live", "integration", "done"].map((n) => `--accent-${n}-text`), "--error-text"];
assert.deepEqual(lightTexts.filter((n) => contrastOnRaised(n) < 4.5), [], "every light -text step clears 4.5:1 on the raised panel, so a tinted label reads");

// 25. #370 the phone layout: one breakpoint constant, media queries only, the same nodes reused as
// sheets, and the two viewport hacks gone. The live geometry (the 44px rects, the three viewports,
// the rotation pass) is a browser check, left to the reviewer
assert.ok(!/user-scalable|maximum-scale/.test(page), "the viewport no longer blocks zoom: no user-scalable and no maximum-scale flag");
assert.ok(page.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'), "the viewport is the plain device-width form");
assert.ok(!/font-size: 85%/.test(themeCss) && !/html \{[^}]*font-size/.test(themeCss), "the 85% base font hack is gone, so the type scale holds a 16px base");
assert.ok(!/navigator\.userAgent|maxTouchPoints|ontouchstart/.test(page), "the phone layer sniffs no user agent: media queries only");
const themeSrc = readFileSync(new URL("../../src/webui/theme.ts", import.meta.url), "utf8");
assert.equal((themeSrc.match(/export const MOBILE_MAX = \d+;/g) ?? []).length, 1, "the phone breakpoint is one exported constant");
const phoneQueries = (themeCss.match(/@media \(max-width: 700px\)/g) ?? []).length;
assert.ok(phoneQueries >= 4, "the phone layer is more than one rule");
assert.equal(phoneQueries, (themeSrc.match(/@media \(max-width: \$\{MOBILE_MAX\}px\)/g) ?? []).length, "every phone media query interpolates that one constant, never a hand-written width");
assert.deepEqual([...new Set([...themeCss.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => m[1]))].sort(), [String(MOBILE_MAX)], "the sheet carries one phone breakpoint and no hand-picked tablet floor");
assert.ok(page.includes(`const MOBILE_MAX = ${MOBILE_MAX}`), "the client reads the same constant, so the CSS switch and the JS check cannot drift");
// the vertical spine: the stations stack in pipeline order, the hairline becomes the left connector
assert.match(themeCss, /#board \{[^}]*flex-direction: column/, "the phone board stacks its stations instead of scrolling them sideways");
assert.match(themeCss, /\.station \{[^}]*border-left: 1px solid var\(--hairline\)/, "the hairline becomes the vertical connector on the left edge");
assert.match(themeCss, /\.station \.cards \{[^}]*overflow: visible/, "the phone stations spill into the one page scroll");
assert.match(themeCss, /\.count \{[^}]*font-size: 0\.8125rem/, "the phone station count drops to the smaller type step");
assert.match(themeCss, /\.station\.strip \.st-head \{[^}]*flex-direction: row/, "the integration off strip becomes a one-line row");
assert.ok(page.includes("relationPaths(activeBoard().tasks, rectOf, verticalSpine())"), "the client tells relationPaths which layout it draws, so the vertical spine draws no cross-column curve");
// the sheets reuse the same nodes: the panel, the console, the filter bar and the palette
assert.ok(page.includes('<div id="p-handle"') && page.includes('id="p-close"'), "the panel sheet carries a drag handle and keeps its visible close button");
assert.match(themeCss, /#panel \{[^}]*top: 0[^}]*bottom: 0/, "the phone panel is a full-screen sheet");
assert.match(themeCss, /#console\.raised \{[^}]*70vh/, "a tap raises the console into a bottom sheet of at most 70 percent of the viewport");
assert.match(themeCss, /#console \{[^}]*height: var\(--console-h-touch, calc\(92px \+ env\(safe-area-inset-bottom\)\)\)/, "#405 the phone console reads its own height variable and falls back to the collapsed 92px line, so a phone drag never moves the desktop dock");
assert.match(themeCss, /body\.filters-open #filters \{[^}]*display: flex/, "the filter bar collapses behind one button that opens its sheet");
assert.match(themeCss, /#palette \{[^}]*padding: 0/, "the palette goes full screen on a phone");
assert.ok((themeCss.match(/env\(safe-area-inset-(top|bottom)\)/g) ?? []).length >= 4, "the sheets and the console respect the safe-area insets");
assert.ok(page.includes('id="f-toggle"') && page.includes('id="f-count"') && page.includes('id="f-apply"'), "the phone filter button carries its count badge, and the sheet carries an apply control next to the clear");
assert.ok(page.includes('aria-controls="filters"') && page.includes('id="f-apply" class="f-chip"'), "the filter button names the sheet it opens and the apply control is a chip");
// the client side of the two sheets, run against the served source
const sheetSrc = page.slice(page.indexOf("// #370 the phone filter button"), page.indexOf("// the palette: a dialog"));
assert.ok(sheetSrc.includes("function toggleFilters()") && sheetSrc.includes("function closeFilters()") && sheetSrc.includes("function syncFilterToggle()"), "the client opens, closes and badges the filter sheet");
const fBtn = { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; } };
const fBadge = { textContent: "", hidden: true };
const fInput = { focused: false, focus() { this.focused = true; } };
const fBody = { classes: new Set<string>(), contains(c: string) { return this.classes.has(c); }, add(c: string) { this.classes.add(c); }, remove(c: string) { this.classes.delete(c); } };
const sheetApi = new Function("document", "filters", "filtersCount", sheetSrc + "\n; return { syncFilterToggle: syncFilterToggle, toggleFilters: toggleFilters, closeFilters: closeFilters };")(
	{ getElementById: (id: string) => (id === "f-toggle" ? fBtn : id === "f-count" ? fBadge : id === "f-q" ? fInput : null), body: { classList: fBody } },
	{ ...emptyFilters(), q: "x", held: true },
	filtersCount,
) as any;
sheetApi.syncFilterToggle();
assert.deepEqual([fBtn.attrs["aria-expanded"], fBadge.textContent, fBadge.hidden], ["false", "2", false], "a closed sheet reads collapsed and the badge counts the two active filters");
sheetApi.toggleFilters();
assert.deepEqual([fBody.contains("filters-open"), fBtn.attrs["aria-expanded"], fInput.focused], [true, "true", true], "the button opens the sheet and focuses the query field, so the on-screen keyboard has something to type into");
sheetApi.closeFilters();
assert.deepEqual([fBody.contains("filters-open"), fBadge.textContent], [false, "2"], "apply closes the sheet and the badge keeps its count");
assert.ok(script.includes('c.classList.remove("raised")') && script.includes('c.classList.toggle("raised")'), "the console opens as one status line and a tap on the handle raises the sheet");
assert.ok(script.includes("handleEl.onclick = handleTap"), "the console handle is the raise control, reachable by pointer and by keyboard");
// #405 the phone handle is a real drag target: a drag resizes the sheet and the click that ends it
// does not also raise it, while a pointer that holds still is a plain tap
const dragSrc = page.slice(page.indexOf("let dragging = false"), page.indexOf("\napplyConsoleH(consoleH);"));
const handleStub = { setPointerCapture() {} };
const dragHeights: number[] = [];
let taps = 0;
const drag = new Function("document", "innerHeight", "applyConsoleH", "toggleConsoleSheet", dragSrc +
	"; return { down: (e) => handleEl.onpointerdown(e), move: (e) => handleEl.onpointermove(e), up: () => handleEl.onpointerup(), tap: () => handleEl.onclick(), key: (e) => handleEl.onkeydown(e) };")({
	getElementById: () => handleStub,
}, 900, (h: number) => dragHeights.push(h), () => taps++);
const pointerAt = (clientY: number) => ({ pointerId: 1, clientY, preventDefault() {} });
drag.down(pointerAt(880)); drag.move(pointerAt(700)); drag.up(); drag.tap();
assert.deepEqual([dragHeights, taps], [[200], 0], "the drag writes the live height and the click that follows it does not also raise the sheet");
drag.down(pointerAt(880)); drag.up(); drag.tap();
assert.equal(taps, 1, "a pointer that holds still is a tap and still toggles the raised sheet");

// 26. #377 the spacing scale: six steps in the light :root block, and the chrome, the station heads and
// the cards read their spacing from it, so no rule carries a hand-picked pixel rhythm
for (const tok of ["--sp-1: 4px", "--sp-2: 6px", "--sp-3: 8px", "--sp-4: 12px", "--sp-5: 16px", "--sp-6: 24px"])
	assert.ok(tokenBlocks[0].includes(tok), `the light :root block declares ${tok.split(":")[0]}, the one spacing scale`);
const spacingRule = (sel: string) => themeCss.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"))?.[1] ?? "";
for (const sel of ["header", "#filters", "#board", ".st-head", ".station", ".card", ".arch-row", ".empty"])
	assert.ok(spacingRule(sel).includes("var(--sp-"), `${sel} reads its spacing from the scale`);
assert.match(spacingRule(".card"), /padding: var\(--sp-3\) var\(--sp-4\) var\(--sp-4\)/, "the card takes 12px of side padding from the scale, so its text clears the station hairline");
assert.equal(spacingRule(".station").includes("gap: var(--sp-4)"), true, "the station head gap belongs to the column, so it holds at every scroll position");
assert.equal(spacingRule(".station .cards").includes("padding-top"), false, "the scrolling cards container carries no gap of its own");
// #385 the column edge: no horizontal board gap, and the head, the empty line and the card share one 12px inset
assert.equal(spacingRule("#board").includes("gap: 0;"), true, "the board carries no column gap, so a card's right edge reaches the next station's separator");
assert.equal(spacingRule(".st-head").includes("padding: var(--sp-2) var(--sp-4) var(--sp-3)"), true, "the station head takes the card's 12px inset, so the title and the count sit on the card text line");
assert.equal(spacingRule(".empty").includes("padding: 0 var(--sp-4)"), true, "the empty line shares the card's 12px inset");
assert.equal(spacingRule(".station .cards").includes("scrollbar-width: none"), true, "a scrolled station hides its scrollbar, so the cards stay flush on the right");
assert.match(themeCss, /\.station \.cards::-webkit-scrollbar \{ width: 0; \}/, "webkit gets the same zero scrollbar inset");
const phoneSheet = themeCss.slice(themeCss.indexOf(`@media (max-width: ${MOBILE_MAX}px)`));
assert.match(phoneSheet, /\.empty \{ padding: 0 12px; \}/, "the phone block gives the empty line its own 12px inset, since the station no longer carries one");

// #386 the phone board: nothing inside it shrinks, so every box sizes to its content and #board stays the
// one scroller. The live rect check (no two boxes intersect) is a browser pass, left to the reviewer
const phoneStart = themeCss.indexOf("@media (max-width: " + MOBILE_MAX + "px)");
const phoneBoard = themeCss.slice(phoneStart, themeCss.indexOf("@media (max-width: " + MOBILE_MAX + "px)", phoneStart + 1));
assert.ok(phoneBoard.includes("#board { display: flex;"), "the phone board block is the first phone media query, the one that stacks the stations");
const phoneRule = (sel: string) => phoneBoard.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"))?.[1] ?? "";
for (const sel of [".station", ".station .cards", ".card"])
	assert.match(phoneRule(sel), /flex: 0 0 auto/, `${sel} sizes to its content on a phone instead of shrinking into the next box`);
for (const sel of [".station", ".station .cards"])
	assert.match(phoneRule(sel), /min-height: auto/, `${sel} drops the desktop min-height: 0 that let the box collapse to nothing`);
assert.match(phoneRule("#board"), /overflow-y: auto/, "the phone board stays the one vertical scroller");
assert.ok(!/\.station \.cards \{[^}]*overflow-y: auto/.test(phoneBoard), "the phone block adds no nested scroller on the station body");

// #387 the phone keeps the desktop heights and moves the 44px target into an invisible band, so a
// compact control looks as it does on desktop and still answers a finger. The live rects and the
// elementFromPoint pass are a browser check, left to the reviewer
const ctlHosts = ["#theme", "#f-toggle", ".f-chip", "#p-close", "#c-close", ".tab"];
const bandHosts = [".m-action", ".seg", ".toggle", ".c-wait", "#c-text summary", ...ctlHosts];
const phoneRules = [...phoneBoard.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const selParts = (sel: string) => sel.split(",").map((p) => p.trim().replace(/::after$/, ""));
const bandRule = phoneRules.find((r) => r.sel.includes("::after") && bandHosts.every((h) => selParts(r.sel).includes(h)));
assert.ok(bandRule, "the phone layer carries one shared ::after band on every compact control");
for (const decl of ['content: ""', "position: absolute", "left: 0", "right: 0", "top: 50%", "height: 44px", "margin-top: -22px"])
	assert.ok(bandRule!.body.includes(decl), `the band leaves the flow and centres 44px on the control's middle: ${decl}`);
assert.ok(!/background|pointer-events/.test(bandRule!.body), "the band paints nothing and it takes the tap");
const positionRule = phoneRules.find((r) => /position: relative/.test(r.body) && bandHosts.every((h) => selParts(r.sel).includes(h)));
assert.ok(positionRule, "every band host is positioned, so its band anchors to the control");
// #405 the compact controls take one shorter box and lean on that same band for the 44px floor
const sheetRules = [...phoneSheet.replace(new RegExp(`@media \\(max-width: ${MOBILE_MAX}px\\) \\{`, "g"), "").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const sheetRule = (host: string) => sheetRules.find((r) => r.sel === host)?.body ?? "";
assert.match(phoneSheet, /:root \{ --ctl-h: 32px; \}/, "the phone block names the compact control height once, and every compact control reads it");
assert.deepEqual(ctlHosts.filter((h) => !/min-height: var\(--ctl-h\)/.test(sheetRule(h))), [], "every compact control takes the one --ctl-h height, so the theme toggle, the filter button, the chips and the close buttons share one box");
assert.deepEqual(["#p-close", "#c-close"].filter((h) => !/min-width: var\(--ctl-h\)/.test(sheetRule(h))), [], "the two close buttons stay square at the compact height");
assert.deepEqual(sheetRules.filter((r) => /min-height: 44px/.test(r.body) && bandHosts.some((h) => selParts(r.sel).includes(h))).map((r) => r.sel), [], "no compact control keeps a real 44px height, so the 44px floor comes from the band alone");
const minChipGap = Number(bandRule!.body.match(/height: (\d+)px/)![1]) - Number(phoneSheet.match(/--ctl-h: (\d+)px/)![1]);
assert.equal(Number(sheetRules.find((r) => r.sel === ".f-group")!.body.match(/gap: (\d+)px/)![1]), minChipGap, "the chip rows sit two band overhangs apart, so two chips' bands touch and never overlap");
assert.ok(Number(sheetRule("body.filters-open #filters").match(/gap: (\d+)px/)![1]) >= minChipGap, "the filter sheet spaces the chip groups and the loose chips by the same two band overhangs, so a chip's band never reaches into the band of the next group either");
for (const dead of [".run-row", ".arch-row", ".card"]) {
	assert.ok(!selParts(bandRule!.sel).includes(dead), `${dead} takes no band, so a stacked row's band never covers the row below`);
	assert.ok(!selParts(positionRule!.sel).includes(dead), `${dead} carries no band anchor`);
}
assert.ok(!/\bagent-(sub|doctor)\b/.test(phoneBoard), "the phone block touches no nested run row, so the more specific connector ::after still wins over the band");

// #422 the project tabs: the strip keeps its height on a short phone viewport and the tabs take the
// compact control box. The live rects and the tap pass are a browser check, left to the reviewer
assert.match(spacingRule("#tabs"), /flex: 0 0 auto/, "the tab strip never shrinks, so a short viewport squeezes the board instead of clipping the labels");
assert.match(spacingRule(".tab"), /border-radius: 6px/, "the tabs round all four corners, since the filter bar sits below them and nothing attaches to their flat bottom");
assert.doesNotMatch(spacingRule(".tab"), /border-radius: 6px 6px 0 0/, "no two-corner folder form is left on the tabs");
assert.match(sheetRule("#tabs"), /overflow-x: auto; overflow-y: hidden/, "the phone strip clips the band's overhang and never scrolls vertically");
assert.match(sheetRule("#tabs"), /padding: 6px 12px 4px/, "the phone strip keeps 4px under a tab, exactly the reach of the 2px focus ring");
assert.match(sheetRule(".tab"), /min-height: var\(--ctl-h\); padding: 0 14px;/, "a phone tab is 32px tall and as wide-padded as the filter button, and its 44px floor comes from the band alone");

// #388 the board is flush with the screen edges: the board keeps no side padding, so a card box starts
// at 0 on the desktop and at the 1px phone rail, and the card text keeps its 12px inset. The live rects
// and the overflow check are a browser pass, left to the reviewer
assert.equal(spacingRule("#board").includes("padding: var(--sp-3) 0 var(--sp-5)"), true, "the desktop board drops its 18px side padding, so the first card box starts at 0");
assert.equal(spacingRule(".toggle").includes("padding: 6px 12px"), true, "the more-toggle keeps a 12px text inset once the board padding is gone");
assert.match(phoneRule("#board"), /padding: 14px 0 12px/, "the phone board drops its 12px side padding and keeps the 14px top air above the first head rule");
const flushRule = (sel: string) => phoneBoard.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
assert.match(flushRule(".station"), /padding-left: 0/, "the phone station drops the 12px inset, so the card box starts at 1 and the 1px rail keeps x 0 to 1");
assert.match(flushRule(".st-head"), /padding: 14px 12px 0/, "the phone head carries the 12px inset itself and drops its bottom pad, so the station gap owns the space above its cards");
assert.match(flushRule(".st-head::before"), /left: 1px; top: 23px; width: 7px;/, "the phone tick sits on the label's optical middle, the 14px head pad plus half the 18px line box");
assert.match(flushRule(".empty"), /padding: 0 12px/, "the phone empty line carries the 12px inset itself");
assert.match(flushRule(".station + .station"), /margin-top: 16px/, "the phone column seam gets its air above the rule, not under it");
assert.match(flushRule(".station .cards > .card:last-child"), /border-bottom: 0/, "a column's last card drops its line, so the seam paints one hairline and not two touching ones");
assert.match(flushRule(".card"), /padding: 10px 12px 12px/, "the card's top row gets the same frame as its bottom");

// #425 seven equal station tracks, and the open panel is flush with the done column: no wider last
// track and no dead 18px between the board and the panel. The live widths are a browser pass, left to
// the reviewer
const boardGrid = spacingRule("#board").match(/grid-template-columns: ([^;]+);/)?.[1] ?? "";
assert.equal(boardGrid, "repeat(7, minmax(9.375rem, 1fr))", `#425 the base board grid is seven equal tracks, got ${boardGrid}`);
assert.doesNotMatch(spacingRule("#board"), /1\.15fr|repeat\(6,/, "#425 no wider last track and no six-track base is left on the board");
const offGrid = spacingRule("#board.off-integration").match(/grid-template-columns: ([^;]+);/)?.[1] ?? "";
assert.equal(offGrid, "repeat(5, minmax(9.375rem, 1fr)) 48px minmax(9.375rem, 1fr)", `#425 the off-integration grid is five equal tracks, the 48px strip and one more equal track, got ${offGrid}`);
const panelBoardPad = spacingRule("body.panel-open #board");
assert.ok(panelBoardPad.includes("padding-right: var(--panel-w)"), `#425 the open panel sets the board's padding to its own width, so the done column meets the panel edge, got ${panelBoardPad}`);
assert.doesNotMatch(panelBoardPad, /calc\(|18px/, `#425 the panel-open board padding adds no constant to the panel width, got ${panelBoardPad}`);
const panelArchivePad = spacingRule("body.panel-open #archive");
assert.ok(panelArchivePad.includes("padding-right: calc(18px + var(--panel-w))"), `#425 the archive keeps its own 18px side padding beside the panel, got ${panelArchivePad}`);

// #410 the phone columns: each head rules the column off in its own tint and carries a glow that walks
// the ladder, one station per slot, on the same motion gates as the desktop head
assert.match(flushRule(".st-head"), /border-top: 1px solid color-mix\(in srgb, var\(--ac\) 55%, transparent\)/, "the phone head rules its column off in the station tint, so the next column starts at a tinted line");
const headGlow = flushRule(".st-head::after");
assert.ok(headGlow.includes("background: linear-gradient(90deg, transparent, var(--ac-prev), var(--ac), transparent)"), "the glow enters in the previous column's tint and leaves in its own, so the walk reads as one transition");
assert.match(headGlow, /opacity: 0/, "the glow paints nothing before its slot, so no head shows a resting bar on load or with motion off");
assert.match(headGlow, /top: -1px/, "the glow sits on the head's own top rule, not inside the head");
const waveRule = motionCss.match(/\[data-motion="live"\] \.st-head::after \{([^}]*)\}/)?.[1] ?? "";
assert.match(waveRule, /animation: headWave var\(--t-wave\) linear infinite/, "the head glow loops the wave keyframe over the token that covers one slot per station");
assert.match(waveRule, /animation-delay: calc\(var\(--i, 0\) \* var\(--t-slot\)\)/, "each station waits its own slot before the glow: a negative delay would light column one, then the last column, then walk back up");
assert.ok(!phoneBoard.includes('[data-motion="live"] .st-head::after') && /\.st-head::after/.test(phoneSheet), "the wave rule carries no phone wrapper, so one animation rides the phone glow");
assert.match(motionCss, /html\.motion-paused \.st-head::after \{[^}]*animation-play-state: paused/, "a hidden tab freezes the head glow with the spine");
assert.match(motionCss, /\[data-motion="none"\] \*::after[^{]*\{[^}]*animation: none/, "the none policy already covers the head glow pseudo element");

// #426 the priority label sits on the facts row's size, so the two rows cannot drift apart
const factsSizeRule = themeCss.match(/#p-facts, #p-prio-wrap \{([^}]*)\}/)?.[1] ?? "";
assert.match(factsSizeRule, /font-size: 0\.8125rem/, `the facts row and the priority row share one 0.8125rem size rule, so the priority label is not one step larger than complexity: ${factsSizeRule}`);
assert.ok(!/(?:^|\})\s*#p-prio-wrap \{[^}]*font-size/.test(themeCss), "the priority row carries no size of its own, so the shared facts size is the only one");
// #426 a subagent name takes its run's role accent, exactly like its parent
assert.ok(!/\.run-row\.agent-sub \.row-role/.test(themeCss), "no rule dims a sub row's role name, so the Sub-developer name keeps the developer accent");

console.log("page.test.ts: all assertions passed");
