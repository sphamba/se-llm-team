// the board group split out of tests/webui.test.ts (000260, parent #256): the FLIP diff, the
// stacked layout, buildShell/syncBoard, the card hooks, the relation geometry and the hover
// highlight. The hub serves the page once into `page`; every assert below reads that served text
// or the local helpers. Every CSS literal pin moved to a structural or behavioural equivalent
// (#364), so a redesign of the stylesheet does not edit this file.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHub } from "../../src/hub.ts";
import { PRIORITY_RANK, STATES } from "../../src/kanban.ts";
import { applyStages, buildShell, cardBaseHtml, cardHtml, curve, DEFAULT_STAGES, flipDiff, LAYOUT, numLinkHtml, pairLayout, relationPaths, spinnerHtml, syncBoard, syncCardStats, tabNames, tabsHtml, taskStats } from "../../src/webui.ts";
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
	// 000320: the held-card pass reads classList.toggle only
	classList = {
		toggle: (cls: string, on: boolean) => {
			const set = new Set(this.className.split(" ").filter(Boolean));
			if (on) set.add(cls);
			else set.delete(cls);
			this.className = [...set].join(" ");
		},
	};
}

// layout (000047 stacked pairs, 000181 tail stack, 000354 done column): the shell is built from
// LAYOUT, so this group proves the shape once instead of pinning a class list
const boardEl = new El("main");
const cols: Record<string, any> = buildShell(boardEl, { createElement: (tag: string) => new El(tag) });
const groupStates = (child: El) => (child.className === "pair" ? child.children.map((c) => c.dataset.state) : child.dataset.state);
assert.deepEqual(boardEl.children.map(groupStates), LAYOUT, "the shell builds one column per layout string and one .pair per stacked group, in order");
assert.deepEqual([...pairLayout(STATES.slice(0, -1)), STATES[STATES.length - 1]], LAYOUT, "the pairs derive from the state list, with done closing the row as its own column");
assert.deepEqual(LAYOUT.flat(), [...STATES], "the phase mapping covers every state slug exactly once, in pipeline order");
assert.ok(STATES.every((st) => cols[st]?.col.dataset.state === st), "every column carries its state as a data hook, not only as a class");
assert.ok(page.includes(JSON.stringify(LAYOUT)), "the page ships the tested layout");
assert.ok(page.includes(String(buildShell)) && page.includes(String(syncBoard)), "the page runs the tested shell and card pass");
assert.ok(page.includes(String(cardBaseHtml)) && page.includes(String(syncCardStats)) && page.includes(String(taskStats)), "the page runs the tested base-card and in-place stats source");
// syncBoard is interpolated as source, so every identifier it references must exist in the
// client scope: the page ships the rank map as a value, or the backlog sort throws on refresh
assert.ok(page.includes(`const PRIORITY_RANK = ${JSON.stringify(PRIORITY_RANK)}`), "the client defines the rank map syncBoard references");

// stage toggles fade whole column pairs; only a flag named in applyStages fades its states
const off = (st: string) => cols[st].col.className.split(" ").includes("off");
applyStages(cols, { reviews: false, liveTesting: true, integrationTesting: false });
assert.deepEqual(
	STATES.filter(off),
	["to-review", "reviewing", "to-integration-test", "integration-testing"],
	"a disabled stage fades both its states, an enabled one leaves its columns on",
);
applyStages(cols, DEFAULT_STAGES);
assert.ok(STATES.every((st) => !off(st)), "all-on stages restore every column");
assert.ok(page.includes(String(applyStages)), "the page ships the tested stage toggle");

// accents: the stylesheet points each column class at a stage accent token, and the theme
// declares that token, so the pipeline order and the names survive a palette change
const declared = new Set([...page.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const acTokens = [...page.matchAll(/--ac: var\((--accent-[\w-]+)\)/g)].map((m) => m[1]);
assert.ok(STATES.every((st) => page.includes(".c-" + st)), "every state keeps its column class");
assert.ok(acTokens.length === 7 && new Set(acTokens).size === acTokens.length, "each of the seven pipeline stages points --ac at its own accent token");
assert.ok(acTokens.every((t) => declared.has(t)), "each column accent names a token the theme declares");

// the state picks the animation: only the states the orchestrator works on carry the spinner
const WORKING = ["doing", "reviewing", "live-testing", "merging", "integration-testing"];
assert.ok(WORKING.every((st) => spinnerHtml(st).includes('<span class="spin">')), "every working state renders the spinner");
assert.ok(STATES.filter((st) => !WORKING.includes(st)).every((st) => spinnerHtml(st) === ""), "no waiting or finished state renders one");

// the card markup carries stable hooks, so a reader finds a card by data-num/data-state rather
// than by class order, and the issuer and complexity chips keep their meaning
const userCard = cardHtml({ file: "000047_fix_x.md", name: "a & b", priority: "high" }, "doing");
assert.ok(userCard.includes('<span class="num-link num" data-task="000047_fix_x.md">#47</span>a &amp; b'), "a card carries its short number as a link and its escaped name");
assert.equal(numLinkHtml('000048_quo"te.md'), '<span class="num-link" data-task="000048_quo&quot;te.md">#48</span>', "the data-task file hook is escaped");
assert.ok(userCard.includes('<span class="chip cx cx-moderate">moderate</span>') && cardHtml({ file: "000004_d.md", name: "d", priority: "high", complexity: "<x>" }, "doing").includes('<span class="chip cx cx-&lt;x&gt;">&lt;x&gt;</span>'), "an absent complexity renders as moderate and a set one is escaped");
assert.ok(userCard.includes('<span class="chip">user</span>') && !userCard.includes("issued") && cardHtml({ file: "000001_a.md", name: "a", priority: "high", issuer: "auto" }, "doing").includes('<span class="chip">auto</span>'), "a user-issued card keeps full contrast and a plain chip, an auto-issued one shows a plain auto chip");
const issuedCard = cardHtml({ file: "000002_b.md", name: "b", priority: "low", issuer: "#42" }, "to-do");
assert.ok(issuedCard.includes('<div class="name issued"') && issuedCard.includes('<span class="chip issuer">#42</span>'), "a task-issued card dims its name and carries a #num badge");
assert.ok(cardHtml({ file: "000007_g.md", name: "g", priority: "low", agents: [{ tokens: 420, duration: 1500 }, { tokens: 1580, duration: 2000 }] }, "doing").includes('<span class="card-stats">2k · 4s</span>'), "a card sums its agent entries into the stats line");
assert.ok(!cardHtml({ file: "000009_i.md", name: "i", priority: "low", agents: [{ tokens: null, duration: 1500 }] }, "doing").includes("card-stats"), "a card whose entries carry no usage renders no stats line (000183)");

// relation lines: one dashed curve per stored relation between rendered cards, running from the
// blocked task's card to the blocker's card. A done blocker, a ghost ref and an unrendered card
// draw nothing.
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
assert.ok(same[0].d.endsWith(`310 ${midY(rects["000004_d.md"])}`), "same column: the path enters the blocker's left edge, wrapping behind the cards");
assert.deepEqual(
	relationPaths([
		{ file: "000002_b.md", state: "to-do", blockedBy: "#4" },
		{ file: "000004_d.md", state: "doing", blockedBy: "" },
	], rectOf)[0],
	same[0],
	"a stacked pair at one x draws the same wrap, whatever the states",
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
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "#1" }], (f) => (f === "000001_a.md" ? rects["000001_a.md"] : null)).length, 0, "a ref whose card is not rendered draws nothing");
assert.deepEqual(relationPaths([{ file: "000002_b.md", state: "to-do" }], rectOf), [], "an older payload without blockedBy draws nothing");

// hovering highlights both ways (000144): the served client script's hotRelations for the blocked
// file and for the blocker file both raise the same path, an unrelated file raises nothing
const hotPath: any = { dataset: { file: "000002_b.md", blocker: "000004_d.md" }, hot: new Set<string>() };
hotPath.classList = { toggle: (cls: string, on: boolean) => (on ? hotPath.hot.add(cls) : hotPath.hot.delete(cls)) };
const hotFn = (new Function("document", page.match(/<script>([\s\S]*?)<\/script>/)![1].match(/function hotRelations\(file, on\) \{[\s\S]*?\n\}/)![0] + "; return hotRelations;") as (d: unknown) => (file: string, on: boolean) => void)({ querySelectorAll: (sel: string) => (sel === "#relations path" ? [hotPath] : []) });
hotFn("000002_b.md", true);
assert.ok(hotPath.hot.has("relations-hot"), "hovering the blocked card highlights its outgoing line");
hotFn("000002_b.md", false);
hotFn("000009_x.md", true);
assert.ok(!hotPath.hot.has("relations-hot"), "mouseleave reverts the highlight and an unrelated file raises nothing");
hotFn("000004_d.md", true);
assert.ok(hotPath.hot.has("relations-hot"), "hovering the blocker card highlights the same incoming line");

// 000127/000236: far-apart cards bend the line into an S (the control offsets scale with the
// span, capped); same-row pairs clamp the offset inside the span, because a same-row cubic is
// collinear and any control past an endpoint retraces the line
const parseCurve = (d: string) => d.match(/^M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/)!.slice(1).map(Number);
const [sx1, , sc1x, , sc2x, , sx2] = parseCurve(same[0].d);
assert.ok(sc1x === sx1 + 280 * 0.35 && sc2x === sx2 - 280 * 0.35, "a same-column wrap scales both control offsets with the span");
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
assert.ok(page.includes('setAttribute("pointer-events", "none")') && page.includes('window.addEventListener("resize", drawRelations)'), "the overlay is created non-interactive and a resize recomputes the line endpoints");
assert.ok(page.includes("el.onmouseenter = () => hotRelations(file, true)") && page.includes("el.onmouseleave = () => hotRelations(file, false)"), "the card hover wires the highlight on mouseenter and reverts on mouseleave");
assert.ok(page.includes('if (p.dataset.file === file || p.dataset.blocker === file) p.classList.toggle("relations-hot", on)'), "the hover matches paths by either endpoint's file in the dataset, no quote-unsafe selector interpolation");
assert.ok(page.includes('" data-blocker="'), "each relation path carries the blocker's file alongside the blocked task's file");
assert.ok(page.includes('querySelectorAll("#m-attrs .num-link")'), "the detail card binds its id links to openTask after render");
assert.ok(page.includes('"<div><span>blockedBy</span>"'), "the detail card builds a blockedBy row");

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
assert.deepEqual([cardA.dataset.file, cardA.dataset.num, cardA.dataset.state], ["000001_a.md", "1", "doing"], "the card element carries file, number and state hooks after the pass");
sync(tasksA);
assert.equal(els.get("000001_a.md"), cardA, "an unchanged card keeps its DOM node across a refresh");
assert.equal(cardA.writes, 1, "and its markup is not rewritten, so its spinner animation keeps running");
sync(tasksA.map((t) => (t.file === "000001_a.md" ? { ...t, state: "to-do", updated: 3 } : t)));
assert.ok(els.get("000001_a.md") === cardA && cardA.dataset.state === "to-do", "a card that changes column keeps its node, so FLIP can move it, and its state hook follows");
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
assert.ok(els.get("000003_c.md")!.className.includes("enter"), "a later insertion gains the entrance class too");
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
sync([{ ...liveTask, agents: [{ tokens: 900, duration: 2500 }] }]);
assert.equal(cardD.writes, 1, "a stats-only change does not rewrite the card markup, the spinner animation survives");
assert.equal(cardD.children[0].textContent, "900 · 3s", "the stats span updates in place");
sync([{ ...liveTask, agents: [] }]);
assert.ok(cardD.writes === 1 && cardD.children.length === 0, "removing the stats span is in-place too, and the span drops when the stats vanish");

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
assert.ok(cols["live-testing"].empty.style.display === "" && shown("live-testing").length === 0, "an empty column shows its mark and holds no cards");

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
assert.match(page, /function switchTab\(name\) \{[\s\S]*?closeModal\(\);[\s\S]*?\}/, "a tab switch closes the open modal");

// 000320: a task whose blockedBy carries the `user` token (`user` alone, any case, or mixed with
// task refs) is held: syncBoard toggles the user-hold class on its card on every pass, so a poll
// adds and removes it live, while the one-shot entrance class stays untouched
const heldTask = (file: string, blockedBy: string) => ({ file, name: "feat: h", priority: "low", state: "backlog", updated: 1, blockedBy });
sync([heldTask("000031_h.md", "user"), heldTask("000032_i.md", "USER, #42"), heldTask("000033_j.md", "#42")]);
const heldOf = (file: string) => els.get(file)!.className.split(" ");
assert.ok(heldOf("000031_h.md").includes("user-hold") && heldOf("000032_i.md").includes("user-hold"), "a `user` blockedBy marks the card held, any case, mixed with task refs");
sync([heldTask("000031_h.md", ""), heldTask("000032_i.md", "USER, #42"), heldTask("000033_j.md", "#42")]);
assert.ok(!heldOf("000031_h.md").includes("user-hold") && heldOf("000032_i.md").includes("user-hold") && !heldOf("000033_j.md").includes("user-hold"), "the next pass drops the class once the token is gone, a still-held card stays held, a task ref alone never holds");
assert.equal(els.get("000031_h.md")!.className, "card enter", "the toggle neither replays nor loses the one-shot entrance class");

// a held ref draws no relation line and prints as plain escaped text in the detail card
assert.equal(relationPaths([{ file: "000002_b.md", state: "to-do", blockedBy: "user" }], rectOf).length, 0, "a `user` ref draws no relation line");
const blockedRowOf = new Function("esc", "numLinkHtml", "taskByNum", page.match(/function blockedRow\(t\) \{[\s\S]*?\n\}/)![0] + "; return blockedRow;")(
	esc,
	numLinkHtml,
	(ref: string) => (ref === "#42" ? { file: "000042_x.md" } : undefined),
) as (t: any) => string;
assert.equal(blockedRowOf({ blockedBy: "user" }), "<div><span>blockedBy</span>user</div>", "the `user` ref prints as plain escaped text");
assert.equal(blockedRowOf({ blockedBy: "user, #42" }), '<div><span>blockedBy</span>user, <span class="num-link" data-task="000042_x.md">#42</span></div>', "a held ref mixes with a linked task ref");

ui.close();
