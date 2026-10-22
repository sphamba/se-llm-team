// the board group split out of tests/webui.test.ts (000260, parent #256): FLIP diff, stacked
// pairs, buildShell/syncBoard, accents, cards, relation geometry and motion CSS. The hub serves
// the page once into `page`; every assert below reads that served text or the local helpers.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHub } from "../../src/hub.ts";
import { PRIORITY_RANK } from "../../src/kanban.ts";
import { boardOf, buildShell, cardBaseHtml, cardHtml, curve, flipDiff, LAYOUT, mergeBoards, numLinkHtml, pairLayout, relationPaths, spinnerHtml, syncBoard, syncCardStats, tabNames, tabsHtml, taskStats } from "../../src/webui.ts";
// 000264: not re-exported by the webui barrel (pre-#263 merge): import directly from the board module
import { applyCardStats, makeStatsQueue, mergeCardStats, sortedCol, statsKey } from "../../src/webui/board.ts";
import { esc } from "../../src/webui/logpane.ts";
import { PAGE } from "../../src/webui/page.ts";

const STATE_NAMES = ["backlog", "to-do", "doing", "to-review", "reviewing", "to-merge", "merging", "to-live-test", "live-testing", "to-integration-test", "integration-testing", "done"];


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
const boardEl = new El("main");
const cols: Record<string, any> = buildShell(boardEl, { createElement: (tag: string) => new El(tag) });
assert.deepEqual(boardEl.children.map((c) => c.className), ["col c-backlog", "pair", "pair", "pair", "pair"], "backlog stays a single side column, the other eleven states sit in three pairs and one tail group");
assert.deepEqual(
	boardEl.children.slice(1, 5).map((p) => p.children.map((c) => c.className)),
	[["col c-to-do", "col c-doing"], ["col c-to-review", "col c-reviewing"], ["col c-to-merge", "col c-merging"], ["col c-to-live-test", "col c-live-testing", "col c-to-integration-test", "col c-integration-testing", "col c-done"]],
	"to-do over doing, to-review over reviewing, to-merge over merging, then the five tail states stacked",
);
assert.deepEqual(LAYOUT, ["backlog", ["to-do", "doing"], ["to-review", "reviewing"], ["to-merge", "merging"], ["to-live-test", "live-testing", "to-integration-test", "integration-testing", "done"]], "backlog stays single, the middle states pair two by two, the last five stack as one group");
// the last visual column holds exactly the five tail states, in pipeline order (the integration
// stage lands after the live test and before done, so the layout tail constant is 5, not 3)
assert.deepEqual(LAYOUT[LAYOUT.length - 1], ["to-live-test", "live-testing", "to-integration-test", "integration-testing", "done"], "the last visual column holds exactly the five tail states, in order");
assert.deepEqual((LAYOUT[LAYOUT.length - 1] as string[]).slice(-3), ["to-integration-test", "integration-testing", "done"], "the integration states sit between the live test and done");
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
assert.ok(spinnerHtml("integration-testing").includes('<span class="spin">'), "the integration-tester's working state renders the spinner");
assert.equal(spinnerHtml("to-integration-test"), "", "a task waiting in to-integration-test renders no spinner");
assert.equal(spinnerHtml("to-do") + spinnerHtml("to-review") + spinnerHtml("to-merge") + spinnerHtml("to-live-test") + spinnerHtml("done"), "", "waiting and finished states render no spinner");
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
// issuer auto: the orchestrator's own task gets a plain auto chip, no dimmed name, no #num badge
// and no issuer link (see the detail card's issuerCell)
const autoCard = cardHtml({ file: "000001_a.md", name: "a", priority: "high", issuer: "auto" }, "doing");
assert.ok(autoCard.includes('<span class="chip">auto</span>'), "an auto-issued card shows a plain auto chip");
assert.ok(autoCard.includes("auto") && !autoCard.includes("chip issuer") && !autoCard.includes('class="name issued"'), "an auto-issued card has no issuer badge and keeps full contrast");
assert.equal(autoCard.replace('<span class="chip">auto</span>', '<span class="chip">user</span>'), userCard, "an auto-issued card differs from a user-issued one only in its chip text");
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
assert.ok(page.includes(".card-stats { display: block; font-size: 0.75rem; color: var(--muted); margin-top: 6px; animation: statsIn var(--fade) ease-out; }"), "the card stats line sits 6px below the chips row (000200)");
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
assert.ok(page.includes("@keyframes dashflow { to { stroke-dashoffset: -10; } }"), "the shared keyframes keep their -10 offset; the board rule below reverses the playback direction");
const boardRelCss = page.match(/#relations path \{([^}]*)\}/)?.[1] ?? "";
const agentRelCss = page.match(/#agent-relations path \{([^}]*)\}/)?.[1] ?? "";
assert.ok(boardRelCss.includes("animation-direction: reverse"), "the board's dash flow runs in reverse, away from the blocker towards the blocked card");
assert.ok(!agentRelCss.includes("animation-direction: reverse"), "the detail dialog's agent-card connectors keep their original dash direction");
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
// --- 000264 lazy card stats: the sortedCol, statsKey, applyCardStats and mergeCardStats functions
// over stubbed storage (no DOM, no hub; the endpoint is stubbed until #263 merges)

const csStorage = () => {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
		setItem: (k: string, v: string) => {
			map.set(k, String(v));
		},
		removeItem: (k: string) => {
			map.delete(k);
		},
	};
};
const csAgents = [{ role: "developer", tokens: 42, duration: 3 }];

// per-project and per-task key: two checkouts with the same task number never share an entry
assert.equal(statsKey("/repo-a", "000001_probe.md"), "card-stats|/repo-a|000001_probe.md");
assert.notEqual(statsKey("/repo-a", "000001_probe.md"), statsKey("/repo-b", "000001_probe.md"));

// the column's rows in board order: backlog priority-first, every other column newest-first
const csBacklog = [
	{ file: "000001_a.md", state: "backlog", priority: "medium", updated: 3 },
	{ file: "000002_b.md", state: "backlog", priority: "critical", updated: 1 },
	{ file: "000003_c.md", state: "backlog", priority: "high", updated: 5 },
];
assert.deepEqual(sortedCol(csBacklog, "backlog").map((t) => t.file), ["000002_b.md", "000003_c.md", "000001_a.md"]);
const csDoneCol = [
	{ file: "000001_a.md", state: "done", priority: "low", updated: 2 },
	{ file: "000002_b.md", state: "done", priority: "critical", updated: 9 },
];
assert.deepEqual(sortedCol(csDoneCol, "done").map((t) => t.file), ["000002_b.md", "000001_a.md"]);

// an agent-less row takes the known stats, the payload's eager agents win over them
const csKnown = Object.create(null);
csKnown[statsKey("p", "000001_a.md")] = csAgents;
const csRows = [{ file: "000001_a.md", state: "to-do", updated: 1 }];
applyCardStats(csRows, csKnown, csStorage(), "p");
assert.deepEqual(csRows[0].agents, csAgents);
const csPayload = [{ role: "developer", tokens: 7, duration: 1 }];
const csCovered = [{ file: "000001_a.md", state: "to-do", updated: 1, agents: csPayload }];
applyCardStats(csCovered, csKnown, csStorage(), "p");
assert.equal(csCovered[0].agents, csPayload);

// a done task's cached stats serve without a fetch, and the read lands in the known stats too
const csStore = csStorage();
csStore.setItem(statsKey("p", "000002_b.md"), JSON.stringify(csAgents));
const csDoneRows = [{ file: "000002_b.md", state: "done", updated: 1 }];
applyCardStats(csDoneRows, csKnown, csStore, "p");
assert.deepEqual(csDoneRows[0].agents, csAgents);
assert.equal(csKnown[statsKey("p", "000002_b.md")], csDoneRows[0].agents);

// a done task's empty cached stats still count as served, the fetch never resumes for them
csStore.setItem(statsKey("p", "000006_f.md"), "[]");
const csEmptyRows = [{ file: "000006_f.md", state: "done", updated: 1 }];
applyCardStats(csEmptyRows, csKnown, csStore, "p");
assert.deepEqual(csEmptyRows[0].agents, []);

// a stored entry for a task that left done drops with its merged agents, a fresh fetch resumes
csStore.setItem(statsKey("p", "000003_c.md"), JSON.stringify(csAgents));
csKnown[statsKey("p", "000003_c.md")] = csAgents;
const csLeftRows = [{ file: "000003_c.md", state: "to-do", updated: 1 }];
applyCardStats(csLeftRows, csKnown, csStore, "p");
assert.equal(csStore.getItem(statsKey("p", "000003_c.md")), null);
assert.equal(csKnown[statsKey("p", "000003_c.md")], undefined);
assert.equal(csLeftRows[0].agents, undefined);

// a corrupt entry and an unavailable storage fail soft, the row stays agent-less
csStore.setItem(statsKey("p", "000004_d.md"), "{oops");
const csBadRows = [{ file: "000004_d.md", state: "done", updated: 1 }];
applyCardStats(csBadRows, csKnown, csStore, "p");
assert.equal(csBadRows[0].agents, undefined);
const csDenied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
const csDeniedRows = [{ file: "000005_e.md", state: "done", updated: 1 }];
applyCardStats(csDeniedRows, csKnown, csDenied, "p");
assert.equal(csDeniedRows[0].agents, undefined);

// the card-stats response merges into the known stats; a done task's agents also cache to
// storage, a non-done task's never touch it
const csMergeStore = csStorage();
const csMergeKnown = Object.create(null);
const csMergeRows = [
	{ file: "000001_a.md", state: "done", updated: 1 },
	{ file: "000002_b.md", state: "to-do", updated: 2 },
];
mergeCardStats(
	{ "000001_a.md": { agents: [{ role: "developer", tokens: 5, duration: 1 }] }, "000002_b.md": { agents: [{ role: "developer", tokens: 6, duration: 2 }] } },
	csMergeRows,
	csMergeKnown,
	csMergeStore,
	"p",
);
assert.deepEqual(csMergeKnown[statsKey("p", "000001_a.md")], [{ role: "developer", tokens: 5, duration: 1 }]);
assert.deepEqual(csMergeKnown[statsKey("p", "000002_b.md")], [{ role: "developer", tokens: 6, duration: 2 }]);
assert.deepEqual(JSON.parse(csMergeStore.getItem(statsKey("p", "000001_a.md"))), [{ role: "developer", tokens: 5, duration: 1 }]);
assert.equal(csMergeStore.getItem(statsKey("p", "000002_b.md")), null);
mergeCardStats({ "000003_c.md": {} }, [], csMergeKnown, csMergeStore, "p");
assert.equal(csMergeKnown[statsKey("p", "000003_c.md")], undefined, "a response entry without agents is skipped");
mergeCardStats({ "000001_a.md": { agents: [] } }, csMergeRows, csMergeKnown, csDenied, "p");
assert.deepEqual(csMergeKnown[statsKey("p", "000001_a.md")], [], "a failing storage write still merges the known stats");
mergeCardStats({ "000009_z.md": { agents: [{ role: "developer", tokens: 1, duration: 1 }] } }, [], csMergeKnown, csMergeStore, "p");
assert.deepEqual(csMergeKnown[statsKey("p", "000009_z.md")], [{ role: "developer", tokens: 1, duration: 1 }]);
assert.equal(csMergeStore.getItem(statsKey("p", "000009_z.md")), null);

// 000271: the stats queue drains one file per request in board order, deferred off the caller's
// path; a successful file stays fetched, a failed one drops out so the next pass retries it
const csTimers = [];
const csSchedule = (fn) => { csTimers.push(fn); return csTimers.length; };
const csFlush = () => { const fn = csTimers.shift(); if (fn) fn(); };
const csSettle = () => new Promise((resolve) => setImmediate(resolve));
const csDeferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const csNewQueue = () => {
	const calls = [];
	const applied = [];
	const queue = makeStatsQueue(
		statsKey,
		(project, file) => { const d = csDeferred(); calls.push({ project, file, d }); return d.promise; },
		(project, stats) => applied.push({ project, stats }),
		csSchedule,
	);
	return { queue, calls, applied };
};

// one file per request, top to bottom, never in the caller's stack
const csSeq = csNewQueue();
const csCol7 = ["a", "b", "c", "d", "e", "f", "g"].map((n, i) => ({ file: `cs_${n}.md`, state: "doing", updated: 10 - i }));
csSeq.queue.enqueueCol("p", csCol7, "doing", 5);
assert.equal(csSeq.calls.length, 0, "the drain defers off the caller's path");
csFlush();
assert.deepEqual(csSeq.calls.map((c) => c.file), ["cs_f.md"], "one file per request, the top beyond-fold card first");
csSeq.calls[0].d.resolve({ "cs_f.md": { agents: csAgents } });
await csSettle();
assert.equal(csSeq.calls.length, 1, "no second request until the first settles");
csFlush();
assert.deepEqual(csSeq.calls.map((c) => c.file), ["cs_f.md", "cs_g.md"], "the next card drains after the first, top to bottom");
assert.deepEqual(csSeq.applied, [{ project: "p", stats: { "cs_f.md": { agents: csAgents } } }], "each response merges as it lands");
csSeq.calls[1].d.resolve({ "cs_g.md": { agents: csAgents } });
await csSettle();

// an enqueue during an in-flight fetch never starts a second concurrent request
const csOne = csNewQueue();
csOne.queue.enqueueCol("p", [{ file: "cs4_a.md", state: "doing", updated: 1 }], "doing", 0);
csFlush();
assert.deepEqual(csOne.calls.map((c) => c.file), ["cs4_a.md"], "the first card fetches");
csOne.queue.enqueueCol("p", [{ file: "cs4_z.md", state: "doing", updated: 0 }], "doing", 0);
csFlush();
assert.equal(csOne.calls.length, 1, "no second request while the first is in flight");
csOne.calls[0].d.resolve({ "cs4_a.md": { agents: csAgents } });
await csSettle();
csFlush();
assert.deepEqual(csOne.calls.map((c) => c.file), ["cs4_a.md", "cs4_z.md"], "the mid-flight enqueue drains after the first settles");
csOne.calls[1].d.resolve({ "cs4_z.md": { agents: csAgents } });
await csSettle();

// a task arriving at position 6 in an expanded column re-queues on the next pass; a fetched file never does
const csArr = csNewQueue();
const csFive = ["a", "b", "c", "d", "e"].map((n, i) => ({ file: `cs2_${n}.md`, state: "doing", updated: 10 - i }));
csArr.queue.enqueueCol("p", csFive, "doing", 5);
assert.equal(csArr.calls.length, 0, "the eager first five never fetch");
const csSix = [...csFive, { file: "cs2_f.md", state: "doing", updated: 0 }];
csArr.queue.enqueueCol("p", csSix, "doing", 5);
assert.equal(csArr.calls.length, 0, "the arrival queues deferred");
csFlush();
assert.deepEqual(csArr.calls.map((c) => c.file), ["cs2_f.md"], "a task arriving at position 6 fetches on the next pass");
csArr.calls[0].d.resolve({ "cs2_f.md": { agents: [] } });
await csSettle();
csArr.queue.enqueueCol("p", csSix, "doing", 5);
csFlush();
assert.equal(csArr.calls.length, 1, "a fetched file does not re-queue");

// a failed fetch drops out of the fetched-or-in-flight set, the next pass retries it
const csRetry = csNewQueue();
const csFailCol = ["a", "b", "c", "d", "e", "f"].map((n, i) => ({ file: `cs3_${n}.md`, state: "doing", updated: 10 - i }));
csRetry.queue.enqueueCol("p", csFailCol, "doing", 5);
csFlush();
assert.deepEqual(csRetry.calls.map((c) => c.file), ["cs3_f.md"], "the beyond-fold card fetches");
csRetry.calls[0].d.resolve(null);
await csSettle();
csRetry.queue.enqueueCol("p", csFailCol, "doing", 5);
assert.equal(csRetry.calls.length, 1, "the retry defers off the caller's path");
csFlush();
assert.deepEqual(csRetry.calls.map((c) => c.file), ["cs3_f.md", "cs3_f.md"], "a failed fetch retries on the next pass");
csRetry.calls[1].d.resolve({});
await csSettle();

// the poll's agent-less rows never wipe revealed stats: the merge fills, the poll's fresh rows re-apply
const csPollKnown = Object.create(null);
const csPollStore = csStorage();
const csPollRows = [{ file: "000001_a.md", state: "to-do", updated: 1 }];
mergeCardStats({ "000001_a.md": { agents: [{ role: "developer", tokens: 9, duration: 9 }] } }, csPollRows, csPollKnown, csPollStore, "p");
applyCardStats(csPollRows, csPollKnown, csPollStore, "p");
assert.equal(csPollRows[0].agents.length, 1);
const csPolled = [{ file: "000001_a.md", state: "to-do", updated: 2 }];
applyCardStats(csPolled, csPollKnown, csPollStore, "p");
assert.equal(csPolled[0].agents.length, 1, "the poll's agent-less rows take the known stats back");

// the served page wires the apply pass ahead of the board pass, the per-file queue, its poll
// re-enqueue and the stats entrance (reduced motion included)
assert.ok(PAGE.includes("function sortedCol("), "sortedCol interpolates into the page");
assert.ok(PAGE.includes("function statsKey("), "statsKey interpolates into the page");
assert.ok(PAGE.includes("function applyCardStats("), "applyCardStats interpolates into the page");
assert.ok(PAGE.includes("function mergeCardStats("), "mergeCardStats interpolates into the page");
assert.ok(PAGE.includes("function makeStatsQueue("), "makeStatsQueue interpolates into the page");
assert.ok(PAGE.indexOf("applyCardStats(tab.tasks") < PAGE.indexOf("syncBoard(cols, tab.tasks"), "the apply pass runs before the board pass");
assert.ok(PAGE.includes('"/api/card-stats?files=" + encodeURIComponent(file)'), "each queued file fetches the pinned endpoint");
assert.ok(PAGE.includes("statsQueue.enqueueCol(active, b.tasks, st, VISIBLE)"), "the unfold enqueues the column's beyond-fold cards");
assert.ok(PAGE.includes("queueExpanded()"), "each poll re-queues the already-expanded columns");
assert.ok(PAGE.includes("statsIn var(--fade) ease-out"), "the stats entrance animates");
assert.ok(PAGE.includes(".card-stats, #modal:not(.hidden)"), "reduced motion turns the stats entrance off");

// 000320: a task whose blockedBy carries the `user` token (`user` alone, any case, or mixed with
// task refs) is held: syncBoard toggles the user-hold class on its card on every pass, so a poll
// adds and removes it live, while the one-shot entrance class stays untouched
const heldTask = (file: string, blockedBy: string) => ({ file, name: "feat: h", priority: "low", state: "backlog", updated: 1, blockedBy });
sync([heldTask("000031_h.md", "user"), heldTask("000032_i.md", "USER, #42"), heldTask("000033_j.md", "#42")]);
const heldOf = (file: string) => els.get(file)!.className.split(" ");
assert.ok(heldOf("000031_h.md").includes("user-hold"), "a `user` blockedBy marks the card held");
assert.ok(heldOf("000032_i.md").includes("user-hold"), "the token ignores case and mixes with task refs");
assert.ok(!heldOf("000033_j.md").includes("user-hold"), "a task ref alone leaves the card unheld");
assert.ok(heldOf("000031_h.md").includes("enter"), "the held card keeps its entrance class");
sync([heldTask("000031_h.md", ""), heldTask("000032_i.md", "USER, #42"), heldTask("000033_j.md", "#42")]);
assert.ok(!heldOf("000031_h.md").includes("user-hold"), "the next pass drops the class once the token is gone");
assert.ok(heldOf("000032_i.md").includes("user-hold"), "a still-held card stays held");
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
