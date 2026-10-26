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
const sheetIds = ["theme", "hub", "board", "tabs", "updated", "panel", "p-title", "p-facts", "p-prio", "p-actions", "p-runs", "p-body", "p-history", "console", "c-handle", "c-head", "c-title", "c-meta", "c-log", "c-text"];
for (const id of sheetIds) assert.ok(page.includes(`id="${id}"`), `the page keeps #${id}, an element the client addresses`);
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
const panelOrder = ["p-head", "p-facts", "p-prio-wrap", "p-actions", "p-runs", "p-body", "p-history"].map((id) => page.indexOf(`id="${id}"`));
assert.ok(panelOrder.every((at, i) => at > 0 && (i === 0 || at > panelOrder[i - 1])), "the panel holds the header, the priority control, the actions, the runs, the body and the history in spec order");
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
assert.equal(subjects.size, 16, "sixteen selectors mark an element interactive with cursor: pointer");
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
const runsSrc = page.slice(page.indexOf("const ROLE_CLS = "), page.indexOf("// the history block"));
const runsEl: Record<string, any> = { __html: undefined, innerHTML: "", querySelectorAll: () => [] };
const runLog = { handle: "t.dev.1", sub: null as number | null };
let subFetches: string[] = [];
const makeRuns = () => new Function("esc", "fmtDur", "fmtTokens", "logState", "agentLabel", "document", "fetch", "encodeURIComponent", "projectParam", "openConsole",
	writeGatedSrc + "\nlet openDetail = null, panelFile = null;\n" + runsSrc +
	"\n; return { writeRuns: writeRuns, subCache: subCache, set open(v) { openDetail = v; }, set file(v) { panelFile = v; } };")(
	esc, fmtDur, fmtTokens, runLog, agentLabel,
	{ getElementById: (id: string) => (id === "p-runs" || id === "p-history" ? runsEl : null) },
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
assert.ok(liveRow.includes(fmtTokens(1234)) && liveRow.includes(fmtDur(65000)) && liveRow.includes(new Date(1700000000000).toLocaleTimeString()), "the row shows the start, the duration and the tokens");
assert.equal(subFetches.length, 1, "a run with no cached sub list starts exactly one fetch");
const rowOf = new Function("esc", "fmtDur", "fmtTokens", "logState", "ROLE_CLS", "startText", page.slice(page.indexOf("function runRowHtml("), page.indexOf("// the subagent rows of one run")) + "; return runRowHtml;")(esc, fmtDur, fmtTokens, runLog, { developer: "agent-developer" }, (ms: number) => "T" + ms);
assert.ok(rowOf({ role: "developer", handle: "d", status: "dead", tokens: 0, duration: 0 }, "", "Developer", null).includes("agent-dead"), "a dead run keeps its red marker");
assert.ok(rowOf({ role: "developer", handle: "d", status: "dead", tokens: 0, duration: 0 }, "", "Developer", null).includes("cross"), "the dead marker is the cross");
assert.ok(rowOf({ role: "developer", handle: "d", status: "done", tokens: 0, duration: 0 }, "", "Developer", null).includes("agent-past"), "a finished run keeps the past marker");
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

// 16. the actions row: a done or unheld merging task offers no hold button, a held task offers
// Unblock, every other state Block, both copy buttons carry their text, and a failed toggle
// re-enables the button
const actionsOf = new Function("esc", "numOf", "isHeld", page.match(/function actionsHtml\(t\) \{[\s\S]*?\n\}/)![0] + "; return actionsHtml;")(esc, (f: string) => parseInt(f.slice(0, 6), 10), isHeld) as (t: any) => string;
const file = "000263_task.md";
assert.ok(actionsOf({ state: "doing", file }).includes('"m-action m-block"') && actionsOf({ state: "doing", file }).includes("<rect"), "an unheld task offers Block with the stop icon");
assert.ok(actionsOf({ state: "doing", file, blockedBy: "user" }).includes('"m-action m-unblock"') && actionsOf({ state: "doing", file, blockedBy: "user" }).includes("<path"), "a held task offers Unblock with the play icon");
assert.ok(!actionsOf({ state: "done", file, blockedBy: "user" }).includes("toggleHold") && !actionsOf({ state: "merging", file, blockedBy: "" }).includes("toggleHold"), "a done task offers no hold button, and neither does the merging task before a user hold");
assert.ok(actionsOf({ state: "doing", file, worktree: ".worktrees/x" }).includes('data-copy=".worktrees/x"'), "the copy button carries the worktree when the task has one");
assert.ok(actionsOf({ state: "doing", file }).includes('data-copy="000263_task.md"') && actionsOf({ state: "doing", file }).includes('data-copy="263"'), "with no worktree the copy button carries the file path, and the number always copies");
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
const bodyVars: Record<string, string> = {};
const heightStore: Record<string, string> = {};
const makeHeight = (visible: boolean) => {
	const consoleEl = new StubEl();
	const handleEl = new StubEl();
	if (!visible) consoleEl.className = "hidden";
	const api = new Function("document", "innerHeight", "localStorage", heightSrc + "\n; return { applyConsoleH: applyConsoleH, get h() { return consoleH; } };")(
		{
			getElementById: (id: string) => (id === "console" ? consoleEl : id === "c-handle" ? handleEl : null),
			body: { style: { setProperty: (k: string, v: string) => { bodyVars[k] = v; } } },
		},
		900,
		{ setItem: (k: string, v: string) => { heightStore[k] = v; } },
	);
	return { api, handleEl, consoleEl };
};
const shown = makeHeight(true);
shown.api.applyConsoleH(10);
assert.equal(shown.api.h, 120, "a drag below the floor clamps to the 120px minimum");
shown.api.applyConsoleH(9999);
assert.equal(shown.api.h, 540, "a drag above the ceiling clamps to 60 percent of the viewport");
shown.api.applyConsoleH(300);
assert.equal(bodyVars["--console-h"], "300px", "the visible console carries its height in the page variable");
assert.equal(shown.handleEl.attrs["aria-valuenow"], "300", "the handle exposes its position to assistive technology");
assert.equal(shown.handleEl.attrs["aria-valuemin"], "120", "the handle names the minimum");
assert.equal(shown.handleEl.attrs["aria-valuemax"], "540", "the handle names the maximum");
assert.equal(heightStore.consoleHeight, "300", "the height persists under one key");
const hiddenHeight = makeHeight(false);
hiddenHeight.api.applyConsoleH(300);
assert.equal(bodyVars["--console-h"], "300px", "a closed console writes no height, so the panel keeps the full viewport");

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
// and the matcher reads the station, the priority, the complexity, the issuer, the hold and live
const allFilters = { q: "café 263", phases: ["work", "done"], priorities: ["high", "low"], complexities: ["moderate"], issuer: "#263", held: true, live: true };
assert.deepEqual(decodeFilters(encodeFilters(allFilters)), allFilters, "the filter encoding round-trips every field, a unicode query included");
assert.deepEqual([decodeFilters(encodeFilters(emptyFilters())), decodeFilters(""), decodeFilters(null), decodeFilters("!!!!"), decodeFilters("e30=")].map(filtersActive), [false, false, false, false, false], "an empty, absent, unreadable or non-object filter value decodes to no filter");
const hostile = btoa(JSON.stringify({ q: 5, p: ["work", "nope"], pr: "high", cx: ["complex", 7], i: {}, h: "yes", l: true }));
assert.deepEqual(decodeFilters(hostile), { q: "", phases: ["work"], priorities: [], complexities: ["complex"], issuer: "", held: false, live: true }, "a value of the wrong shape keeps only the well-typed fields and never throws");
const filterRows = [
	{ file: "000263_docked.md", name: "feat: docked panel", summary: "the console moves", state: "reviewing", priority: "high", complexity: "moderate", issuer: "user", updated: 3, agents: [{ alive: true }] },
	{ file: "000300_old.md", name: "fix: old thing", summary: "a repair", state: "done", priority: "low", complexity: "simple", issuer: "#263", updated: 9 },
];
const filesOf = (rows: any[]) => rows.map((t) => t.file);
assert.equal(filterTasks(filterRows, emptyFilters()), filterRows, "no active filter passes the payload through untouched");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), q: "#263" })), ["000263_docked.md"], "a number query matches the task number");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), q: "console" })), ["000263_docked.md"], "the text query reads the summary as well as the name");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), phases: ["review"] })), ["000263_docked.md"], "a phase toggle selects every state of its station");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), priorities: ["low"], complexities: ["simple"] })), ["000300_old.md"], "the priority and complexity multi-selects narrow together");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), issuer: "#263" })), ["000300_old.md"], "the issuer filter matches the stored issuer");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), held: true })), [], "held only drops an unheld task");
assert.deepEqual(filesOf(filterTasks(filterRows, { ...emptyFilters(), live: true })), ["000263_docked.md"], "has live agent keeps the task with the live run");
assert.ok(filterReason({ ...emptyFilters(), q: "x", phases: ["work"], held: true }).startsWith("no task matches: ") && filterReason(emptyFilters()) === "", "the empty reason names the active filters, and stays empty when nothing filters");
assert.deepEqual([emptyFilters(), { ...emptyFilters(), q: "x", held: true }, { ...emptyFilters(), phases: ["work"], priorities: ["high"], complexities: ["complex"], issuer: "#1", live: true }].map(filtersCount), [0, 2, 5], "the phone button's badge counts one step per active filter dimension");
assert.equal(matchesFilters(filterRows[0], { ...emptyFilters(), phases: ["review"] }), true, "the membership test the panel's outside-filter notice runs reads the same filter");
assert.equal(matchesFilters(filterRows[1], { ...emptyFilters(), phases: ["work"] }), false, "a done task sits outside a work phase filter");

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
for (const id of ["filters", "f-q", "f-phases", "f-prio", "f-cx", "f-issuer", "f-held", "f-live", "f-clear", "palette", "pal-input", "pal-list", "pal-empty", "pal-more", "archive", "arch-count", "arch-list", "arch-empty", "arch-page", "arch-more", "arch-newer", "arch-back", "p-outside"])
	assert.ok(page.includes(`id="${id}"`), `the page serves #${id}`);
assert.ok(page.indexOf('id="filters"') > page.indexOf('id="tabs"') && page.indexOf('id="filters"') < page.indexOf('id="board"'), "the filter bar is one row above the spine");
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

// 24. #369 the motion layer: one token set, one policy attribute on the root with three values and
// a four-signal live mode, one reduced-motion block, and a stored choice that lands before the
// first paint. Every duration and easing reads a token, and only two pre-existing effects animate
// a property other than transform or opacity
const motionCss = themeCss;
for (const tok of ["--t-fast: 120ms", "--t-base: 180ms", "--t-slow: 240ms", "--t-breathe: 2s", "--t-sweep: 6s", "--ease-enter:", "--ease-exit:"])
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
assert.match(motionCss, /\[data-motion="live"\] \.spine::after \{[^}]*animation: sweep var\(--t-sweep\) linear infinite/, "one gradient element carries the spine sweep at 6 s linear");
assert.match(motionCss, /\[data-motion="live"\] \.spin \{[^}]*animation: breathe var\(--t-breathe\) var\(--ease-breathe\)/, "the running dot breathes over the 2 s token");
assert.match(motionCss, /\[data-motion="live"\] \.card\.running::after \{[^}]*transform: scaleX\(var\(--p\)\)/, "the progress line advances by a scale transform, never a width");
assert.ok(!/\.running::after \{[^}]*width: calc/.test(motionCss), "the progress line never animates its width");
assert.ok(motionCss.includes("animation-play-state: paused") && page.includes('classList.toggle("motion-paused", document.hidden)'), "the sweep pauses while the tab is hidden and resumes on visibilitychange");
assert.match(motionCss, /\[data-motion="live"\] #c-text > \.pulse/, "the newest streaming line shines only in live mode, so historical lines never do");
assert.equal((page.match(/buildShell\(board, document\)/g) ?? []).length, 1, "the shell, and with it the spine the sweep rides, is built once, so a poll never recreates it");
assert.ok(readFileSync(new URL("../../src/webui/board.ts", import.meta.url), "utf8").includes('el.classList.toggle("running"'), "the card pass marks the running card every poll on the node it keeps");
assert.ok(page.includes('el.style.setProperty("--p"') && page.includes("syncTicker") && page.includes("polledAt"), "the page runs the 1 px/s tick and reseeds the progress from the authoritative poll value");
// the policy store and its control, run against the served source
const motionSrc = page.slice(page.indexOf('const MOTION_KEY = "motion"'), page.indexOf("const inline = "));
assert.ok(motionSrc.includes('const MOTIONS = ["live", "purposeful", "none"]'), "the policy names its three modes in cycle order");
const makeMotion = (store: Record<string, string>, reduce: boolean) => {
	const btn = {
		textContent: "",
		title: "",
		disabled: false,
		attrs: {} as Record<string, string>,
		setAttribute(k: string, v: string) { this.attrs[k] = v; },
		getAttribute(k: string) { return this.attrs[k] ?? null; },
	};
	const root = { dataset: {} as Record<string, string>, classList: { paused: false, toggle(_c: string, v: boolean) { this.paused = !!v; } } };
	const mq = { matches: reduce, addEventListener() {} };
	const api = new Function("rootEl", "localStorage", "matchMedia", "document", "syncTicker", motionSrc +
		"\n; return { applyMotion: applyMotion, cycleMotion: cycleMotion, noMotion: noMotion, get want() { return motionWant; }, set want(v) { motionWant = v; } };")(
		root,
		{ getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
		() => mq,
		{ getElementById: (id: string) => (id === "motion" ? btn : null), addEventListener() {} },
		() => {},
	);
	return { api, btn, root, store };
};
const fresh = makeMotion({}, false);
fresh.api.applyMotion();
assert.equal(fresh.root.dataset.motion, "live", "the policy defaults to live");
assert.deepEqual([fresh.btn.textContent, fresh.btn.attrs["aria-pressed"], fresh.btn.disabled], ["live", "true", false], "the control names the live mode, reads as pressed and is enabled");
fresh.api.cycleMotion();
assert.deepEqual([fresh.root.dataset.motion, fresh.store.motion], ["purposeful", "purposeful"], "a click cycles to purposeful and persists the choice under the documented motion key");
fresh.api.cycleMotion();
assert.deepEqual([fresh.root.dataset.motion, fresh.btn.attrs["aria-pressed"]], ["none", "false"], "the none mode reads as unpressed");
fresh.api.cycleMotion();
assert.equal(fresh.root.dataset.motion, "live", "the cycle wraps back to live");
const stored = makeMotion({ motion: "purposeful" }, false);
stored.api.applyMotion();
assert.equal(stored.root.dataset.motion, "purposeful", "a stored choice wins over the default");
const forced = makeMotion({ motion: "live" }, true);
forced.api.applyMotion();
assert.deepEqual([forced.root.dataset.motion, forced.btn.disabled, forced.btn.textContent], ["none", true, "none"], "reduced motion forces none and disables the control rather than pretending");
assert.match(forced.btn.title, /reduced motion/, "the disabled control explains the system ask in its title");
assert.equal(forced.api.noMotion(), true, "the one helper the JS gates read answers for the forced mode");
assert.equal(makeMotion({}, false).api.noMotion(), false, "and stays false in the default mode");
const motionTag = page.match(/<button id="motion"[^>]*>/)![0];
assert.match(motionTag, /aria-pressed="true"/, "the control is a real button with a pressed state");
assert.match(motionTag, /aria-label="Motion: live/, "and an accessible name");

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
assert.match(themeCss, /body\.filters-open #filters \{[^}]*display: flex/, "the filter bar collapses behind one button that opens its sheet");
assert.match(themeCss, /#f-toggle \{[^}]*min-height: 44px/, "the filter button clears the 44px touch floor");
assert.match(themeCss, /#palette \{[^}]*padding: 0/, "the palette goes full screen on a phone");
assert.ok((themeCss.match(/env\(safe-area-inset-(top|bottom)\)/g) ?? []).length >= 4, "the sheets and the console respect the safe-area insets");
assert.ok((themeCss.match(/min-height: 44px/g) ?? []).length >= 10, "every phone control the layer restyles clears the 44px touch floor");
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
assert.ok(script.includes("handleEl.onclick = toggleConsoleSheet"), "the console handle is the raise control, reachable by pointer and by keyboard");

console.log("page.test.ts: all assertions passed");
