// the board group split out of tests/webui.test.ts (000260, parent #256): the FLIP diff, the
// station spine, buildShell/syncBoard, the card anatomy, the relation geometry and the hover
// highlight. The hub serves the page once into `page`; every assert below reads that served text
// or the local helpers. Every CSS literal pin moved to a structural or behavioural equivalent
// (#364), so a redesign of the stylesheet does not edit this file.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHub } from "../../src/hub.ts";
import { PRIORITY_RANK, STATES } from "../../src/kanban.ts";
import { applyStages, buildShell, cardBaseHtml, curve, DEFAULT_STAGES, flipDiff, isHeld, MOBILE_MAX, numLinkHtml, priorityRuler, PROGRESS_HALF_S, progressOf, relationPaths, sortStation, spinnerHtml, STATIONS, syncBoard, syncCardStats, tabNames, tabsHtml, taskStats } from "../../src/webui.ts";
import { groupRuns } from "../../src/webui/board.ts";
import { esc } from "../../src/webui/logpane.ts";

const root = mkdtempSync(join(tmpdir(), "webui-board-"));
const home = mkdtempSync(join(tmpdir(), "webui-board-home-"));
const cleanup = () => {
	rmSync(root, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
};
process.on("exit", cleanup);

// HOME at the temp home keeps the hub registry and lock out of the real config; port 0 picks
// an OS port
process.env.HOME = home;
const ui = await startHub({ name: "webui-board-test", root, host: "localhost", port: 0 });
const base = `http://localhost:${ui.port}`;
const page = await (await fetch(`${base}/`)).text();
const themeCss = page.match(/<style>([\s\S]*?)<\/style>/)![1];

// FLIP diff: which cards get transforms. a on top, b below in one column
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

// El is a minimal element stub: buildShell and syncBoard only touch this DOM surface.
const styleStub = () => {
	const style: Record<string, any> = {};
	style.setProperty = (k: string, v: string) => { style[k] = v; };
	return style;
};
class El {
	tag: string;
	className = "";
	title = "";
	textContent = "";
	dataset: Record<string, string> = {};
	attrs: Record<string, string> = {};
	style: Record<string, any> = styleStub();
	children: El[] = [];
	parent: El | null = null;
	get parentElement(): El | null { return this.parent; }
	writes = 0;
	html = "";
	constructor(tag: string) { this.tag = tag; }
	get firstChild(): El | null { return this.children[0] ?? null; }
	get nextSibling(): El | null { const p = this.parent; return p ? p.children[p.children.indexOf(this) + 1] ?? null : null; }
	get innerHTML(): string { return this.html; }
	// the stub keeps one flat stub child per class-tagged span in the markup, which is all the
	// in-place live pass needs to find its two slots; nesting and attributes stay unparsed
	set innerHTML(v: string) {
		this.writes++;
		this.html = v;
		this.children = [...v.matchAll(/<span class="([\w -]+)"/g)].map((m) => {
			const c = new El("span");
			c.className = m[1];
			c.parent = this;
			return c;
		});
	}
	setAttribute(k: string, v: string): void { this.attrs[k] = String(v); }
	appendChild(c: El): El { c.remove(); c.parent = this; this.children.push(c); return c; }
	insertBefore(c: El, ref: El | null): El {
		c.remove();
		c.parent = this;
		const i = ref ? Math.max(0, this.children.indexOf(ref)) : this.children.length;
		this.children.splice(i, 0, c);
		return c;
	}
	remove(): void { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); this.parent = null; }
	// the in-place live pass reads its two slots by class, the page reads them by class selector
	querySelector(sel: string): El | null {
		const cls = sel.replace(/^\./, "");
		const walk = (n: El): El | null => {
			for (const c of n.children) {
				if (c.className.split(" ").includes(cls)) return c;
				const hit = walk(c);
				if (hit) return hit;
			}
			return null;
		};
		return walk(this);
	}
	classList = {
		toggle: (cls: string, on: boolean) => {
			const set = new Set(this.className.split(" ").filter(Boolean));
			if (on) set.add(cls);
			else set.delete(cls);
			this.className = [...set].join(" ");
		},
	};
}

// the spine (000366): one station per pipeline phase, the two states of a phase in one station,
// and one hairline element across the heads instead of a border per station
assert.deepEqual(STATIONS.flatMap((s) => [...s.states]), [...STATES], "the station table covers every state slug exactly once, in pipeline order");
assert.deepEqual(STATIONS.map((s) => s.id), ["queue", "work", "review", "merge", "test", "integration", "done"], "the station order is the fixed process spine");
assert.ok(STATIONS.find((s) => s.id === "queue")?.label === "Backlog" && !STATIONS.some((s) => s.label === "Queue"), "the first station reads Backlog, so no station still says Queue");
assert.deepEqual(["work", "test", "integration"].map((id) => STATIONS.find((s) => s.id === id)?.label), ["Develop", "Live-test", "Integration-test"], "the three renamed stations read Develop, Live-test and Integration-test");
assert.ok(!STATIONS.some((s) => ["Work", "Test", "Integration"].includes(s.label)), "no station still reads Work, Test or Integration");
const boardEl = new El("main");
const stations: Record<string, any> = buildShell(boardEl, { createElement: (tag: string) => new El(tag) });
const stationEls = boardEl.children.filter((c: El) => c.className.split(" ").includes("station"));
assert.deepEqual(stationEls.map((c: El) => c.dataset.station), STATIONS.map((s) => s.id), "the shell builds one station per phase, in order");
assert.equal(boardEl.children.filter((c: El) => c.className === "spine").length, 1, "the shell adds one hairline element across all the station heads");
assert.ok(STATIONS.every((s) => stations[s.id]?.el.dataset.station === s.id), "every station carries its phase as a data hook, not only as a class");
// #403 the phone head glow reads --i, so the build stamps each station with its place in the table
assert.deepEqual(STATIONS.map((s) => stations[s.id].el.style["--i"]), STATIONS.map((_, i) => String(i)), "every station carries its index in STATIONS order, so the glow walks the stack one column at a time");
assert.ok(STATIONS.every((s) => stations[s.id].count.textContent === "0" && stations[s.id].empty.textContent === s.empty), "every station starts at a visible zero count and names its own job when empty");
assert.ok(page.includes(JSON.stringify(STATIONS)), "the page ships the tested station table");
assert.ok(page.includes(String(buildShell)) && page.includes(String(syncBoard)) && page.includes(String(cardBaseHtml)) && page.includes(String(syncCardStats)) && page.includes(String(sortStation)) && page.includes(String(taskStats)), "the page runs the tested shell, card, station-order and in-place live source");
assert.ok(page.includes(`const PRIORITY_RANK = ${JSON.stringify(PRIORITY_RANK)}`), "the client defines the rank map the station order and the ruler read");

// layout: a seven-track grid, done slightly wider, the station body as the vertical scroller
assert.match(themeCss, /#board \{[^}]*display: grid/, "the board is a grid, not a column flex row");
assert.match(themeCss, /#board \{[^}]*grid-template-columns: repeat\(6, minmax\(9\.375rem, 1fr\)\) minmax\(9\.375rem, 1\.15fr\)/, "six equal station tracks and a slightly wider done track, each with the same rem floor at every width");
assert.ok(!/@media \(max-width: 1099px\)/.test(themeCss), "no hand-picked breakpoint carries the floor: the base template holds it at every width");
// #374 the body base scales the type with the viewport and stops at 1rem
assert.match(themeCss, /body \{[^}]*font-size: clamp\(0\.875rem, 0\.35vw \+ 0\.55rem, 1rem\)/, "the body base clamps 14px to 16px, so a wide screen reads one step larger");
assert.match(themeCss, /\.spine \{[^}]*grid-column: 1 \/ -1/, "the hairline spans every station as one grid item");
// #403 the phone block gives each head its own rule, so this guard reads the desktop part of the sheet
const desktopCss = themeCss.slice(0, themeCss.indexOf(`@media (max-width: ${MOBILE_MAX}px)`));
assert.ok(!/\.st-head[^{]*\{[^}]*border-top/.test(desktopCss), "the desktop hairline is not a per-station top border");
assert.match(themeCss, /\.station \.cards \{[^}]*overflow-y: auto/, "vertical spill scrolls inside each station");
assert.match(themeCss, /\.c-top \{[^}]*flex-wrap: wrap/, "the top row wraps the live cell instead of clipping it at 150px");
assert.match(themeCss, /\.c-live \{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis/, "the live cell ellipsizes inside the card instead of clipping at the station edge");
assert.match(themeCss, /\.c-meta \{[^}]*flex-wrap: wrap/, "the meta row wraps instead of clipping the labels at 150px");
assert.match(themeCss, /#board \{[^}]*overflow-y: hidden/, "the board never scrolls the page vertically");
assert.match(themeCss, /#board \{[^}]*overflow-x: auto/, "below 1100px the board scrolls horizontally on its own");
assert.match(themeCss, /\.station\.live \.st-head::before \{[^}]*box-shadow: 0 0 6px var\(--ac\)/, "a station with a running agent glows its tick, which already carries the station tint at rest");
assert.ok(page.includes("el.tabIndex = 0") && page.includes('if (e.key === "Enter" && !onMarker(e))'), "a card link is keyboard focusable and Enter opens the current card unless the marker holds the focus");
assert.match(themeCss, /\.card:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--link\)/, "a focused card shows the visible ring");

// accents: the stylesheet points each station class at a stage accent token the theme declares
const declared = new Set([...page.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
assert.ok(STATIONS.every((s, i) => page.includes(`.s-${s.id} { --ac: var(--accent-${s.accent}); --ac-t: var(--accent-${s.accent}-text); --ac-prev: var(--accent-${STATIONS[Math.max(0, i - 1)].accent}); }`)), "each station points --ac at its own accent token, --ac-t at that accent's -text step and --ac-prev at the station before it, so the glow walks the ladder");
assert.ok(STATIONS.every((s) => declared.has(`--accent-${s.accent}`) && declared.has(`--accent-${s.accent}-text`)), "each station accent names a token the theme declares, and so does its -text step");

// stage flags: only the integration station switches off, and it leaves a strip
const off = (id: string) => stations[id].el.className.split(" ").includes("strip");
applyStages(stations, { reviews: false, liveTesting: true, integrationTesting: false });
assert.ok(off("integration") && stations.integration.el.attrs.title === "integration test: off in config" && stations.integration.el.attrs["aria-label"] === "integration test: off in config", "a disabled integration stage is a strip that says so in title and aria-label");
assert.ok(boardEl.className.split(" ").includes("off-integration") && !off("review"), "the integration strip narrows its own grid track and no other station turns off");
assert.ok(stations.review.el.className.split(" ").includes("dim"), "a disabled review stage dims but keeps its station");
applyStages(stations, DEFAULT_STAGES);
assert.ok(STATIONS.every((s) => !off(s.id)) && !boardEl.className.split(" ").includes("off-integration"), "all-on stages restore every station");
assert.ok(!stations.integration.el.attrs.title, "the strip title drops when the stage turns on");
assert.ok(page.includes(String(applyStages)), "the page ships the tested stage toggle");

// the state picks the animation: only the states the orchestrator works on carry the spinner
const WORKING = ["doing", "reviewing", "live-testing", "merging", "integration-testing"];
assert.ok(WORKING.every((st) => spinnerHtml(st).includes('<span class="spin">')), "every working state renders the spinner");
assert.ok(STATES.filter((st) => !WORKING.includes(st)).every((st) => spinnerHtml(st) === ""), "no waiting or finished state renders one");
// PAGE interpolates spinnerHtml as source, so the served copy must resolve with no module scope
const servedSpinner = new Function(page.match(/function spinnerHtml\([\s\S]*?\n\}/)![0] + "; return spinnerHtml;")() as (st: string) => string;
assert.equal(servedSpinner("doing"), '<span class="spin"></span>', "the served spinner source runs in the page scope (no module constant)");
assert.equal(servedSpinner("to-do"), "", "the served spinner source returns empty for an idle state");

// the card anatomy (000366): number, ruler and live cell on top, the name, the context line, the
// run row, then the meta row; every optional row drops when empty
const liveRun = { role: "developer", run: 0, alive: true, status: "live", handle: "h", tokens: 4242, duration: 1500 };
const rich = cardBaseHtml({ file: "000047_fix_x.md", name: "a & b", priority: "high", summary: "the board is rebuilt", complexity: "complex", agents: [liveRun] }, "to-do");
assert.ok(rich.startsWith('<div class="c-top">') && rich.includes('<span class="num-link num" data-task="000047_fix_x.md">#47</span>'), "the top row leads with the task number as a link");
assert.ok((rich.match(/<i class="on">/g) ?? []).length === 3 && rich.includes('class="ruler pr-high"'), "the four-step ruler fills three steps for a high priority");
assert.ok(rich.includes('<span class="c-live"><span class="c-live-text"></span></span>'), "a live run gets the top-right live cell, filled only by the in-place pass");
assert.ok(!rich.includes("card-tokens"), "the id row ends at the live cell, so a phone card keeps its own rows");
assert.ok(rich.includes('<div class="name">a &amp; b</div>'), "the name is escaped and carries no priority tint");
assert.ok(rich.includes('<div class="ctx">the board is rebuilt</div>'), "an idle card shows its summary as the context line");
assert.ok(rich.includes('<div class="c-run"><span class="card-stats"></span></div>'), "a live run gets a run row, its values filled in place");
assert.ok(!rich.includes('class="c-p') && rich.includes('class="ruler pr-high"') && rich.includes('<span class="c-cx cx-complex">complex</span>') && rich.includes('<span class="c-issuer">user</span>') && !rich.includes('class="chip'), "the ruler alone carries the priority, so the meta row keeps only the complexity and issuer labels");
// #404 no card names its own state: the column head and the agent pill already say it, so every state
// of every station renders the same meta row, looped over the station table so a new state is covered
for (const st of STATIONS.flatMap((s) => [...s.states])) {
	const card = cardBaseHtml({ file: "000057_u.md", name: "u", priority: "low" }, st);
	assert.ok(!card.includes('<span class="sub-state">') && !card.includes('class="chip'), `a ${st} card prints no state chip`);
}
assert.ok(cardBaseHtml({ file: "000050_o.md", name: "o", priority: "low", blockedBy: "user" }, "to-do").includes('<button type="button" class="c-wait held"'), "a held task gets the held marker in the meta row");
assert.ok(!cardBaseHtml({ file: "000051_p.md", name: "p", priority: "low" }, "to-do").includes("c-live"), "an idle card gets no live cell");
assert.ok(!cardBaseHtml({ file: "000052_q.md", name: "q", priority: "low" }, "to-do").includes("ctx"), "a card without a summary drops the context line");
const deadCard = cardBaseHtml({ file: "000053_r.md", name: "r", priority: "low", agents: [{ ...liveRun, alive: false, status: "dead" }] }, "to-review");
assert.ok(deadCard.includes('<div class="c-run dead">') && !deadCard.includes("c-live"), "a dead run keeps the run row, turns it red and leaves the card neutral");
assert.ok(cardBaseHtml({ file: "000054_s.md", name: "s", priority: "low", issuer: "#42" }, "to-do").includes('<div class="name issued">') && cardBaseHtml({ file: "000054_s.md", name: "s", priority: "low", issuer: "#42" }, "to-do").includes('<span class="c-issuer">#42</span>'), "a task-issued card dims its name and carries its issuer");
assert.ok(cardBaseHtml({ file: "000055_t.md", name: "t", priority: "low" }, "to-do").includes('<span class="c-issuer">user</span>'), "a user-issued card names its issuer plainly");
assert.equal(priorityRuler("critical") + "", priorityRuler("critical"), "the ruler is a pure string");
assert.ok((priorityRuler("critical").match(/<i class="on">/g) ?? []).length === 4 && (priorityRuler("low").match(/<i class="on">/g) ?? []).length === 1, "the four ruler steps read apart for critical and low");
assert.equal(numLinkHtml('000048_quo"te.md'), '<span class="num-link" data-task="000048_quo&quot;te.md">#48</span>', "the data-task file hook is escaped");
// the live values stay out of the base markup, so a poll can never rewrite the card under them
const baseOf = (tokens: number, duration: number) => cardBaseHtml({ file: "000056_l.md", name: "l", priority: "high", agents: [{ ...liveRun, tokens, duration }] }, "doing");
assert.equal(baseOf(420, 1500), baseOf(9999, 90000), "the base markup carries no token or elapsed value, so the spinner never restarts on a poll");
assert.ok(taskStats({ agents: [{ tokens: 420, duration: 1500 }, { tokens: 1580, duration: 2000 }] }) === "2k · 4s", "the run row totals the agent entries");
assert.equal(taskStats({ agents: [{ duration: 2000 }] }), "", "an entry with no usage record leaves the run row empty, so the card prints no bare number");

// #373 the waits-on marker: the resting fact that a relation exists, in the card meta row. A ref
// resolves through the board's own task list, a done blocker counts as satisfied, and the `user`
// token is the hold, not a blocker
const boardTasks = [
	{ file: "000004_d.md", name: "d", priority: "low", state: "to-do" },
	{ file: "000005_e.md", name: "e", priority: "low", state: "to-review" },
	{ file: "000006_f.md", name: "f", priority: "low", state: "done" },
	{ file: "000007_g.md", name: "g", priority: "low", state: "merging" },
];
const markerOf = (blockedBy: string, all: any[] = boardTasks) =>
	cardBaseHtml({ file: "000002_b.md", name: "b", priority: "low", blockedBy }, "to-do", all).match(/<button type="button" class="c-wait[^"]*"[^>]*>([^<]*)<\/button>/);
assert.equal(markerOf(""), null, "a card with no blockedBy shows no marker");
assert.equal(markerOf("#4")?.[1], "waits on 1", "one unsatisfied blocker names the wait");
assert.equal(markerOf("#4, #5, #7")?.[1], "waits on 3", "three blockers count as one wait");
assert.equal(markerOf("#6")?.[1], "waits on 1 ✓", "a satisfied blocker is a check, not a wait");
assert.equal(markerOf("#4, #6")?.[1], "waits on 1", "a mixed set waits on the unsatisfied blockers only");
assert.equal(markerOf("user")?.[1], "user", "the hold marker names the stored blockedBy token, not the word held");
assert.equal(markerOf("USER")?.[1], "USER", "and keeps the token's stored case");
assert.equal(markerOf("user, #4")?.[1], "user waits on 1", "a held task that also waits shows the hold first, then the wait");
assert.ok((markerOf("user")?.[0] ?? "").includes('aria-label="blocked by user"'), "the hold's accessible name spells the relation out instead of reading the token twice");
assert.ok((markerOf("user, #4")?.[0] ?? "").includes('aria-label="blocked by user, waits on 1: #4"'), "a hold that also waits names both relations and the refs");
assert.equal(markerOf("#9, junk"), null, "a ref no task resolves leaves no marker");
assert.ok((markerOf("#4, #5")?.[0] ?? "").includes('aria-label="waits on 2: #4, #5"'), "the marker's accessible name lists the refs");
assert.ok((markerOf("#4")?.[0] ?? "").includes('data-wait="#4"'), "the marker carries its refs as data for the popover");
const markerCard = cardBaseHtml({ file: "000002_b.md", name: "b", priority: "low", blockedBy: "#4" }, "to-do", boardTasks);
assert.ok(markerCard.indexOf('<div class="c-meta">') < markerCard.indexOf('class="c-wait"'), "the marker sits in the meta row, so the name and the context line stay put");

// relation lines: one dashed curve per stored relation between rendered cards, running from the
// blocked task's card to the blocker's card. A done blocker, a ghost ref and a blocker with no
// rendered card never draw a curve: the last one is an explicit off-board entry instead.
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
assert.deepEqual(same.map((p) => [p.file, p.blocker]), [["000002_b.md", "000004_d.md"]], "one curve per stored relation, keyed by the blocked and the blocker file so the hover highlight reaches it both ways (000144)");
assert.ok(same[0].d.startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`), "the path starts at the blocked card's right edge");
assert.ok(same[0].d.endsWith(`310 ${midY(rects["000004_d.md"])}`), "same station: the path enters the blocker's left edge, wrapping behind the cards");
assert.deepEqual(
	relationPaths([
		{ file: "000002_b.md", state: "to-do", blockedBy: "#4" },
		{ file: "000004_d.md", state: "doing", blockedBy: "" },
	], rectOf)[0],
	same[0],
	"two states in one station at one x draw the same wrap",
);
const cross = relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#1, #3" },
	{ file: "000001_a.md", state: "backlog", blockedBy: "" },
	{ file: "000003_c.md", state: "to-review", blockedBy: "" },
], rectOf);
assert.equal(cross.length, 2, "multiple blockers draw one curve each");
assert.ok(
	cross[0].d.startsWith(`M ${310 + 280} ${midY(rects["000002_b.md"])}`) &&
		cross[0].d.endsWith(`0 ${midY(rects["000001_a.md"])}`) &&
		cross[1].d.endsWith(`620 ${midY(rects["000003_c.md"])}`),
	"a blocker left or right of the blocked card still gets the out-right/into-left wrap",
);
assert.equal(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#3" },
	{ file: "000003_c.md", state: "done", blockedBy: "" },
], rectOf).length, 0, "a done blocker draws nothing");
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#9, junk, , " }], rectOf).length, 0, "ghost and unparseable refs draw nothing");
assert.deepEqual(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#1" }], rectOf), [], "a ref that resolves to no task at all draws nothing");
// #373 a blocker that resolves to a real task but has no rendered card is an explicit off-board
// entry naming its station, not a silent drop; the entry carries no geometry
const offPaths = relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#4, #7, #6, user" },
	{ file: "000004_d.md", state: "to-do" },
	{ file: "000006_f.md", state: "done" },
	{ file: "000007_g.md", state: "to-review" },
], rectOf);
assert.deepEqual(offPaths.map((p) => [p.file, p.blocker, !!p.offBoard]), [["000002_b.md", "000004_d.md", false], ["000002_b.md", "000007_g.md", true]], "a rendered blocker draws a curve, an off-board blocker is an entry, and a done blocker and the hold drop");
assert.equal(offPaths[1].station, "Review", "the off-board entry names the station its blocker sits in");
assert.ok(!offPaths[1].d, "an off-board entry carries no geometry");
assert.deepEqual(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#1" },
	{ file: "000001_a.md", state: "to-do" },
], () => null), [], "a blocked card with no rendered card has no stub to carry");
assert.deepEqual(relationPaths([{ file: "000002_b.md", state: "to-do" }], rectOf), [], "an older payload without blockedBy draws nothing");
assert.deepEqual(relationPaths([
	{ file: "000002_b.md", state: "to-do", blockedBy: "#4" },
	{ file: "000004_d.md", state: "to-do", blockedBy: "" },
], rectOf, true), [], "#370 the vertical spine stacks every card in one column, so a cross-station curve has no span: the phone layout draws no relation line");

// the served client script's hotRelations lights the paths that touch the file at either end: a hover
// on a blocker raises the same line, and an unrelated file raises nothing
const hotPath: any = { dataset: { file: "000002_b.md", blocker: "000004_d.md" }, hot: new Set<string>() };
hotPath.classList = { toggle: (cls: string, on: boolean) => (on ? hotPath.hot.add(cls) : hotPath.hot.delete(cls)) };
// #373 the reveal: the board gains a class, the blockers are rimmed, every other card dims, and
// keyboard focus runs the same pass as hover
const hotCard = (file: string) => {
	const el: any = { dataset: { file }, cls: new Set<string>() };
	el.classList = { toggle: (c: string, on: boolean) => (on ? el.cls.add(c) : el.cls.delete(c)) };
	return el;
};
const hotBoard: any = { cls: new Set<string>() };
hotBoard.classList = { toggle: (c: string, on: boolean) => (on ? hotBoard.cls.add(c) : hotBoard.cls.delete(c)) };
const hotCards = ["000002_b.md", "000004_d.md", "000009_x.md"].map(hotCard);
const hotDoc = {
	querySelectorAll: (sel: string) => (sel === "#relations path" ? [hotPath] : sel === "#board .card" ? hotCards : []),
	getElementById: (id: string) => (id === "board" ? hotBoard : null),
};
const hotFn = (new Function("document", page.match(/<script>([\s\S]*?)<\/script>/)![1].match(/function hotRelations\(file, on\) \{[\s\S]*?\n\}/)![0] + "; return hotRelations;") as (d: unknown) => (file: string, on: boolean) => void)(hotDoc);
hotFn("000002_b.md", true);
assert.ok(hotPath.hot.has("relations-hot"), "hovering the blocked card highlights its outgoing line");
assert.ok(hotBoard.cls.has("reveal"), "hovering a card reveals the relation layer");
assert.ok(hotCards[0].cls.has("hot") && !hotCards[0].cls.has("rim"), "the active card stays lit and takes no rim");
assert.ok(hotCards[1].cls.has("hot") && hotCards[1].cls.has("rim"), "a rendered blocker is rimmed and stays lit");
assert.ok(!hotCards[2].cls.has("hot") && !hotCards[2].cls.has("rim"), "an unrelated card only dims");
hotFn("000002_b.md", false);
assert.ok(!hotBoard.cls.has("reveal") && !hotCards[1].cls.has("rim"), "leaving the card drops the reveal and the rims");
hotFn("000009_x.md", true);
assert.ok(!hotPath.hot.has("relations-hot"), "mouseleave reverts the highlight and an unrelated file raises nothing");
hotFn("000004_d.md", true);
assert.ok(hotPath.hot.has("relations-hot"), "hovering the blocker card lights the same line, because a reveal runs in both directions");
assert.ok(hotCards[0].cls.has("rim"), "the card that waits on the hovered blocker takes the rim, so line and ring read as one connection");
assert.ok(hotCards[0].cls.has("hot"), "a line whose blocker is the hovered file keeps its blocked card lit, so no bright line starts on a dimmed card");
assert.ok(!hotCards[2].cls.has("hot") && !hotCards[2].cls.has("rim"), "an unrelated card is lit by nothing in the reverse direction too");

// #373 the stylesheet reads by selector and property: the marker is a button with a hit floor that
// never wraps and sits right aligned, the lines exist only during a reveal, the dim keeps the marker
// text readable, and the popover is a floating panel the card cannot clip
const cssRule = (sel: string) => themeCss.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"))?.[1] ?? "";
assert.match(cssRule(".c-wait"), /white-space: nowrap/, "the marker never wraps, so it stays on one line");
assert.ok(Number(cssRule(".c-wait").match(/min-height: (\d+)px/)![1]) >= 28, "the marker keeps its 28px hit height");
assert.ok(!/margin-left/.test(cssRule(".c-wait")) && /margin-left: auto/.test(cssRule(".c-issuer")), "the issuer alone takes the row's auto margin, so the marker sits beside it at the right edge with no hole between");
assert.match(cssRule("#relations"), /opacity: 0/, "no curve at rest");
assert.match(cssRule("#relations path"), /stroke-opacity: 0/, "a plain line paints nothing, so a reveal lights only the hovered card's paths");
assert.match(cssRule("#relations path.relations-hot"), /stroke: var\(--link\)/, "the lit line takes the link colour of the blocker's rim");
assert.match(cssRule("#relations path.relations-hot"), /stroke-opacity: 1/, "the lit line is full strength");
assert.match(themeCss, /#board\.reveal #relations \{[^}]*opacity: 1/, "a reveal paints the relation layer");
assert.match(themeCss, /#board\.reveal \.card:not\(\.hot\) \{[^}]*opacity: \.55/, "an unrelated card dims to 55 percent, not 40, so the marker text stays readable");
assert.match(cssRule("#waits-pop"), /position: fixed/, "the popover floats over the board instead of inside a scrolling card");
assert.match(themeCss, new RegExp(`@media \\(max-width: ${MOBILE_MAX}px\\) \\{[\\s\\S]*?\\.c-wait`), "the phone layout gives the marker the 44px touch floor");
// #416 a phone archive row is the number, the name and the token total: the chip, the duration and
// the date drop, and no phone rule touches the token cell, so it keeps the base rule's right alignment
const phoneArchive = themeCss.slice(themeCss.lastIndexOf("@media (max-width: " + MOBILE_MAX + "px)"));
assert.ok(phoneArchive.includes(".arch-row .arch-cx, .arch-row .arch-dur, .arch-row .arch-date { display: none; }"), "the phone archive block hides the complexity chip, the duration and the date");
assert.ok(!phoneArchive.includes(".arch-tok") && /text-align: right/.test(cssRule(".arch-tok, .arch-dur")), "the token cell keeps its place at the row's right edge on a phone");

// #373 the popover wiring: one popover keyed by file so a poll leaves it open, Escape restores the
// marker, and a rendered row scrolls its blocker's card into view
assert.ok(page.includes('pop.id = "waits-pop"') && page.includes("if (waitFile === file) closeWaits(true)"), "the client ships one popover at a time, keyed by file");
assert.ok(page.includes("function closeWaits(restore)") && page.includes(".scrollIntoView({ block: \"nearest\""), "the close restores focus and a rendered row reaches the blocker card");

// #393 the popover anchors to the marker row: both axes come from the marker rect, so a card that
// is taller than the one-row popover cannot push it a card height above the row it belongs to
const popAt = (marker: any, cardRect: any) => {
	const pop = { offsetWidth: 200, offsetHeight: 40, style: {} as any };
	const place = new Function("verticalSpine", "innerWidth", page.match(/function placeWaits\(pop, card\) \{[\s\S]*?\n\}/)![0] + "; return placeWaits;")(
		() => false,
		1000,
	) as (pop: any, card: any) => void;
	place(pop, { querySelector: () => ({ getBoundingClientRect: () => marker }), getBoundingClientRect: () => cardRect });
	return pop.style;
};
const above = popAt({ left: 300, top: 500, bottom: 528 }, { left: 100, top: 100, bottom: 460 });
assert.equal(above.top, "452px", "with room above, the desktop popover sits 8px over the marker row, not the card");
assert.equal(above.left, "300px", "the left edge comes from the same marker rect");
const below = popAt({ left: 300, top: 20, bottom: 48 }, { left: 100, top: 10, bottom: 400 });
assert.equal(below.top, "56px", "without room above the marker, the popover drops under the marker row");

// #393 the popover is fixed while the cards move, so a scroll of the board or of a station body
// closes it the same way an outside click does, instead of leaving it at a stale position
const scrollHandler = page.match(/document\.addEventListener\("scroll", (.+?), true\)/)![1];
const scrollClose = (file: string | null, calls: string[]) =>
	(new Function("waitFile", "closeWaits", `return ${scrollHandler}`) as any)(file, (restore: unknown) => calls.push(String(restore)));
const scrollCalls: string[] = [];
scrollClose(null, scrollCalls)();
assert.deepEqual(scrollCalls, [], "a scroll with no popover open closes nothing");
scrollClose("000002_b.md", scrollCalls)();
assert.deepEqual(scrollCalls, ["false"], "an open popover closes on a scroll without taking focus back");

// 000127/000236: far-apart cards bend the line into an S (the control offsets scale with the
// span, capped); same-row pairs clamp the offset inside the span, because a same-row cubic is
// collinear and any control past an endpoint retraces the line
const parseCurve = (d: string) => d.match(/^M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/)!.slice(1).map(Number);
const [sx1, , sc1x, , sc2x, , sx2] = parseCurve(same[0].d);
assert.ok(sc1x === sx1 + 280 * 0.35 && sc2x === sx2 - 280 * 0.35, "a same-station wrap scales both control offsets with the span");
const [lx1, , lc1x, , lc2x, , lx2] = parseCurve(cross[0].d);
assert.ok(lc1x >= lx2 && lc1x <= lx1 && lc2x >= lx2 && lc2x <= lx1, "a same-row blocker keeps both controls inside the span, so the straight line never doubles back");
const [rx1, , rc1x, , rc2x, , rx2] = parseCurve(cross[1].d);
assert.ok(rc1x === rx1 + (rx2 - rx1) / 2 && rc1x <= rx2 && rc2x >= rx1, "the clamp halves the bow floor on a narrow same-row gap, so the bezier never overshoots the entry point");
const farRects = { ...rects, "000005_e.md": { x: 700, y: 70, w: 280, h: 60 }, "000006_f.md": { x: 2000, y: 70, w: 280, h: 60 } };
const farOf = (f: string) => farRects[f] ?? null;
const farTasks = (file: string) => [
	{ file, state: "to-do", blockedBy: "#1" },
	{ file: "000001_a.md", state: "backlog", blockedBy: "" },
];
const [fx1, fy1, fc1x, fc1y, fc2x, fc2y, fx2, fy2] = parseCurve(relationPaths(farTasks("000005_e.md"), farOf)[0].d);
const farSpan = Math.abs(fx2 - fx1);
assert.ok(fc1y === fy1 && fc2y === fy2 && fc1x === fx1 + farSpan * 0.35 && fc2x === fx2 - farSpan * 0.35, "far-apart cards leave and arrive horizontally, both control offsets scaling with the span");
const capped = parseCurve(relationPaths(farTasks("000006_f.md"), farOf)[0].d);
assert.ok(capped[2] === capped[0] + 480 && capped[4] === capped[6] - 480, "an extreme width caps both control offsets at 480 so the curve never overshoots the board");

// the page runs the tested helpers and ships the overlay wiring
assert.ok(page.includes(String(numLinkHtml)) && page.includes(String(curve)) && page.includes(String(relationPaths)), "the page ships the tested id-link and relation helpers");
assert.match(page, /#board \{[^}]*position: relative/, "#board is the overlay's containing block, so the lines scroll with the content");
const zOf = (sel: string) => Number(page.match(new RegExp(sel + " \\{[^}]*z-index: (\\d+)"))?.[1]);
assert.ok(zOf(".card") > zOf("#relations"), "the task cards paint above the relation overlay");
assert.ok(page.includes('setAttribute("pointer-events", "none")') && page.includes('window.addEventListener("resize", queueRelations)'), "the overlay is created non-interactive and a window resize queues a recompute of the line endpoints");
// #392 the redraw triggers: one coalescing queue behind requestAnimationFrame, a capture scroll
// listener on the board (the station bodies are rebuilt by every render) and an observer on the
// board (the docked panel narrows it through a class toggle, which fires no resize)
const queueSrc = page.match(/function queueRelations\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
const relationCalls = page.split("\n").filter((l) => l.includes("drawRelations(") && !l.includes("function drawRelations"));
assert.ok(relationCalls.length === 1 && queueSrc.includes(relationCalls[0]), "one redraw entry: no handler draws directly, render and transitionend and the triggers all route through the queue");
assert.ok(queueSrc.includes("if (relationsFrame) return") && queueSrc.includes("requestAnimationFrame("), "a burst of triggers yields one draw per frame");
assert.ok(page.includes('board.addEventListener("scroll", queueRelations, true)'), "one capture scroll listener on the board redraws after any station body scrolls");
assert.ok(page.includes("new ResizeObserver(queueRelations).observe(board)"), "the observer on the board redraws when the docked panel narrows it");
// #402 the reveal follows the event, not the device: a mouse hover arms and clears, a finger or a
// pen arms for the press alone, and only a keyboard focus arms, so a hybrid device keeps both
const cardWire = (focusVisible: boolean) => {
	const el: any = { dataset: {}, classList: { remove: () => {} }, matches: (sel: string) => sel === ":focus-visible" && focusVisible };
	const calls: Array<[string, boolean]> = [];
	const src = page.match(/function makeCard\(file\) \{[\s\S]*?\n\}/)![0];
	const makeCard = new Function("document", "hotRelations", "openTask", `${src}; return makeCard;`)(
		{ createElement: () => el },
		(f: string, on: boolean) => calls.push([f, on]),
		() => {},
	) as (file: string) => void;
	makeCard("000002_b.md");
	return { el, calls, src };
};
const hybrid = cardWire(false);
hybrid.el.onpointerenter({ pointerType: "mouse" });
assert.deepEqual(hybrid.calls.at(-1), ["000002_b.md", true], "a mouse hover arms the reveal, even on a device whose touch screen reports hover: hover");
hybrid.el.onpointerleave({ pointerType: "mouse" });
assert.deepEqual(hybrid.calls.at(-1), ["000002_b.md", false], "the mouse leaving clears it");
hybrid.el.onpointerdown({ pointerType: "mouse" });
hybrid.el.onpointerup({ pointerType: "mouse" });
assert.equal(hybrid.calls.length, 2, "a mouse press and release change nothing, so a click does not arm a press-scoped reveal");
for (const type of ["touch", "pen"]) {
	hybrid.el.onpointerdown({ pointerType: type });
	assert.deepEqual(hybrid.calls.at(-1), ["000002_b.md", true], `a ${type} press arms the reveal for the touched card`);
	for (const ev of ["pointerup", "pointercancel"]) {
		hybrid.el.onpointerdown({ pointerType: type });
		hybrid.el["on" + ev]({ pointerType: type });
		assert.deepEqual(hybrid.calls.at(-1), ["000002_b.md", false], `the ${type} ${ev} clears the reveal on lift`);
	}
}
const tapped = hybrid.calls.length;
hybrid.el.onfocus();
assert.equal(hybrid.calls.length, tapped, "a focus that is not :focus-visible (after a tap or a click) arms nothing");
hybrid.el.onblur();
assert.deepEqual(hybrid.calls.at(-1), ["000002_b.md", false], "blur still clears");
const keyboard = cardWire(true);
keyboard.el.onfocus();
assert.deepEqual(keyboard.calls.at(-1), ["000002_b.md", true], "a keyboard focus through Tab arms the reveal on any device");
keyboard.el.onblur();
assert.deepEqual(keyboard.calls.at(-1), ["000002_b.md", false], "blur clears the keyboard reveal");
// #402 no device query decides the reveal: each event's pointer type and :focus-visible do
assert.ok(!/matchMedia|coarsePointer/.test(hybrid.src + (page.match(/const clearReveal = [^\n]*/)?.[0] ?? "")), "no matchMedia call and no device query remain in the reveal path");
// #398 the panel path clears the reveal, so no stuck selection survives the open or the close
assert.ok(page.includes("const clearReveal = () => hotRelations(null, false)"), "one clear drops the reveal through the same switch");
for (const fn of ["openTask", "showPanel", "hidePanel"]) {
	const src = page.match(new RegExp(`function ${fn}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
	assert.ok(src.includes("clearReveal()"), `${fn} clears the reveal, so no stuck state survives the open or the close`);
}
assert.ok(page.includes("const mine = p.dataset.file === file || p.dataset.blocker === file;") && page.includes('p.classList.toggle("relations-hot", on && mine)'), "the hover matches a path that touches the hovered file at either end, so the lines to its blockers and the lines from the cards that wait on it both light, with no quote-unsafe selector interpolation");
assert.ok(page.includes('" data-blocker="'), "each relation path carries the blocker's file alongside the blocked task's file");
assert.ok(page.includes('facts.querySelectorAll(".num-link")') && page.includes("openTask(a.dataset.task)"), "the panel binds its id links to openTask through the facts block");
assert.ok(page.includes(">blockedBy</span>"), "the panel builds a blockedBy row");
// #392 the drawn endpoint lives in board content coordinates: the board's own scroll is added back
// and a station body's inner scroll never is, because the overlay is absolute in the board. The FLIP
// box keeps the station scroll, which the re-render resets before the settled positions are measured
const boardBox: any = { getBoundingClientRect: () => ({ left: 0, top: 0 }), scrollLeft: 10, scrollTop: 20 };
const stationBox: any = { scrollLeft: 0, scrollTop: 40, parentElement: boardBox };
const boxCard: any = { getBoundingClientRect: () => ({ left: 100, top: 300, width: 280, height: 60 }), parentElement: stationBox };
const cardBoxOf = new Function("document", page.match(/function cardBox\([^)]*\) \{[\s\S]*?\n\}/)![0] + "; return cardBox;")({ getElementById: () => boardBox } as any) as (el: unknown, flip?: boolean) => { x: number; y: number; w: number; h: number };
assert.deepEqual(cardBoxOf(boxCard), { x: 110, y: 320, w: 280, h: 60 }, "the drawn endpoint adds the board's own scroll and never a station body's inner scroll, so a scrolled station keeps its lines on its cards");
assert.deepEqual(cardBoxOf(boxCard, true), { x: 110, y: 360, w: 280, h: 60 }, "the FLIP measurement still adds the station scroll, which the next render resets");

// refresh identity: the 5 s poll keeps the node of every card whose markup did not change, so its
// spinner element keeps spinning; a state change rewrites that card's markup and nothing else
const els = new Map<string, El>();
const make = (file: string) => { const c = new El("div"); c.className = "card"; c.dataset.file = file; return c; };
const sync = (list: any[], open: Set<string> = new Set()) => syncBoard(stations, list, open, els, make, 5, { createElement: (tag: string) => new El(tag) });
const shown = (id: string) => stations[id].cards.children.filter((c: El) => c.className.split(" ")[0] === "card").map((c: El) => c.dataset.file);
const tasksA = [
	{ file: "000001_a.md", name: "feat: a", priority: "high", state: "doing", updated: 2 },
	{ file: "000002_b.md", name: "feat: b", priority: "low", state: "backlog", updated: 1 },
];
sync(tasksA);
const cardA = els.get("000001_a.md")!;
assert.ok(cardA.innerHTML.includes('<span class="spin">'), "a doing card carries the spinner");
assert.equal(cardA.writes, 1, "the first pass writes the card markup");
assert.deepEqual([cardA.dataset.file, cardA.dataset.num, cardA.dataset.state], ["000001_a.md", "1", "doing"], "the card element carries file, number and state hooks after the pass");
sync(tasksA);
assert.equal(els.get("000001_a.md"), cardA, "an unchanged card keeps its DOM node across a refresh");
assert.equal(cardA.writes, 1, "and its markup is not rewritten, so its spinner animation keeps running");
sync(tasksA.map((t) => (t.file === "000001_a.md" ? { ...t, state: "to-do", updated: 3 } : t)));
assert.ok(els.get("000001_a.md") === cardA && cardA.dataset.state === "to-do", "a card that changes station keeps its node, so FLIP can move it, and its state hook follows");
assert.deepEqual([shown("queue"), shown("work")], [["000002_b.md"], ["000001_a.md"]], "a card that becomes to-do stays in Work, and Backlog keeps the card that is still backlog");
assert.equal(cardA.writes, 2, "a state change rewrites the markup once");
assert.ok(!cardA.innerHTML.includes("spin"), "leaving a working state stops the spinner");
sync(tasksA);
assert.ok(cardA.innerHTML.includes('<span class="spin">'), "entering a working state starts the spinner");

// 000191 motion: a genuinely new card gains the one-shot entrance class at insertion, and neither
// an unchanged poll nor a markup rewrite ever re-adds it; only new cards are inserted (nodes kept)
assert.ok(cardA.className.includes("enter"), "a card created this pass carries the entrance class");
const later = { file: "000003_c.md", name: "feat: c", priority: "low", state: "backlog", updated: 4 };
sync([...tasksA, later]);
assert.ok(els.get("000003_c.md")!.className.includes("enter"), "a later insertion gains the entrance class too");
assert.equal(cardA.className, "card enter running", "an unchanged card keeps the entrance class exactly once and its running hook");
sync([{ ...tasksA[0], state: "to-do", updated: 5 }, later]);
assert.equal(cardA.className, "card enter", "a state rewrite does not re-add the entrance class");

// 000191/000366 in-place live cells: a poll or a stats-only change updates the live cell and the
// run row without rewriting the card markup, so the .spin node keeps its animation
const liveTask = { file: "000004_d.md", name: "feat: d", priority: "high", state: "doing", updated: 6, agents: [{ role: "developer", run: 0, alive: true, status: "live", handle: "h", tokens: 420, duration: 1500 }] };
sync([liveTask]);
const cardD = els.get("000004_d.md")!;
assert.equal(cardD.writes, 1, "a live card writes its base markup once");
assert.equal(cardD.querySelector(".c-live-text")!.textContent, "Developer · 420 · 2s", "the live cell fills in place with the role, the tokens and the elapsed time, in the run row's order");
assert.ok(cardD.querySelector(".c-live-text")!.textContent!.indexOf("420") < cardD.querySelector(".c-live-text")!.textContent!.indexOf("2s"), "the live cell reads the tokens before the time");
assert.equal(cardD.querySelector(".card-stats")!.textContent, "420 · 2s", "the run row fills in place with the run totals");
sync([{ ...liveTask, agents: [{ ...liveTask.agents[0], tokens: 900, duration: 2500 }] }]);
assert.equal(cardD.writes, 1, "a stats-only change does not rewrite the card markup, the spinner animation survives");
assert.equal(cardD.querySelector(".c-live-text")!.textContent, "Developer · 900 · 3s", "the live cell follows the poll, tokens included");
assert.equal(cardD.querySelector(".card-stats")!.textContent, "900 · 3s", "the run row follows the poll");
sync([{ ...liveTask, agents: [{ ...liveTask.agents[0], tokens: 82000, duration: 2500 }] }]);
assert.equal(cardD.querySelector(".card-stats")!.textContent, "82k · 3s", "the run row sums the entries itself again, so the card keeps no separate token cell");
sync([{ ...liveTask, agents: [{ ...liveTask.agents[0], tokens: null }] }]);
assert.equal(cardD.querySelector(".c-live-text")!.textContent, "Developer · 2s", "an agent with no usage record reads the label and the duration with no trailing separator");
sync([{ ...liveTask, agents: [] }]);
assert.ok(cardD.writes === 2 && !cardD.querySelector(".card-stats") && !cardD.querySelector(".c-live-text"), "a run that ends drops both live slots and keeps the card node");
sync([{ file: "000005_e.md", name: "feat: e", priority: "low", state: "to-do", updated: 7, agents: [{ role: "reviewer", run: 0, alive: false, status: "dead", handle: "g", tokens: 5, duration: 900 }] }]);
const cardE = els.get("000005_e.md")!;
assert.ok(cardE.innerHTML.includes('<div class="c-run dead">') && !cardE.innerHTML.includes("c-live"), "a dead run gets the red run row and no live cell");
assert.ok(!cardE.className.includes("dead") && !cardE.className.includes("error"), "the dead run never tints the task card itself");
assert.equal(syncCardStats.length, 2, "the in-place live pass takes the card and its task");

// the station head: a running agent lights the tick, the label and the live dot; nothing else is
// chromatic at rest
sync([{ file: "000006_f.md", name: "feat: f", priority: "high", state: "doing", updated: 1 }]);
assert.ok(stations.work.el.className.split(" ").includes("live") && stations.work.dot.style.display === "", "a station with a running agent glows and shows the live dot");
assert.equal(stations.queue.el.className.split(" ").includes("live"), false, "a station with no running agent has no glow");
assert.equal(stations.queue.dot.style.display, "none", "and no live dot");
sync([]);
assert.equal(stations.work.el.className.split(" ").includes("live"), false, "the glow drops when the run leaves the station");

// the per-station cap and unfold (000030): 5 cards, then a +N more button that unfolds in place;
// the toggle node is built once, so its focus survives the refresh
const many = Array.from({ length: 7 }, (_, i) => ({ file: `00001${i}_x.md`, name: "feat: x", priority: "low", state: "reviewing", updated: i }));
sync(many);
const toggleEl = stations.review.toggle;
assert.equal(shown("review").length, 5, "a station shows at most 5 cards");
assert.equal(toggleEl.style.display, "", "the unfold button appears past the cap");
assert.equal(toggleEl.textContent, "+2 more", "the unfold button names the cards it hides");
sync(many, new Set(["review"]));
assert.equal(stations.review.toggle, toggleEl, "the unfold button keeps its node, and with it the reader's focus");
assert.equal(shown("review").length, 7, "unfolding shows every card in place");
assert.equal(toggleEl.textContent, "show less", "an unfolded station offers show less");
assert.ok(toggleEl.style.display === "", "and keeps the button while unfolded");
sync(many.slice(1), new Set(["review"]));
assert.equal(els.has("000010_x.md"), false, "a card whose task left the board loses its node");
assert.ok(stations.integration.empty.style.display === "" && shown("integration").length === 0, "an empty station shows its job line and holds no cards");
assert.equal(stations.integration.count.textContent, "0", "an empty station still shows its count");

// 000077/000366 ordering: priority first inside every station, then newest update first, the
// stable sort keeping the payload's task-number order on equal keys; a held task pins above all.
// #374 the done station alone sorts by newest update, so it answers "what just landed"
const ordered = [
	{ file: "000001_a.md", name: "a", priority: "low", state: "backlog", updated: 100 },
	{ file: "000002_b.md", name: "b", priority: "critical", state: "to-do", updated: 1 },
	{ file: "000003_c.md", name: "c", priority: "high", state: "doing", updated: 5 },
	{ file: "000004_d.md", name: "d", priority: "high", state: "doing", updated: 9 },
	{ file: "000005_e.md", name: "e", priority: "critical", state: "reviewing", updated: 3 },
	{ file: "000006_f.md", name: "f", priority: "low", state: "reviewing", updated: 8 },
	{ file: "000007_g.md", name: "g", priority: "medium", state: "to-review", updated: 2 },
	{ file: "000008_h.md", name: "h", priority: "critical", state: "done", updated: 1 },
	{ file: "000009_i.md", name: "i", priority: "low", state: "done", updated: 9 },
];
sync(ordered, new Set(["queue", "work", "review", "done"]));
assert.deepEqual(shown("queue"), ["000001_a.md"], "the backlog station holds only the backlog state");
assert.deepEqual(shown("work"), ["000002_b.md", "000004_d.md", "000003_c.md"], "the work station interleaves its to-do and doing cards as one list, priority first, then the newest update");
assert.deepEqual(shown("review"), ["000005_e.md", "000007_g.md", "000006_f.md"], "the review station interleaves its two states by priority, then recency");
assert.deepEqual(shown("done"), ["000009_i.md", "000008_h.md"], "done shows the most recent finish first, whatever its priority");
assert.deepEqual(sortStation(ordered.filter((t) => t.state === "done")).map((t) => t.file), ["000008_h.md", "000009_i.md"], "the station order helper is exported for the page's beyond-fold fetch");
// #374 Done answers "what just landed": the recency flag puts a fresh low task above an old critical one
const recency = [
	{ file: "000020_m.md", name: "m", priority: "critical", state: "done", updated: 100 },
	{ file: "000021_n.md", name: "n", priority: "low", state: "done", updated: 900 },
];
assert.deepEqual(sortStation([...recency], { byRecency: true }).map((t) => t.file), ["000021_n.md", "000020_m.md"], "the done station puts the most recently updated task first, whatever its priority");
assert.deepEqual(sortStation([...recency]).map((t) => t.file), ["000020_m.md", "000021_n.md"], "every other station keeps priority first, so an old critical task still leads");
const heldOrders = [
	{ file: "000010_j.md", name: "j", priority: "low", state: "backlog", updated: 1, blockedBy: "user" },
	{ file: "000011_k.md", name: "k", priority: "critical", state: "backlog", updated: 9 },
	{ file: "000012_l.md", name: "l", priority: "medium", state: "backlog", updated: 8, blockedBy: "USER, #42" },
];
sync(heldOrders, new Set(["queue"]));
assert.deepEqual(shown("queue"), ["000012_l.md", "000010_j.md", "000011_k.md"], "held tasks pin above the rest of their station, in priority order among themselves");
assert.ok(isHeld({ blockedBy: "USER, #42" }) && isHeld({ blockedBy: "user" }) && !isHeld({ blockedBy: "#42" }) && !isHeld({}), "the hold test reads the user token in any case and never a task ref");
// #408 a task with a running agent pins above the rest of its station, the hold and the priority included
const liveOn = [{ role: "developer", run: 0, alive: true, status: "live", handle: "h" }];
const liveOrders = [
	{ file: "000040_p.md", name: "p", priority: "low", state: "backlog", updated: 1, blockedBy: "user" },
	{ file: "000041_q.md", name: "q", priority: "critical", state: "backlog", updated: 9 },
	{ file: "000042_r.md", name: "r", priority: "medium", state: "backlog", updated: 8, agents: liveOn },
	{ file: "000043_s.md", name: "s", priority: "critical", state: "backlog", updated: 9, agents: [{ ...liveOn[0], alive: false, status: "dead" }] },
];
sync(liveOrders, new Set(["queue"]));
assert.deepEqual(shown("queue"), ["000042_r.md", "000040_p.md", "000041_q.md", "000043_s.md"], "a live task pins above a held task and above a critical one, while a dead run pins nothing");
const twoLive = [
	{ file: "000044_t.md", name: "t", priority: "low", state: "backlog", updated: 9, agents: liveOn },
	{ file: "000045_u.md", name: "u", priority: "critical", state: "backlog", updated: 1, agents: liveOn },
];
assert.deepEqual(sortStation([...twoLive]).map((t) => t.file), ["000045_u.md", "000044_t.md"], "two live tasks keep the priority, then update order among themselves");

// 000320: the held card carries the user-hold hook every pass, so a poll adds and removes the
// pinned rule live, while the one-shot entrance class stays untouched
const heldTask = (file: string, blockedBy: string) => ({ file, name: "feat: h", priority: "low", state: "backlog", updated: 1, blockedBy });
sync([heldTask("000031_h.md", "user"), heldTask("000032_i.md", "USER, #42"), heldTask("000033_j.md", "#42")]);
const heldOf = (file: string) => els.get(file)!.className.split(" ");
assert.ok(heldOf("000031_h.md").includes("user-hold") && heldOf("000032_i.md").includes("user-hold"), "a `user` blockedBy marks the card held, any case, mixed with task refs");
assert.ok(els.get("000031_h.md")!.innerHTML.includes('class="c-wait held"'), "and the held card carries the held marker");
sync([heldTask("000031_h.md", ""), heldTask("000032_i.md", "USER, #42"), heldTask("000033_j.md", "#42")]);
assert.ok(!heldOf("000031_h.md").includes("user-hold") && heldOf("000032_i.md").includes("user-hold") && !heldOf("000033_j.md").includes("user-hold"), "the next pass drops the class once the token is gone, a still-held card stays held, a task ref alone never holds");
assert.ok(!els.get("000031_h.md")!.innerHTML.includes("c-wait"), "and drops the held marker with it");
assert.equal(els.get("000031_h.md")!.className, "card enter", "the toggle neither replays nor loses the one-shot entrance class");

// a held ref draws no relation line and prints as plain escaped text in the detail card
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "user" }], rectOf).length, 0, "a `user` ref draws no relation line");
const blockedRowOf = new Function("esc", "numLinkHtml", "taskByNum", "isHeld", page.match(/function blockedRow\(t\) \{[\s\S]*?\n\}/)![0] + "; return blockedRow;")(
	esc,
	numLinkHtml,
	(ref: string) => (ref === "#42" ? { file: "000042_x.md" } : undefined),
	isHeld,
) as (t: any) => string;
assert.equal(blockedRowOf({ blockedBy: "user" }), `<div><span class='k'>blockedBy</span><span class="held">held</span></div>`, "the hold leads the blockedBy row and the bare token never prints");
assert.equal(blockedRowOf({ blockedBy: "user, #42" }), `<div><span class='k'>blockedBy</span><span class="held">held</span>, <span class="num-link" data-task="000042_x.md">#42</span></div>`, "a held ref mixes with a linked task ref, held first");

// #396 the facts block carries the state slug alone and no separate hold row: the hold shows in the
// blockedBy row that blockedRow builds
const factsHtmlOf = new Function("esc", "numOf", "STATIONS", "isHeld", "issuerCell", "blockedRow", page.match(/function factsHtml\(t\) \{[\s\S]*?\n\}/)![0] + "; return factsHtml;")(
	esc,
	(f: string) => parseInt(f.slice(0, 6), 10),
	STATIONS,
	isHeld,
	() => "user",
	blockedRowOf,
) as (t: any) => string;
const facts = factsHtmlOf({ file: "000263_task.md", state: "doing", complexity: "low", issuer: "user", blockedBy: "user", worktree: "feat/x" });
assert.ok(!facts.includes("<span class='k'>hold</span>") && !facts.includes("sub-state"), "the facts block prints no hold row and no station span beside the state");
assert.ok(facts.includes("<span class='k'>state</span>doing</div>"), "the state row prints the state slug and nothing else");
assert.ok(facts.includes(`<span class='k'>blockedBy</span><span class="held">held</span>`), "a pure hold still renders the blockedBy row, held first");

// #376 the waits-on popover row: a `user` token resolves to no task, so the held badge must come
// before the missing-target guard, and a mixed `user, #N` card keeps the held badge and the
// normal blocker row
const waitRowsOf = new Function("esc", "numLinkHtml", "taskByNum", "cardEls", page.match(/function waitRows\(t\) \{[\s\S]*?\n\}/)![0] + "; return waitRows;") as
	(esc: any, numLinkHtml: any, taskByNum: any, cardEls: any) => (t: any) => string;
const waitRows = waitRowsOf(
	esc,
	numLinkHtml,
	(ref: string) => (ref === "#42" ? { file: "000042_x.md", name: "x", state: "to-review" } : undefined),
	new Set(["000042_x.md"]),
);
const userRow = waitRows({ blockedBy: "user" });
assert.ok(userRow.includes('<span class="wait-name">user</span>'), "the `user` token row names the stored ref text once");
assert.ok(!userRow.includes("wait-badge") && !userRow.includes("wait-state") && !userRow.includes('<span class="wait-st">'), "and carries no badge, no state cell and no station cell");
const taskRow = waitRows({ blockedBy: "#42" });
assert.ok(taskRow.includes('<span class="wait-state">to-review</span>') && !taskRow.includes('<span class="wait-st">'), "a task row carries the state cell and no station cell");
const mixedRow = waitRows({ blockedBy: "user, #42" });
assert.ok(mixedRow.includes('<span class="wait-name">user</span>') && mixedRow.includes('data-wait-open="000042_x.md"'), "a mixed card prints the user row and the openable blocker row");

// tabs: one per registered project; a single project keeps the old ui, no tab bar
assert.ok(tabNames([]).length === 0 && tabNames([{ name: "solo", root: "/r1", branch: "main" }]).length === 0, "an empty or single-project registry renders no tab bar");
assert.deepEqual(
	tabNames([{ name: "alpha", root: "/r1", branch: "main" }, { name: "beta", root: "/r2", branch: "dev" }]),
	[{ id: "/r1", label: "alpha" }, { id: "/r2", label: "beta" }],
	"unique names keep the plain label",
);
const flagged = { reviews: false, liveTesting: true, integrationTesting: false };
assert.deepEqual(
	tabNames([{ name: "alpha", root: "/r1", branch: "main", stages: flagged }, { name: "beta", root: "/r2", branch: "dev" }]),
	[{ id: "/r1", label: "alpha", stages: flagged }, { id: "/r2", label: "beta" }],
	"a tab carries its daemon's stage flags and an old entry stays unflagged",
);
// 000103: two checkouts of one repo - the label appends the branch, the identity is the root
assert.deepEqual(
	tabNames([{ name: "repo", root: "/r1", branch: "main" }, { name: "repo", root: "/r2", branch: "feat/x" }, { name: "repo", root: "/r3", branch: "" }]),
	[{ id: "/r1", label: "repo (main)" }, { id: "/r2", label: "repo (feat/x)" }, { id: "/r3", label: "repo" }],
	"a duplicated name appends the branch to every duplicate, and a detached HEAD (empty branch) keeps the plain label",
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
assert.ok([tabNames, tabsHtml].every((fn) => page.includes(String(fn))), "the page ships the tested tab helpers");
assert.ok(page.includes('<nav id="tabs"></nav>') && page.includes("switchTab(b.dataset.project)"), "the page serves the tab bar and its switch handler");
assert.match(page, /function switchTab\(name\) \{[\s\S]*?closePanel\(\);[\s\S]*?\}/, "a tab switch closes the open panel");

// #368 the filter bar's empty state: a station whose tasks are all filtered out names the active
// filters instead of its own job line, and the job line returns when nothing filters
syncBoard(stations, [], new Set(), els, make, 5, { createElement: (tag: string) => new El(tag) }, "no task matches: work");
assert.ok(STATIONS.every((s) => stations[s.id].empty.textContent === "no task matches: work"), "an empty station names the active filters while a filter is on");
sync([]);
assert.ok(STATIONS.every((s) => stations[s.id].empty.textContent === s.empty), "the station's own job line returns when nothing filters");

// #379 the panel's run tree: one group per run in the payload order, the run's doctor under it
// when the handles match after the .doctor suffix, and every doctor whose run is gone in one
// unmatched list, so a pruned run never hides its pass
const runs379 = [
	{ role: "developer", handle: "t.developer.0", run: 0 },
	{ role: "reviewer", handle: "t.reviewer.1", run: 1 },
];
const tree379 = groupRuns(runs379, [{ role: "doctor", handle: "t.developer.0.doctor" }, { role: "doctor", handle: "t.reviewer.1.doctor" }]);
assert.deepEqual(
	tree379.groups.map((g) => [g.run.handle, g.doctor && g.doctor.handle]),
	[["t.developer.0", "t.developer.0.doctor"], ["t.reviewer.1", "t.reviewer.1.doctor"]],
	"one group per run in the payload order, each holding the doctor that extends it",
);
assert.deepEqual(tree379.unmatched, [], "every doctor with a matching run stays in its group");
const orphan379 = groupRuns(runs379, [{ role: "doctor", handle: "t.developer.9.doctor" }]);
assert.deepEqual(orphan379.unmatched.map((d) => d.handle), ["t.developer.9.doctor"], "a doctor whose run is pruned from the agents list lands in the unmatched list");
assert.equal(orphan379.groups[0].doctor, null, "an unmatched doctor never joins a run group");
const docOnly379 = groupRuns([], [{ role: "doctor", handle: "t.developer.0.doctor" }]);
assert.deepEqual([docOnly379.groups, docOnly379.unmatched.map((d) => d.handle)], [[], ["t.developer.0.doctor"]], "a task with no agents and one doctor produces one unmatched entry");
const mid379 = groupRuns([{ role: "developer", handle: "t.dev.0" }], [{ role: "doctor", handle: "t.doctor.dev.0.doctor" }]);
assert.deepEqual(mid379.unmatched.map((d) => d.handle), ["t.doctor.dev.0.doctor"], "only the trailing .doctor suffix is stripped, so a handle with doctor mid-string never joins a run");
assert.equal(mid379.groups[0].doctor, null, "a mid-string doctor leaves its run group empty");

// #413 the card's bottom line is a progress curve on a 10-minute half-life, so a long run still
// shows room ahead and the line never fills
assert.equal(PROGRESS_HALF_S, 600, "the half-life is ten minutes of run time");
assert.equal(progressOf(0), 0, "the line starts empty");
assert.equal(progressOf(300), 1 - Math.pow(2, -0.5), "five minutes paints about 29 percent of the line, slower than the old curve");
assert.equal(progressOf(600), 0.5, "ten minutes paints half the line");
assert.equal(progressOf(1200), 0.75, "twenty minutes paints three quarters");
assert.equal(progressOf(1800), 0.875, "every extra half-life halves the empty line, as the formula says: thirty minutes paints seven eighths");
const elapsed413 = [0, 60, 300, 600, 1200, 2400, 3600];
assert.ok(elapsed413.every((s) => progressOf(s) < 1), "the line never fills, however long the run");
assert.deepEqual(elapsed413.map(progressOf), [...elapsed413.map(progressOf)].sort((a, b) => a - b), "a shorter elapsed time never paints more than a longer one");

ui.close();
