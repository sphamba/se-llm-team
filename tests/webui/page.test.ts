// the webui page group: the served client contract (one stylesheet, one script, element ids,
// endpoint list, state slugs, poll cadence, token integrity, focus floor) and the behaviour of the
// helpers the page runs. Every literal CSS pin moved to a structural or behavioural equivalent
// (#364), so a redesign of the stylesheet does not edit this file.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, setState, STATES } from "../../src/kanban.ts";
import { startHub } from "../../src/hub.ts";
import { agentLabel, agentRowSig, agentStatsText, boardOf, curve, doctorCol, logFixups, mergeBoards, refreshMs, syncAgentStats, syncDoctorCards, syncStatsLine } from "../../src/webui.ts";
// not re-exported by the webui barrel: import directly from the logpane module
import { esc } from "../../src/webui/logpane.ts";

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
// the hub shell keeps the element ids the client addresses
for (const id of ["theme", "hub", "board", "tabs", "updated"]) assert.ok(page.includes(`id="${id}"`), `the page keeps #${id}, an element the client addresses`);
// every state slug reaches the page source, and the layout covers each one exactly once
for (const st of STATES) assert.ok(page.includes(st), `the page source names the ${st} state`);
// the client still calls every hub endpoint the board, the detail card and the tabs need
for (const ep of ["/api/tasks", "/api/task-detail", "/api/task-history", "/api/card-stats", "/api/agent-log", "/api/hub", "/api/projects"]) assert.ok(page.includes(ep), `the client still calls ${ep}`);

// 2. the detail card's structural order: the hold row sits outside the two rebuilt regions
const atAttrs = page.indexOf('<div id="m-attrs"></div>');
const atActions = page.indexOf('<div id="m-actions"></div>');
const atAgent = page.indexOf('<div id="m-agent">');
assert.ok(atAttrs >= 0 && atActions > atAttrs && atAgent > atActions, "#m-actions sits between #m-attrs and #m-agent, so a detail refresh never rebuilds the hold row");
assert.ok(page.indexOf('id="m-doctor"') > page.indexOf('id="m-agent-btns"') && page.indexOf('id="m-doctor"') < page.indexOf('id="m-log-meta"'), "#m-doctor sits between the run columns and the log meta line inside the agent area");
const zOf = (sel: string) => Number(page.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{[^}]*z-index: (\\d+)"))?.[1]);
assert.ok(zOf("#modal") > zOf("#relations") && zOf("#modal") > zOf(".card"), "the #modal backdrop stacks above the relation lines and the task cards");

// 3. token integrity: no rule reads a name nothing declares, both themes declare the same names,
// and every raw hex value sits in a token block. --ac and --shine-base stay rule-local: the column
// classes and the pulse rules set them per element
const themeCss = page.match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, "");
const tokenBlocks = themeCss.match(/\{ --bg: [^}]*\}/g)!;
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
assert.equal(subjects.size, 9, "nine selectors mark an element interactive with cursor: pointer");
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
assert.ok(page.includes(String(agentRowSig)) && page.includes(String(syncAgentStats)) && page.includes(String(syncStatsLine)), "the page runs the tested agent-row and stats helpers");
assert.ok(page.includes(String(doctorCol)) && page.includes(String(syncDoctorCards)), "the page runs the tested doctor-slot helpers");
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
	const mark = new Function("openDetail", "modalFile", "logPane", "logState", "document", page.match(/function markLiveLine\(\) \{[\s\S]*?\n\}/)![0] + "; return markLiveLine;")(
		{ file: "t.md", agents: [{ handle: "h", alive: opts.alive !== false }] },
		"t.md",
		() => pane,
		{ handle: opts.handle ?? "h" },
		{ getElementById: (id: string) => (id === "m-log-text" ? container : null) },
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
const closeOf = (reduce: boolean) => new Function("matchMedia", "setTimeout", "clearTimeout", page.match(/function closeAnimated\(el\) \{[\s\S]*?\n\}/)![0] + "; return closeAnimated;")(
	() => ({ matches: reduce }),
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
const closeFn = page.match(/function closeModal\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(closeFn.includes("closeLog()") && closeFn.includes("closeAnimated(modal)"), "the modal close clears the log state and runs the shared exit");
// 000251: the loaded log text is the heavy part of the detail card, dropped at close so the tab
// holds no transcript memory while the card is shut; the run cards stay mounted for the reopen
assert.ok(closeFn.includes('getElementById("m-log-text")') && closeFn.includes('textContent = "";'), "the modal close discards the loaded log text");
const closeLogFn = page.match(/function closeLog\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(closeLogFn.indexOf("clearInterval") < closeLogFn.indexOf("closeAnimated") && closeLogFn.includes("logState = null;"), "closeLog clears the poll and the state before the visual hide");
assert.ok(page.includes('onclick="closeModal()"') && page.includes('if (e.target.id === "modal") closeModal();') && page.includes('if (e.key === "Escape") closeModal();'), "the X button, the overlay click and Esc all use the shared close path");

// 14. 000246/000274 the loading state pins the modal height and the body arrival grows it to the
// content height; the html gate keeps an identical repeat delivery from restarting the 400 ms
// unpin, and a mobile full-screen sheet never gets an inline height
const setBodySrc = page.match(/function setBody\(t\) \{[\s\S]*?\n\}/)![0];
class GrowEl {
	className = "grow";
	scrollHeight = 480;
	style: Record<string, string> = { height: "120px" };
	classList = {
		contains: (cls: string) => this.className.split(" ").includes(cls),
		add: (cls: string) => { if (!this.classList.contains(cls)) this.className += (this.className ? " " : "") + cls; },
		remove: (cls: string) => { this.className = this.className.split(" ").filter((c) => c !== cls).join(" "); },
	};
}
const growTimers: Array<(() => void) | null> = [];
const growBox = new GrowEl();
const growBody: Record<string, any> = {};
const makeSetBody = (reduce: boolean, box: GrowEl, body: Record<string, any>) => new Function(
	"document", "matchMedia", "setTimeout", "clearTimeout", "md",
	setBodySrc + "; return setBody;",
)(
	{ getElementById: (id: string) => (id === "m-body" ? body : id === "m-box" ? box : null) },
	() => ({ matches: reduce }),
	(fn: () => void) => { growTimers.push(fn); return growTimers.length - 1; },
	(id?: number) => { if (id != null) growTimers[id] = null; },
	(b: string) => "<p>" + b + "</p>",
);
const setBodyFn = makeSetBody(false, growBox, growBody);
setBodyFn({ body: "first" });
assert.ok(growBox.style.height === "480px" && growTimers.length === 1, "a body landing while the pin is set grows to the measured content height and arms the unpin");
setBodyFn({ body: "first" });
assert.equal(growTimers.length, 1, "an identical poll delivery is html-gated, the unpin timer is not restarted");
setBodyFn({ body: "second" });
assert.equal(growTimers.length, 2, "a changed body while the pin is still set re-runs the grow");
growTimers[1]!();
assert.ok(growBox.style.height === "" && !growBox.classList.contains("grow"), "the unpin returns the height to auto and drops the grow class");
setBodyFn({ body: "third" });
assert.ok(growBox.style.height === "" && growTimers.length === 2, "a body landing after the unpin writes no height and arms no timer");
const mobileBox = new GrowEl();
makeSetBody(true, mobileBox, {})({ body: "mobile" });
assert.equal(mobileBox.style.height, "120px", "the mobile full-screen sheet never gets an inline height");

// 15. 000237 the detail card's relation lines: the run chain uses the board curve, and each run
// card drops a line from its bottom edge into every sub and doctor card's left side
const relDrop = new Function(page.match(/function dropCurve\(from, to\) \{[\s\S]*?\n\}/)![0] + "; return dropCurve;")();
const dropPath = relDrop({ x: 0, y: 0, w: 200, h: 40 }, { x: 0, y: 44, w: 200, h: 30 });
assert.ok(dropPath.startsWith("M 100 40 C"), "the drop leaves the run card's bottom edge at its centre");
assert.ok(dropPath.endsWith(", 0 59"), "the drop enters the sub card's left side at its vertical middle");
const dropSeg = dropPath.match(/C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/)!;
assert.ok(Number(dropSeg[1]) === 100 && Number(dropSeg[2]) === 49.5 && Number(dropSeg[3]) === -90 && Number(dropSeg[4]) === 59, "the departure control heads down and the approach is uncapped, so a card at the area's left edge takes the full 90px run-in");
assert.equal(relDrop({ x: 0, y: 0, w: 200, h: 40 }, { x: 300, y: 44, w: 200, h: 30 }), "M 100 40 C 100 49.5, 150 59, 300 59", "a card with space to its left gets the base capped at 60px, 2.5 times to 150px and rounded to 5px");
const relDropD = (x1, x2) => {
	const m = relDrop({ x: x1 - 100, y: 0, w: 200, h: 40 }, { x: x2, y: 44, w: 200, h: 30 }).match(/C -?[\d.]+ (-?[\d.]+), (-?[\d.]+) -?[\d.]+, -?[\d.]+ -?[\d.]+$/)!;
	return x2 - Number(m[2]);
};
for (const [x1, x2, d] of [[100, 123, 20], [100, 157, 50], [100, 200, 90], [100, 300, 150], [240, 40, 150], [100, 6, 80]])
	assert.equal(relDropD(x1, x2), d, "a " + Math.abs(x1 - x2) + "px span with " + x2 + "px of space left of the card gets a " + d + "px approach");
// run the served draw against a stub agent area: two run columns with run 2 wrapped below run 1,
// two subs under run 1, one doctor card in the residual #m-doctor row. The wrap must not break the
// chain: curve spans any x/y pair, so the line still connects the wrapped pair
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
const drawn = relSvg.innerHTML.match(/<path [^>]*\/>/g) ?? [];
assert.ok(relHotApply === "t.dev.0" && drawn.length >= 1, "a rewrite re-applies the hovered handle's highlight");
assert.equal(drawn.length, 4, "two wrapped runs, two subs and one doctor draw four lines");
assert.ok(drawn[0].includes('data-from="t.dev.0"') && drawn[0].includes('data-to="t.rev.1"'), "the chain path carries both run handles");
const chainSeg = drawn[0].match(/d="M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)"/)!;
assert.ok(chainSeg[1] === "200" && chainSeg[2] === "20" && chainSeg[7] === "0" && chainSeg[8] === "170", "the chain leaves the first run card's right edge and enters the wrapped run card's left edge, so the wrap does not break the pair");
assert.ok(drawn[3].includes('data-to="t.dev.0.doctor"') && drawn[3].includes('d="M 100 40 C 100 100, -90 215, 0 215"'), "a doctor card in the residual row still drops from its analysed run's card");
relHotApply = null;
relDraw();
assert.ok(relMarks === 1 && relHotApply === null, "the rewrite is html-gated: an unchanged redraw neither rewrites nor re-runs markActiveAgent");
relRun2.rect = { left: 0, top: 160, width: 200, height: 40 };
relDraw();
assert.ok(relSvg.innerHTML !== drawn.join("") && relMarks === 2 && relHotApply === "t.dev.0", "a layout change rewrites the lines and re-applies the selection and the hovered handle's highlight");
const htmlHidden = relSvg.innerHTML;
relModal.className = "hidden";
relDraw();
assert.equal(relSvg.innerHTML, htmlHidden, "a draw with the modal hidden bails before measuring display: none rects");
relModal.className = "";
// 000237 hover and selection: the hot function toggles only the paths the hovered card connects
// to; the selected card's lines carry .relations-sel while its log is open
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
assert.ok(selRun.classList.contains("agent-card-active") && selPath1.className.includes("relations-sel") && !selPath2.className.includes("relations-sel"), "the open run's card is active and its connected lines highlight, unconnected ones stay dim");
const markSubSel = new Function("logPane", "logState", "document", page.match(/function markActiveAgent\(\) \{[\s\S]*?\n\}/)![0] + "; return markActiveAgent;")(() => selPane, { handle: "t.dev.0", sub: "2" }, selDoc);
markSubSel();
assert.ok(selSub.classList.contains("agent-card-active") && selPath1.className.includes("relations-sel"), "a sub view selects through the parent run's handle, its run's lines stay lit");
const markNone = new Function("logPane", "logState", "document", page.match(/function markActiveAgent\(\) \{[\s\S]*?\n\}/)![0] + "; return markActiveAgent;")(() => selPane, null, selDoc);
markNone();
assert.ok(!selRun.classList.contains("agent-card-active") && !selPath1.className.includes("relations-sel"), "closing the log clears the active card and the line highlight");

// 16. the detail card's hold row: a done or unheld merging task offers nothing, a held task
// offers Unblock, every other state Block, and a failed toggle re-enables the button
const actionsOf = new Function(page.match(/function actionsHtml\(t\) \{[\s\S]*?\n\}/)![0] + "; return actionsHtml;")() as (t: any) => string;
assert.ok(actionsOf({ state: "doing" }).includes('"m-action m-block"') && actionsOf({ state: "doing" }).includes("<rect"), "an unheld task offers Block with the stop icon");
assert.ok(actionsOf({ state: "doing", blockedBy: "user" }).includes('"m-action m-unblock"') && actionsOf({ state: "doing", blockedBy: "user" }).includes("<path"), "a held task offers Unblock with the play icon");
assert.ok(actionsOf({ state: "done", blockedBy: "user" }) === "" && actionsOf({ state: "merging", blockedBy: "" }) === "", "a done task offers no hold button, and neither does the merging task before a user hold");
assert.ok(page.includes('document.getElementById("m-actions").innerHTML = actionsHtml(t)'), "the head write redraws the hold row from the task, outside the rebuilt attrs");
assert.ok(page.includes('"/api/task-block?num=" + parseInt(modalFile.slice(0, 6), 10) + projectParam()') && page.includes("body: JSON.stringify({ action })"), "the toggle posts the open task number and the action as JSON");
assert.ok(page.includes("btn.disabled = false"), "a failed toggle re-enables the button");
// the issuer row: a task-issued issuer links to its card when that task is on the active board;
// "user", the orchestrator's "auto", an absent issuer or an off-board number stays plain text
const issuerOf = new Function("esc", "numLinkHtml", "taskByNum", page.match(/function issuerCell\(t\) \{[\s\S]*?\n\}/)![0] + "; return issuerCell;")(esc, (f: string) => `[${f}]`, (ref: string) => (ref === "#42" ? { file: "000042_x.md" } : undefined)) as (t: any) => string;
assert.equal(issuerOf({ issuer: "#42" }), "[000042_x.md]", "a task-issued issuer links to its card");
assert.equal(issuerOf({ issuer: "auto" }), "auto", "an auto issuer stays plain text, never a task link");

// 17. the open path: the scroll reset runs after the un-hide (a write while display: none is
// discarded), and the light detail is requested before the heavy history
const openTaskSrc = page.match(/function openTask\(file\) \{[\s\S]*?\n\}/)![0];
assert.ok(openTaskSrc.indexOf('classList.remove("hidden")') < openTaskSrc.indexOf("scrollTop = 0"), "openTask resets the scroll after the un-hide, so every open shows the top");
assert.ok(openTaskSrc.indexOf("fetch(detailUrl(file))") < openTaskSrc.indexOf("fetch(historyUrl(file))"), "the open path requests the detail markdown before the heavy history");
const pollDetailSrc = page.match(/function pollDetail\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(pollDetailSrc.indexOf("fetch(detailUrl(modalFile))") < pollDetailSrc.indexOf("fetch(historyUrl(modalFile))"), "the poll path chains detail before history too");

console.log("page.test.ts: all assertions passed");
