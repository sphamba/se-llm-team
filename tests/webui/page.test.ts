import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, setState } from "../../src/kanban.ts";
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
}

const modalZ = page.match(/#modal \{[^}]*z-index: (\d+)/)?.[1];
const relationsZ = page.match(/#relations \{[^}]*z-index: (\d+)/)?.[1];
const cardZ = page.match(/\.card \{[^}]*z-index: (\d+)/)?.[1];
assert.ok(modalZ && relationsZ && Number(modalZ) > Number(relationsZ), "the #modal backdrop and card stack above the #relations lines (000119)");
assert.ok(modalZ && cardZ && Number(modalZ) > Number(cardZ), "the #modal bumps above the z-index-2 task cards (000124)");
assert.ok(page.includes("render(true); // no FLIP across boards"), "a tab switch never flips from the other board's layout");
assert.ok(page.includes("Promise.all(projects.map(t => fetch(url(t))"), "every tab polls each cycle");
assert.ok(page.includes("setTimeout(refresh, refreshMs(openDetail))"), "the poll chains, the next tick keyed on the fresh open card's cadence");
assert.ok(page.includes(".catch(() => setTimeout(refresh, 5000))"), "a failed cycle retries at the board cadence");
// 000235: a throttled tab's delayed tick would land a full cadence after the wake; the client
// cancels it and refreshes at once when the gap exceeds twice the last scheduled cadence
assert.ok(page.includes("let pollTimer = null"), "the client tracks the pending poll timer");
assert.ok(page.includes("lastReload = Date.now()"), "a served board stamps the reload time");
assert.match(page, /if \(current && current\[1\]\) \{\s*document\.getElementById\("updated"\)\.textContent[\s\S]*?lastReload = Date\.now\(\);/, "the reload stamp lands with the updated line, only for a served board");
assert.ok(page.includes("lastDelay = refreshMs(openDetail)"), "the tick's cadence is kept as lastDelay");
assert.ok(page.includes(".catch(() => setTimeout(refresh, 5000)).then(t => { pollTimer = t; })"), "the failed-cycle retry timer is tracked too, so a wake cancels it");
assert.match(page, /addEventListener\("visibilitychange", \(\) => \{[\s\S]*?document\.visibilityState !== "visible"[\s\S]*?Date\.now\(\) - lastReload <= 2 \* lastDelay[\s\S]*?clearTimeout\(pollTimer\);[\s\S]*?refresh\(\);/, "a wake past twice the last cadence cancels the pending tick and refreshes at once");
assert.ok(page.includes('(active ? "&project=" + encodeURIComponent(active) : "")'), "agent-log polls carry the active tab's project");
// 000122: the live auto-scroll glides smoothly, reduced motion falls back to an instant auto;
// the client post-processes every insert, joining cross-chunk tool results and thinking deltas
assert.ok(page.includes('const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";'), "reduced motion falls back to an instant auto scroll");
assert.ok(page.includes("p.scrollTo({ top: p.scrollHeight, behavior: behavior });"), "the live auto-scroll glides smoothly to the bottom");
assert.ok(page.includes('details.lg-tool[data-tc]'), "the client dedupes tool blocks across poll windows by toolCallId");
assert.ok(page.includes(String(logFixups)), "the page runs the tested log fixups: dedupe, joins, orphan promotions");
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
assert.deepEqual(projects[0].stages, stages, "the hub registry carries the daemon's stage flags");
assert.ok(page.includes('projects = tabs.length ? tabs : [{ id: "", label: "", stages: list[0]?.stages ?? DEFAULT_STAGES }]'), "the page falls back to one unnamed tab with the project's stages");
assert.ok(
	page.includes('t.id ? "/api/tasks?project=" + encodeURIComponent(t.id) : "/api/tasks"'),
	"the single-project fallback polls /api/tasks bare",
);

// agent info: null for a backlog task; populated for a working task with a live pid (000248:
// the agent data lives on the follow-up history fetch, the light detail carries none)
assert.equal(histPayload.agent, null);
assert.deepEqual(histPayload.agents, [], "no role logs yet, empty agent history");
assert.ok(page.includes('id="m-agent"'), "modal has the agent area");
assert.ok(!page.includes("<div><span>name</span>"), "the detail card drops the name attribute row the title already shows");
assert.ok(page.includes('"<div><span>issuer</span>" + issuerCell(t) + "</div>"'), "the detail card shows the issuer row");
assert.ok(page.includes('return target ? numLinkHtml(target.file) : esc(t.issuer || "user")'), "a task-issued issuer links to its card, plain text for user, auto or an off-board number");
// issuer auto: the orchestrator's own task gets no issuer link in the detail card either, so the
// issuer cell never resolves "auto" to a task (only a #<num> issuer can link)
const issuerCellSrc = page.match(/function issuerCell\(t\) \{[\s\S]*?\n\}/)![0];
assert.ok(issuerCellSrc.includes('t.issuer !== "auto"'), "issuerCell never links an auto issuer to a task card");
assert.ok(!issuerCellSrc.includes("chip"), "the detail card's issuer cell renders no badge, plain text only");
assert.ok(
	page.includes("\"<div><span>complexity</span><span class='chip cx cx-\" + esc(t.complexity || \"moderate\") + \"'>\""),
	"the detail card complexity row carries the value class",
);
assert.ok(
	page.includes("\"<div><span>priority</span><span class='chip p-\" + esc(t.priority) + \"'>\" + esc(t.priority) + \"</span></div>\" +"),
	"the detail card keeps the priority row with only the priority chip",
);
assert.ok(page.includes("#m-log.hidden { display: none; }"), "log pane hides");
assert.ok(page.includes("#m-log-meta { padding: 6px 10px 0; font-size: 0.75rem; line-height: 1.45; color: var(--muted); }") && page.includes("#m-log-meta.hidden { display: none; }"), "the log meta line renders muted grey and hides while no meta is available");
assert.ok(page.includes("/api/agent-log"), "page uses the agent log endpoint");
assert.ok(page.includes('<span class="check">✓</span>'), "past agent buttons render a green checkmark");
assert.ok(page.includes('<span class="cross">✗</span>'), "a dead run's card renders a cross instead of the check");
assert.ok(page.includes('a.status === "dead" ? "agent-dead" : "agent-past"'), "a dead run's card carries its own class, ok keeps agent-past");
assert.match(page, /\.cross \{ color: var\(--error-text\); margin-right: 5px; \}/, "the cross reads in the failed-run red");
assert.ok(!page.includes(".agent-dead { color: var(--critical-fg); }"), "the old label-only dead rule is gone, the failed run turns the whole card red");
assert.ok(page.includes(".agent-card-active"), "the shown agent card gets an active class");
// 000076: the small font belongs to the log text, not the selector cards; 000120: each run is a
// bit larger card in one wrapping row of columns, the live run last, its subs stacked below it
const agentCardCss = page.match(/\.agent-card \{[^}]*\}/)![0];
assert.ok(agentCardCss.includes("font-size: 0.875rem") && agentCardCss.includes("padding: 6px 10px"), ".agent-card is a bit larger than the old button");
// 000122: the log text renders in the page's sans serif stack, blocks are collapsed details;
// 000152: the size matches the card body text, no smaller log font-size remains
const logCss = page.match(/#m-log-text \{[^}]*\}/)![0];
assert.ok(logCss.includes("font-size: 0.9375rem") && !/font-size: 0\.(75|8125|875)rem/.test(logCss), "the agent log text renders at the card body size, no smaller log font-size");
// 204: every font-size is rem against the 16px base; the exact counts pin the mapping
const sizeCounts = [...page.matchAll(/font-size: ([\d.]+)rem/g)].map((m) => m[1]);
const gotSizes: Record<string, number> = {};
for (const s of sizeCounts) gotSizes[s] = (gotSizes[s] ?? 0) + 1;
assert.deepEqual(gotSizes, { "0.625": 1, "0.75": 5, "0.8125": 1, "0.875": 11, "0.9375": 4, "1.0625": 1, "1.125": 1 }, "every served font-size matches the rem mapping (12->0.75, 13->0.8125, 14->0.875, 15->0.9375, 17->1.0625, 18->1.125)");
// 204: mobile, zooming blocked and the root font size 15% smaller under 600px
assert.ok(page.includes('<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">'), "the viewport meta blocks zooming on mobile");
assert.ok(page.includes("@media (max-width: 600px) { html { font-size: 85%; } }"), "mobile screens render the root font size 15% smaller");
const logPaneCss = page.match(/#m-log \{[^}]*\}/)![0];
assert.ok(logPaneCss.includes("max-height: 70vh"), "the log pane grows to 70vh so long logs show more content");
// 000147: the no-monospace check stays scoped to this font-family declaration now that the code/pre rule adds monospace elsewhere
const logFont = logCss.match(/font-family: [^;]+;/)![0];
assert.ok(logFont.includes("system-ui") && !logFont.includes("monospace"), "the agent log text font-family declaration stays sans serif, not monospace");
// 000141: the Google Inter font loads in the page head and goes first in both font-family stacks
assert.ok(page.includes('<link rel="preconnect" href="https://fonts.googleapis.com">') && page.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'), "the page preconnects to Google Fonts before the Inter stylesheet");
assert.ok(page.includes('https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet"'), "the page loads the Inter stylesheet from fonts.googleapis.com");
assert.equal(page.match(/font-family: Inter, system-ui[^;]*;/g)?.length, 2, "Inter goes first in exactly the two font-family declarations (body and #m-log-text)");
// 000153: inline and fenced code render in an explicit monospace stack in the log pane and task
// body; buttons inherit the page font; the Thinking prose and tool args/output pres are not code,
// so the bare #m-log-text pre stays outside the selector and inherits the Inter page font
const monoRule = '#m-log-text code, #m-log-text pre code, #m-body code, #m-body pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }';
assert.ok(page.includes(monoRule), "code and fenced code render in an explicit monospace stack in the log pane and task body");
const monoSelectors = monoRule.slice(0, monoRule.indexOf("{")).split(",").map((s) => s.trim());
assert.ok(monoSelectors.includes("#m-log-text code") && monoSelectors.includes("#m-log-text pre code"), "inline code and fenced code stay in the log-pane monospace selector");
assert.ok(!monoSelectors.includes("#m-log-text pre"), "the Thinking prose and the tool args/output pres are not inside the monospace selector, they stay Inter");
// #310 the dialog body renders quoted lines as blockquotes: a subtle left border, small left
// padding and the soft text colour, with a vertical margin only so the paragraphs around it do not shift
const quoteRule = "#m-body blockquote { border-left: 3px solid var(--border); padding-left: 10px; margin: 4px 0; color: var(--soft); }";
assert.ok(page.includes(quoteRule), "the dialog body styles a blockquote with a left border, small padding and the soft text colour");
assert.ok(page.includes("button { font-family: inherit; }"), "buttons inherit the page font instead of the UA Arial default");
// #292 the served md must run: a String(md) presence assert cannot prove the browser has every
// name the renderer reads, so extract the served definitions and run them on a table body
const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
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
const servedTable = servedMd("| a | b |\n| --- | --- |\n| 1 | 2 |");
assert.equal(
	servedTable,
	'<div class="md-table-wrap" data-open="tbl"><table><thead><tr><th class="md-pin">a</th><th>b</th></tr></thead><tbody><tr><td class="md-pin">1</td><td>2</td></tr></tbody></table></div>',
	"the served md renders a GFM table body with the wrapper, thead and pinned first cells",
);
// 000299: the served logFixups merges a cut table across chunks. The older chunk (header,
// separator, one body row, still open) prepends above the row paragraphs the newer chunk already
// left in the pane, and the pane fixes absorb them into the table as rows
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
assert.equal(fixPane.children[1], prose, "the non-row sibling keeps its node");
assert.ok(!("open" in olderWrap.dataset), "the prose closes the table, so the marker clears");
// #291 a markdown table scrolls inside its own wrapper and the leftmost column pins left
assert.ok(page.includes(".md-table-wrap { overflow-x: auto; }"), "a markdown table gets its own horizontal scroll container, never the markdown block");
assert.ok(page.includes(".md-table-wrap th, .md-table-wrap td { white-space: nowrap; text-align: left;"), "table cells stay on one line and a bare --- column is left, past the UA th centering");
assert.ok(page.includes("#m-log-text .md-table-wrap .md-pin { background: var(--code-bg); }"), "the log-pane pinned column matches the pane background, not the dialog panel");
assert.ok(page.includes(".md-table-wrap .md-pin { position: sticky; left: 0;"), "the leftmost column pins left with a static right border as the cue");
assert.ok(page.includes("#m-log-text pre { font: inherit;"), "log block bodies inherit the sans serif font");
assert.ok(page.includes("#m-log-text pre { font: inherit; margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: break-word; }"), "expanded log block bodies wrap to the container width");
assert.ok(page.includes("#m-log-text summary { cursor: pointer;"), "collapsed log summaries read as clickable");
assert.ok(page.includes("#m-log-text details.lg-think, #m-log-text details.lg-tool { color: var(--muted); }"), "thinking and tool blocks render muted grey in both themes, collapsed and expanded alike");
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
// 000191: the sub list rebuild is html-gated (the keep pass re-fetches every second), and only a
// newly spawned sub card animates; a genuinely new run card carries the entrance too
// 000251: the sub list gate keys on the sub set only, so a growing transcript's advancing tokens
// and duration never rebuild the cards; an unchanged set moves the stats lines in place
assert.ok(!page.includes("if (box.__html === html) return;"), "the sub list gate no longer keys on the full html, a growing transcript's stats never trigger a rebuild");
const fsSubs = page.match(/function fetchSubs\(gen, a, box\) \{[\s\S]*?\n\}/)![0];
assert.ok(fsSubs.includes(".map(s => s.index)"), "the sub list gate keys on the sub indexes only");
assert.ok(fsSubs.includes("syncStatsLine("), "an unchanged sub list updates the stats lines in place, the cards stay mounted");
assert.ok(page.includes('if (prev && !prev.has(b.dataset.sub)) {'), "only a newly spawned sub card animates");
assert.ok(page.includes('b.onanimationend = () => { b.classList.remove("enter"); b.onanimationend = null; };'), "the sub cards' entrance class is dropped too, the rebuild's box carry-over never replays it");
assert.ok(page.includes('if (oldSubs && !oldSubs.has(b.dataset.handle)) b.classList.add("enter")'), "only a genuinely new run card animates");
assert.ok(page.includes('el.onanimationend = () => { el.classList.remove("enter"); el.onanimationend = null; };'), "the page drops the entrance class when the animation ends");
assert.ok(page.includes("syncBoard(cols, tab.tasks, tab.expanded, cardEls, makeCard, VISIBLE, document)"), "the card pass gets the document for the in-place stats span");
// 000121: the 5 s refresh re-derives the open detail card in place: title and attrs freely, the
// body html-gated, the run cards re-rendered without touching the log pane or its state
const upd = page.match(/function updateOpenTask\(t\) \{[\s\S]*?\n\}/)![0];
assert.ok(page.includes("if (!open) closeModal();"), "the refresh closes the open card when its task is gone");
assert.ok(page.includes("function pollDetail()"), "000242: the poll re-fetches the open task's detail, the light rows carry no agent data");
assert.ok(upd.includes("writeHead(t)") && upd.includes("renderAgent(t, true)") && upd.includes("setBody(t)"), "the refresh re-derives title, attrs, agent row and body from the fresh payload");
assert.ok(!upd.includes("closeLog") && !upd.includes("logState"), "the refresh path never touches the log pane, logState or the log timer");
assert.ok(page.includes('<div id="m-agent"><svg id="agent-relations"></svg><div id="m-agent-btns"></div><div id="m-doctor"></div><div id="m-log-meta" class="hidden"></div><div id="m-log" class="hidden"><div id="m-log-text"></div></div></div>'), "000154: the meta line ships as a sibling above the log pane, hidden until a payload carries meta; 000222 adds the doctor row between the run columns and the meta line; 000237 ships the relation SVG as the agent area's first child");
// 000222/000230 the Doctor card: one card per analysed run's doctor step, slotted into the
// analysed run's column below the run card (matched by handle, the run's plus the .doctor
// suffix); the residual #m-doctor row sits between the run columns and the log meta and keeps
// only the cards whose run column is gone, clicking a card opens the doctor log
assert.ok(page.indexOf('id="m-doctor"') > page.indexOf('id="m-agent-btns"') && page.indexOf('id="m-doctor"') < page.indexOf('id="m-log-meta"'), "#m-doctor sits between #m-agent-btns and #m-log-meta inside the agent area");
assert.ok(page.includes("function renderDoctor(t, keep)"), "the script defines renderDoctor for the doctor cards");
const rd = page.match(/function renderDoctor\(t, keep\) \{[\s\S]*?\n\}/)![0];
assert.ok(rd.includes("(t.doctors || []).slice()"), "renderDoctor builds one card per doctors entry of the fresh payload");
assert.ok(rd.includes("openAgentLog(b.dataset.handle)"), "a doctor card's click opens its doctor log by handle");
assert.ok(rd.includes("syncDoctorCards(cards, docs, row, el, document)"), "the keep pass runs syncDoctorCards, so an unchanged doctor set moves only the stats lines and the live doctor's spinner survives");
assert.ok(rd.includes("(doctorCol(row, d.handle) ?? el).appendChild(b)"), "each doctor card slots into its analysed run's column, unmatched cards fall back to the residual row");
assert.ok(page.includes('meta.classList.toggle("hidden", !label)') && page.includes('" \u00b7 thinking "'), "openLog/pullLog fill the meta line on init and every poll, model name then thinking level");
assert.ok(!page.includes(`+ '</div><div id="m-log"`), "renderAgent no longer rebuilds the log pane with the run cards");
const setBodySrc = page.match(/function setBody\(t\) \{[\s\S]*?\n\}/)![0];
assert.ok(setBodySrc.includes("if (el.__html === html) return;"), "the body rewrite is html-gated: an unchanged body keeps its node and the reader's scroll");
// 000274: the poll path's setBody can land the detail while openTask's loading pin is still set,
// so the 000246 grow runs from setBody and covers both fetch paths; the html gate above keeps an
// identical repeat delivery from restarting the 400 ms unpin
assert.ok(setBodySrc.includes('box.style.height = box.scrollHeight + "px";'), "000274: the grow lives in setBody, so either path that lands the body first reaches it");
assert.ok(setBodySrc.includes('box.style.height = "";') && setBodySrc.includes('box.classList.remove("grow")'), "000274: setBody keeps the 400 ms unpin that returns the pinned height to auto");
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
// the served setBody against stubs: a body landing while the pin is set grows to the measured
// content height, a changed body re-runs the grow, and an identical repeat is html-gated, so
// the unpin runs once the content settles and the height still returns to auto
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
assert.equal(growBox.style.height, "480px", "a body landing while the pin is set grows the box to the measured content height");
assert.equal(growTimers.length, 1, "the grow arms the 400 ms unpin");
setBodyFn({ body: "first" });
assert.equal(growTimers.length, 1, "an identical poll delivery is html-gated, the unpin timer is not restarted");
setBodyFn({ body: "second" });
assert.equal(growTimers.length, 2, "a changed body while the pin is still set re-runs the grow");
growTimers[1]!();
assert.equal(growBox.style.height, "", "the unpin returns the height to auto once the content settles");
assert.ok(!growBox.classList.contains("grow"), "the unpin drops the grow class");
setBodyFn({ body: "third" });
assert.equal(growBox.style.height, "", "a body landing after the unpin writes no height, the box already sits at auto");
assert.equal(growTimers.length, 2, "no pin, no grow: the unpinned path arms no timer");
const mobileBox = new GrowEl();
makeSetBody(true, mobileBox, {})({ body: "mobile" });
assert.equal(mobileBox.style.height, "120px", "the mobile full-screen sheet never gets an inline height");
const ra = page.match(/function renderAgent\(t, keep\) \{[\s\S]*?\n\}/)![0];
assert.ok(ra.includes('.agent-subs").replaceWith(box)'), "a refresh carries the fetched sub boxes over by handle");
assert.ok(ra.includes('ROLE_CLS[a.role] ? ROLE_CLS[a.role] + " " : ""'), "every run card carries its role class, the splitter run keeps agent-splitter");
assert.ok(page.includes('const ROLE_CLS = { splitter: "agent-splitter", developer: "agent-developer", reviewer: "agent-reviewer", merger: "agent-merger", "live-tester": "agent-livetest", "integration-tester": "agent-integration" };'), "the role map names every pipeline role's marker class");
// the integration tester's board column accent doubles as its card color, and its label comes
// from the shared agentLabel pass (the role capitalized, 1-based when the role has several runs)
assert.equal(agentLabel({ role: "integration-tester", run: 0 }, { "integration-tester": 1 }), "Integration-tester", "the integration-tester run card reads its role as a label");
assert.ok(fsSubs.includes('ROLE_CLS[a.role] ? ROLE_CLS[a.role] + " agent-sub" : "agent-sub"'), "sub cards carry their parent run's role class");
// 000130: the keep refresh re-fetches only the live run's sub list, so a sub spawned after the
// card was opened gets its button without re-opening the run; past runs' lists are never re-fetched
assert.ok(ra.includes('if (live) fetchSubs(agentGen, live,') && ra.includes('.agent-col:last-child > .agent-subs'), "the keep refresh re-fetches only the live run's (last column's) sub list");
assert.ok(ra.indexOf("if (keep) {") < ra.indexOf("++agentGen"), "the keep refresh passes the current generation, only an openTask render bumps agentGen");
// 000251: a run-row rebuild lifts the slotted doctor cards out before the innerHTML write and
// re-slots them after, so the keep pass's parentElement check holds and no doctor card remounts
assert.ok(ra.includes("doctorRow.__cards || []"), "the run-row rebuild lifts the slotted doctor cards out before the innerHTML write");
assert.ok(ra.includes("(doctorCol(el, c.dataset.handle) ?? doctorRow).appendChild(c)"), "the run-row rebuild re-slots the preserved doctor cards after");
// 000130: a sub transcript of a still-alive parent keeps polling (an empty poll is not proof a
// growing transcript stopped); a past run's log still stops after the first empty poll
const pollSrc = page.match(/function pollLog\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(pollSrc.includes("const live = (!!liveRun && liveRun.handle === logState.handle) || (!!liveDoctor && liveDoctor.handle === logState.handle);"), "a sub view of a still-alive parent stays live: the pane keeps its poll timer after an empty poll");
// 000222: a live doctor entry keeps its log polling the same way, so a running doctor's pane
// never freezes after an empty poll
assert.ok(pollSrc.includes('const liveDoctor = t && (t.doctors || []).find(d => d.alive);'), "pollLog's live check also matches a live doctors entry, so a live doctor log keeps polling");
assert.ok(!pollSrc.includes("logState.sub == null"), "a sub view is no longer hard-wired non-live, which froze the pane after the first empty poll");
assert.ok(pollSrc.includes("if (!live && logState.idle) {"), "a past run's log still stops the timer after the first empty poll");
// 000353: the run, sub, splitter and doctor cards read their role's stage accent and label
// token; the accents are theme variables now, so each theme block carries the whole ladder
const lightVars = page.match(/:root \{ --bg: [^}]*\}/)![0];
const darkVars = page.match(/:root\[data-theme="dark"\] \{ --bg: [^}]*\}/)![0];
const mediaVars = page.match(/:root:not\(\[data-theme="light"\]\) \{ --bg: [^}]*\}/)![0];
assert.ok(!page.includes("--doctor-fg:") && !page.includes("--doctor-bg:") && !page.includes("--doctor-bg-strong:"), "the doctor variables are gone from the theme blocks");
const ACCENTS = [
	["--accent-backlog", "#828e9f", "#5a6378"],
	["--accent-backlog-text", "#86878c", "#667381"],
	["--accent-todo", "#eba400", "#ffb454"],
	["--accent-todo-text", "#b37c00", "#ffb454"],
	["--accent-review", "#fa8532", "#ff8f40"],
	["--accent-review-text", "#cf6610", "#ff8f40"],
	["--accent-merge", "#a37acc", "#d2a6ff"],
	["--accent-merge-text", "#9d6fc8", "#d2a6ff"],
	["--accent-live", "#22a4e6", "#59c2ff"],
	["--accent-live-text", "#1a91cd", "#59c2ff"],
	["--accent-integration", "#4cbf99", "#95e6cb"],
	["--accent-integration-text", "#3b9b7c", "#95e6cb"],
	["--accent-done", "#86b300", "#aad94c"],
	["--accent-done-text", "#719700", "#aad94c"],
	["--error", "#e65050", "#d95757"],
	["--error-text", "#e5474f", "#d95757"],
] as const;
for (const [name, light, dark] of ACCENTS) {
	assert.ok(lightVars.includes(`${name}: ${light};`), `the light theme sets ${name} to ${light} (got ${lightVars.match(new RegExp(`${name}: [^;]+`))?.[0]})`);
	for (const [theme, block] of [["dark", darkVars], ["prefers-dark", mediaVars]] as const) {
		assert.ok(block.includes(`${name}: ${dark};`), `the ${theme} block sets ${name} to ${dark} (got ${block.match(new RegExp(`${name}: [^;]+`))?.[0]})`);
	}
}
assert.ok(!page.includes("light-dark("), "the accents use no light-dark() helper, both dark paths get their own block");
// 000240: the light hover is a near-opaque very light grey, so a hovered card stays clear
// against the white panel; the dark hover keeps its opaque #1b1f29
assert.ok(lightVars.includes("--hover: rgba(233, 237, 242, .95);"), `the light hover is the very light rgba(233, 237, 242, .95) (got ${lightVars.match(/--hover: [^;]+/)![0]})`);
for (const [theme, block] of [["dark", darkVars], ["prefers-dark", mediaVars]] as const) {
	assert.ok(block.includes("--hover: #1b1f29;"), `the ${theme} hover stays the opaque #1b1f29`);
}
const ROLE_ACCENTS = [["agent-doctor", "done"], ["agent-splitter", "backlog"], ["agent-developer", "todo"], ["agent-reviewer", "review"], ["agent-merger", "merge"], ["agent-livetest", "live"], ["agent-integration", "integration"]] as const;
for (const [role, stage] of ROLE_ACCENTS) {
	assert.ok(page.includes(`.${role} { color: var(--accent-${stage}-text); }`), `the ${role} card label reads the dark ${stage} ladder step at rest`);
	assert.ok(page.includes(`.${role}.agent-card-active { border-color: var(--accent-${stage}); background: color-mix(in srgb, var(--accent-${stage}) 20%, var(--panel)); }`), `the active ${role} card keeps the role-colored outline and a 20% ${stage} panel mix`);
	assert.ok(page.includes(`.${role} .check { color: var(--accent-${stage}); }`), `the ${role} card's checkmark reads the ${stage} accent`);
	assert.ok(!page.includes(`.${role}:hover`), `the ${role} card inherits the plain .agent-card hover, no per-role hover rule`);
}
// 000353: a dead run turns the whole card red, so the failed rule comes after every role rule
// and overrides the label, the active border and the active tint at two-class specificity
const deadAt = page.indexOf(".agent-card.agent-dead {");
assert.ok(deadAt > Math.max(...ROLE_ACCENTS.map(([role]) => page.indexOf(`.${role} .check`))), "the failed card rule lands after the last role rule");
const deadRule = page.match(/\.agent-card\.agent-dead \{[^}]*\}/)![0];
assert.ok(deadRule.includes("color: var(--error-text);") && deadRule.includes("border-color: var(--error);") && deadRule.includes("background: color-mix(in srgb, var(--error) 15%, var(--panel));"), "a dead run's label, outline and 15% tint all read in the error red");
assert.ok(page.includes(".check { color: var(--low-fg); margin-right: 5px; }"), "the unscoped .check keeps var(--low-fg) for the run cards' and sub cards' checkmarks");
assert.ok(page.includes('agentCardHtml("agent-doctor " + (d.alive ? "agent-live" : "agent-past")'), "doctor cards keep their agent-live/agent-past classes under the agent-doctor marker, so no unscoped per-variant rule sets a color on them");
assert.ok(agentCardCss.includes("color: var(--link)") && agentCardCss.includes("border: 1px solid var(--border)") && agentCardCss.includes("background: color-mix(in srgb, var(--panel) 85%, transparent)"), "the unscoped .agent-card keeps gold text, grey outline and the main view's semi-transparent rest background for the run and sub cards");
assert.ok(page.includes(".agent-card:hover { background: var(--hover); }") && page.includes(".agent-card-active { border-color: var(--link); background: color-mix(in srgb, var(--link) 20%, var(--panel)); }"), "the unscoped hover stays and the active rule mixes 20% link into the panel");
// 000276: the sub, splitter and doctor cards read at 85% of the role cards' text, the name line
// and the stats line alike; the four role cards keep the base sizes
assert.ok(page.includes(".agent-sub, .agent-splitter, .agent-doctor { font-size: 0.75rem; }"), "the sub, splitter and doctor card names render at 0.75rem, 85% of the role cards' 0.875rem");
assert.ok(page.includes(".agent-sub .agent-stats, .agent-splitter .agent-stats, .agent-doctor .agent-stats { font-size: 0.625rem; }"), "their stats lines drop to 0.625rem, 85% of the base 0.75rem");
assert.ok(agentCardCss.includes("font-size: 0.875rem") && page.match(/\.agent-stats \{[^}]*\}/)![0].includes("font-size: 0.75rem"), "the base .agent-card and .agent-stats sizes stay, the four role cards keep 0.875rem names and 0.75rem stats");
// 000194: the live pulse follows the viewed run's aliveness, the same signal the poll timer
// reads, refreshed from pullLog after every payload and dropped on close
assert.ok(page.includes("function markLiveLine()"), "the page wires the live block pulse");
assert.ok(page.includes('for (const el of text.children) el.classList.toggle("pulse", el === live)'), "the pulse walks the direct children, the latest live block only");
assert.ok(page.includes("markLiveLine();"), "pullLog, closeLog, pollLog's idle stop and the refresh drive the pulse");
// 000191: the death sweep, the two paths that observe the run's death clear the pulse without a
// close/reopen: the refresh's open-card update (the same pass that drops the dead run's .spin)
// and pollLog's idle early-return (which stops the timer before pullLog could sweep)
assert.ok(upd.includes("markLiveLine();"), "the refresh's open-card update sweeps the pulse when the run dies");
const idleStop = pollSrc.match(/if \(!live && logState\.idle\) \{[\s\S]*?\n\t\}/)![0];
assert.ok(idleStop.includes("markLiveLine();"), "pollLog sweeps the pulse when the idle early-return stops the timer on a dead run");
// 000194 markLiveLine retarget, run against the served source: the pulse lands on the LATEST open
// thinking/tool block only. The stub records the toggles through classList.
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
// the latest open thinking block shines, an earlier closed one and plain text do not
const thinkBlocks = [shThinkBlock(false), new ShineEl("p"), shThinkBlock(true)];
markOf(thinkBlocks)();
assert.ok(thinkBlocks[2].classList.contains("pulse"), "the pulse lands on the latest open thinking block");
assert.ok(!thinkBlocks[0].classList.contains("pulse") && !thinkBlocks[1].classList.contains("pulse"), "an earlier closed block and plain text never shine");
// an executing tool block (its result pre has not arrived) shines, an ended one does not
const toolBlocks = [shToolBlock(true), shThinkBlock(false), shToolBlock(false)];
markOf(toolBlocks)();
assert.ok(toolBlocks[2].classList.contains("pulse"), "the pulse lands on the latest executing tool block");
assert.ok(!toolBlocks[0].classList.contains("pulse"), "an ended tool block does not shine");
// a run between blocks or streaming plain text leaves nothing shining
const idleBlocks = [new ShineEl("p"), shThinkBlock(false), shToolBlock(true), new ShineEl("p")];
markOf(idleBlocks)();
assert.ok(idleBlocks.every((b) => !b.classList.contains("pulse")), "no block shines between blocks or on plain text");
// the shine clears on run death (000193 stays) and when another run's log is open
const dyingBlocks = [shThinkBlock(true), shToolBlock(false)];
markOf(dyingBlocks, { alive: false })();
assert.ok(dyingBlocks.every((b) => !b.classList.contains("pulse")), "a dead run clears the shine");
const otherBlocks = [shThinkBlock(true)];
markOf(otherBlocks, { handle: "other" })();
assert.ok(!otherBlocks[0].classList.contains("pulse"), "a different run's view clears the shine");
// 000194 close paths: one closeAnimated helper serves the modal and the log pane; the hide waits
// for animationend with a fixed-timeout fallback, a reopen during the close cancels it, reduced
// motion hides at once. The X button, the overlay click and Esc all keep the shared closeModal.
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
assert.ok(closing.classList.contains("hidden") && !closing.classList.contains("closing"), "animationend hides the element and drops .closing");
// 000194 review: descendant chunkIn/boxIn ends bubble up, only the element's own exit hides it
const bubbling = new CloseEl();
closeOf(false)(bubbling);
bubbling.listeners[0]({ target: { tag: "pre" } }); // a descendant chunkIn's animationend reaches the pane first
assert.ok(!bubbling.classList.contains("hidden") && bubbling.classList.contains("closing"), "a bubbled descendant animationend does not hide early");
bubbling.listeners[0]({ target: bubbling }); // the element's own exit ends the hide and drops the listener
assert.ok(bubbling.classList.contains("hidden") && !bubbling.classList.contains("closing"), "the element's own animationend hides it");
assert.ok(bubbling.listeners.length === 0, "the hide listener drops after the element's own animationend");
// 000194 review: a reopen drops .closing (the late animationend no-ops above) but the cancelled
// close's fallback timer stays armed; the next close must clear it or it cuts the new exit
const again = new CloseEl();
const timerBase = closeTimers.length;
closeOf(false)(again);
again.classList.remove("closing"); // the reopen inside the fallback window
closeOf(false)(again);
assert.ok(again.classList.contains("closing") && !again.classList.contains("hidden"), "the second close restarts the exit");
assert.ok(closeTimers[timerBase] === null, "the second close clears the cancelled close's stale fallback timer");
closeTimers[timerBase + 1]?.(); // the second close's own fallback fires
assert.ok(again.classList.contains("hidden") && !again.classList.contains("closing"), "the live fallback still hides");
const reopened = new CloseEl();
closeOf(false)(reopened);
reopened.classList.remove("closing"); // openTask/openLog reopen during the close
reopened.listeners[0](); // the late animationend must not re-hide
assert.ok(!reopened.classList.contains("hidden"), "a reopen during the close cancels the pending hide");
const still = new CloseEl();
closeOf(true)(still);
assert.ok(still.classList.contains("hidden") && !still.classList.contains("closing"), "reduced motion hides at once with no exit");
const closeFn = page.match(/function closeModal\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(closeFn.includes("closeLog()") && closeFn.includes("closeAnimated(modal)"), "the modal close clears the log state and runs the shared exit");
// 000251: the loaded log text is the heavy part of the detail card, dropped at close so the tab
// holds no transcript memory while the card is shut; the run cards stay mounted for the reopen
assert.ok(closeFn.includes('getElementById("m-log-text")') && closeFn.includes('textContent = "";'), "the modal close discards the loaded log text");
assert.ok(page.includes('onclick="closeModal()"'), "the X button uses the shared close path");
assert.ok(page.includes('if (e.target.id === "modal") closeModal();'), "the overlay click uses the shared close path");
assert.ok(page.includes('if (e.key === "Escape") closeModal();'), "Esc uses the shared close path");
const closeLogFn = page.match(/function closeLog\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(closeLogFn.indexOf("clearInterval") < closeLogFn.indexOf("closeAnimated") && closeLogFn.includes("logState = null;"), "closeLog clears the poll and the state before the visual hide");
assert.ok(closeLogFn.includes("markActiveAgent();") && closeLogFn.includes("markLiveLine();"), "the active-agent highlight and the shine clear at once too");
assert.ok(page.includes('modal.classList.remove("closing");'), "openTask drops a pending close before reopening");
// 000209: the popup must show the top on every open; the reset runs after the un-hide because a
// scrollTop write while the modal is display: none is discarded and the old offset returns on show
const openTaskSrc = page.match(/function openTask\(file\) \{[\s\S]*?\n\}/)![0];
assert.ok(openTaskSrc.indexOf('classList.remove("hidden")') < openTaskSrc.indexOf("scrollTop = 0"), "openTask resets the scroll after the un-hide, so every open (same-task reopen included) shows the top");
assert.ok(openTaskSrc.includes("fetch(detailUrl(file))"), "000242: openTask fetches the per-task detail");
assert.ok(openTaskSrc.includes("Loading task details"), "000242: openTask shows a loading placeholder while the detail fetch runs");
// 000274: the markdown-before-cards order is fetch priority only (no render gate): both paths
// request the detail first and chain the heavy history behind it
assert.ok(openTaskSrc.indexOf("fetch(detailUrl(file))") < openTaskSrc.indexOf("fetch(historyUrl(file))"), "000274: the open path requests the detail markdown before the heavy history");
const pollDetailSrc = page.match(/function pollDetail\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(pollDetailSrc.indexOf("fetch(detailUrl(modalFile))") < pollDetailSrc.indexOf("fetch(historyUrl(modalFile))"), "000274: the poll path chains detail before history too, the markdown-before-cards order holds on both");
// 000246: the loading state pairs the existing spinner with the label, the arrival grows the
// modal from the pinned loading height to the content height, and the failure path stays static
assert.ok(openTaskSrc.includes('<div class="empty"><span class="spin"></span>Loading task details…</div>'), "000246: the loading placeholder pairs the spinner with the label");
assert.ok(page.includes("#m-box.grow { transition: height var(--enter) ease-out; }"), "000246: the grow is a CSS height transition, no library");
assert.ok(page.includes("@media (prefers-reduced-motion: reduce) { #m-box.grow { transition: none; } }"), "000246: reduced motion turns the grow off");
// 000304 the connector layer paints outside the agent area, bounded by the dialog card
const cssRule = (sel: string) => (page.match(new RegExp("(?:^|\\n)" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{[^}]*\\}")) ?? [""])[0];
assert.ok(cssRule("#agent-relations").includes("overflow: visible"), "the connector svg no longer clips its own strokes at the agent area box");
assert.ok(cssRule("#m-log").includes("position: relative; z-index: 2;"), "the log pane gets its own layer above the connector svg");
assert.ok(cssRule("#m-box").includes("overflow-y: auto; overflow-x: hidden"), "the dialog card clips the strokes at its border and never grows a horizontal scrollbar");
// 000320: a user-held card paints the relation lines' 6-on/4-off rhythm on a pseudo-element (a
// plain dashed border cannot do 6/4), and .card:hover's background shorthand cannot wipe it
assert.ok(cssRule(".card.user-hold::after").includes("repeating-linear-gradient(90deg, var(--border) 0 6px, transparent 6px 10px)"), "the held card's top and bottom edges dash 6px on and 4px off");
assert.ok(cssRule(".card.user-hold::after").includes("repeating-linear-gradient(0deg, var(--border) 0 6px, transparent 6px 10px)"), "the held card's right edge carries the same 6/4 dash");
assert.ok(cssRule(".card.user-hold").includes("border-top-color: transparent") && cssRule(".card.user-hold").includes("border-bottom-color: transparent"), "the solid top and bottom border steps aside for the dashes");
assert.ok(cssRule(".card.user-hold").includes("border-right-color: transparent"), "the solid right border steps aside for the dashes too");
assert.ok(cssRule(".card").includes("border-left: 3px solid var(--ac)") && cssRule(".card").includes("border-radius: 6px"), "the held card keeps the 3px left accent and the 6px radius");
assert.ok(openTaskSrc.includes('box.classList.add("grow")') && openTaskSrc.includes('box.style.height = box.offsetHeight + "px"'), "000246: openTask pins the loading height");
assert.ok(openTaskSrc.indexOf('classList.remove("hidden")') < openTaskSrc.indexOf("box.offsetHeight"), "000246: the pin runs after the un-hide, a hidden box measures zero");
assert.ok(/if \(!d\) \{[\s\S]*?box\.style\.height = ""[\s\S]*?Task details failed to load/.test(openTaskSrc), "000246: a failed fetch unpins the modal before the error shows, so it never grows");
// 000251: no upfront agent render from the light row (the row data carries no doctors and no
// mounted sub boxes, so every card unmounted and remounted on the detail); the mounted cards
// are this task's on a same-task reopen, the row clears once on a switch, and the history
// render keeps mode so the cards mount once and stay mounted
assert.ok(!openTaskSrc.includes("renderAgent(t)") && !openTaskSrc.includes("renderDoctor(t)"), "openTask never renders the agent or doctor rows from the light row");
assert.ok(openTaskSrc.includes("renderAgent({})") && openTaskSrc.includes("renderDoctor({})"), "a task switch clears the stale row once, a same-task reopen keeps the mounted cards");
assert.ok(openTaskSrc.includes("renderAgent(h, keepCards)") && openTaskSrc.includes("renderDoctor(h, keepCards)"), "the history render keeps mode, the cards mount once and stay mounted across opens");
assert.ok(!page.includes("detailGen"), "no detail generation counter, a poll cycle never discards a just-opened task's response");
assert.match(page, /function openLog\(handle, sub\) \{[\s\S]*?p\.classList\.remove\("closing"\);/, "openLog drops a pending close before reopening");
// 000243: opening a log clears the previous agent's content at once and shows the loading state
// until the init payload replaces it; a failed init fetch leaves that loading state in place,
// never the previous agent's log
const openLogBody = page.match(/function openLog\(handle, sub\) \{[\s\S]*?\n\}/)![0];
let logPaneText = "the previous agent's log";
const logTextStub = {
	get textContent() { return logPaneText; },
	set textContent(v: string) { logPaneText = v; },
	classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
};
const logMetaStub = { textContent: "", classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} } };
const logPaneStub = { classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} } };
let openInitMode = "";
const openLogFn = new Function(
	"activeBoard", "modalFile", "logPane", "document", "markActiveAgent", "pullLog", "pollLog", "logUrl", "setInterval", "clearInterval",
	"let logState = null, logTimer = null;\n" + openLogBody + "\nreturn openLog;",
)(
	() => ({ tasks: [{ file: "t.md" }] }),
	"t.md",
	() => logPaneStub,
	{ getElementById: (id: string) => (id === "m-log-text" ? logTextStub : id === "m-log-meta" ? logMetaStub : null) },
	() => {},
	(_qs: string, mode: string) => { openInitMode = mode; },
	() => {},
	() => "",
	() => 1,
	() => {},
);
openLogFn("t.developer.0", null);
assert.equal(logPaneText, "Loading...", "openLog clears the previous agent's log and shows the loading text before the init payload");
assert.equal(openInitMode, "init", "openLog still starts the init fetch after clearing the pane");
const pullLogBody = page.match(/function pullLog\(qs, mode\) \{[\s\S]*?\n\}/)![0];
const failedState: Record<string, any> = { handle: "t.developer.0", sub: null, head: 0, tail: 0, busy: false };
let failedIngest = 0;
const failingPull = new Function(
	"logState", "logPane", "document", "fetch", "ingest", "logFixups", "glide", "atBottom", "markLiveLine",
	pullLogBody + "\nreturn pullLog;",
)(
	failedState,
	() => logPaneStub,
	{ getElementById: (id: string) => (id === "m-log-text" ? logTextStub : logMetaStub) },
	() => Promise.reject(new Error("offline")),
	() => { failedIngest++; },
	() => {},
	() => {},
	() => true,
	() => {},
);
failingPull("", "init");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(failedIngest, 0, "a failed init fetch renders no log content");
assert.equal(logPaneText, "Loading...", "a failed init fetch leaves the loading text visible, never the previous agent's log");

// 000142 the poll refresh updates the agent row in place: an unchanged run set moves only the
// cards' .agent-stats text, so the live run's .spin node keeps its animation across the poll; a
// structure change (a run added or gone, live -> dead) rebuilds the row. runRow builds the row
// the page's rebuild would have produced, with its seeded signature.
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
assert.equal(agentRow.children[1].children[0].children[0], spin, "the same .spin node keeps its animation running");
assert.equal(agentRow.children[1].children[0].children[1].textContent, "999 · 1m 30s", "the live card's stats text moved");
assert.equal(agentRow.children[0].children[0].children[1].textContent, "2k · 1m 30s", "the past card's stats text moved too");
assert.equal(agentRow.children[1].children[0].writes, 0, "the card's markup is not rewritten, so nothing restarts");
assert.ok(syncAgentStats(agentRow, grew, docStub), "a second unchanged pass still matches");
assert.equal(agentRow.children[1].children[0].children[1].textContent, "999 · 1m 30s", "unchanged stats keep their text");
assert.equal(syncAgentStats(agentRow, [...grew, { role: "live-tester", run: null, alive: false, status: "ok", handle: "t.live-tester", tokens: null, duration: null }], docStub), false, "a run added rebuilds");
assert.equal(syncAgentStats(agentRow, grew.slice(1), docStub), false, "a run gone rebuilds");
assert.equal(syncAgentStats(agentRow, grew.map((a) => (a.alive ? { ...a, alive: false, status: "ok" } : a)), docStub), false, "live -> dead rebuilds");
assert.equal(syncAgentStats(new El("div"), grew, docStub), false, "a missing row rebuilds");
// a card whose stats were empty carries no span; the span joins when stats arrive and drops when
// they vanish, the markup agentCardHtml renders
const bare = runRow([{ role: "developer", run: null, alive: true, status: "live", handle: "t.developer", tokens: null, duration: null }]);
assert.equal(bare.children[0].children[0].children.length, 1, "empty stats render no span");
assert.ok(syncAgentStats(bare, [{ role: "developer", run: null, alive: true, status: "live", handle: "t.developer", tokens: 999, duration: 1200 }], docStub), "the unchanged run set still updates in place");
assert.equal(bare.children[0].children[0].children[1].textContent, "999 · 1s", "the span joins the card when stats arrive");
assert.ok(syncAgentStats(bare, [{ role: "developer", run: null, alive: true, status: "live", handle: "t.developer", tokens: null, duration: null }], docStub), "the unchanged run set still updates in place");
assert.equal(bare.children[0].children[0].children.length, 1, "the span drops when the stats vanish");
// 000230 the doctor cards slot into their analysed run's column, matched by handle: a doctor
// entry's handle is the parent run's handle plus the .doctor suffix; unmatched cards (run log
// rotated away) keep the residual #m-doctor row. syncStatsLine moves one card's stats line in
// place, the markup agentCardHtml renders, shared by syncAgentStats and the doctor keep pass
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
assert.equal(doctorCol(slotRow, "t.developer.0.doctor"), slotRow.children[0], "the doctor handle strips the .doctor suffix and matches the analysed run's column");
assert.equal(doctorCol(slotRow, "t.developer.9.doctor"), null, "no run column carries the handle (run log rotated away), the card falls back to the residual row");
const residual = new El("div");
const doctorDocs = [mkDoc("t.developer.0.doctor", false, 20, 5000), mkDoc("t.missing.0.doctor", true, 30, 60000)];
const doctorCards = doctorDocs.map((d) => {
	const card = doctorCardEl(d);
	(doctorCol(slotRow, d.handle) ?? residual).appendChild(card);
	return card;
});
residual.__sig = agentRowSig(doctorDocs);
const docSpin = doctorCards[1].children[0];
assert.ok(docSpin.className === "spin", "the live doctor card carries its spinner");
assert.equal(doctorCards[0].parentElement, slotRow.children[0], "the matched card slots into its analysed run's column");
assert.equal(doctorCards[1].parentElement, residual, "the unmatched card stays in the residual row");
const doctorGrew = [mkDoc("t.developer.0.doctor", false, 30, 9000), mkDoc("t.missing.0.doctor", true, 40, 90000)];
residual.__sig = agentRowSig(doctorGrew);
assert.ok(syncDoctorCards(doctorCards, doctorGrew, slotRow, residual, docStub), "an unchanged doctor set updates the cards in place");
assert.equal(doctorCards[1].children[0], docSpin, "the same .spin node keeps its animation running");
assert.equal(doctorCards[1].children[1].textContent, "40 · 1m 30s", "the live doctor card's stats line moved");
assert.equal(doctorCards[0].children[1].textContent, "30 · 9s", "the past doctor card's stats line moved too");
assert.equal(doctorCards[1].children[0].children.length, 0, "no stray span lands inside the mark span");
assert.equal(syncDoctorCards(doctorCards, doctorGrew.slice(1), slotRow, residual, docStub), false, "a doctor card gone rebuilds");
assert.equal(syncDoctorCards(doctorCards, [...doctorGrew, mkDoc("t.developer.9.doctor", false, 1, 1)], slotRow, residual, docStub), false, "a doctor card added rebuilds");
const rebuiltRow = runRow([
	{ role: "developer", run: 0, alive: false, status: "ok", handle: "t.developer.0", tokens: null, duration: null },
	{ role: "reviewer", run: 1, alive: false, status: "ok", handle: "t.reviewer.1", tokens: null, duration: null },
]);
assert.equal(syncDoctorCards(doctorCards, doctorGrew, rebuiltRow, residual, docStub), false, "a run-row rebuild detaches the slotted cards, the keep pass rebuilds and re-slots");
residual.__sig = agentRowSig(doctorGrew.map((d) => (d.alive ? { ...d, alive: false, status: "ok" } : d)));
assert.equal(syncDoctorCards(doctorCards, doctorGrew, slotRow, residual, docStub), false, "live -> dead flips the signature, the rebuild swaps the spinner for the check");
const lone = doctorCardEl(mkDoc("t.developer.0.doctor", false, null, null));
assert.equal(lone.children.length, 1, "empty stats render no span");
syncStatsLine(lone, 999, 1200, docStub);
assert.equal(lone.children[1].textContent, "999 · 1s", "the span joins the card when stats arrive");
syncStatsLine(lone, null, null, docStub);
assert.equal(lone.children.length, 1, "the span drops when the stats vanish");
// the page wires the helpers: the rebuild seeds the signature, the keep pass syncs the stats
assert.ok(ra.includes("if (keep && syncAgentStats(el, runs, document))"), "the keep pass updates an unchanged row's stats in place");
assert.ok(ra.includes("el.__sig = agentRowSig(runs)"), "the rebuild seeds the structure signature the keep pass matches");
assert.ok(ra.includes('el.__sig = "";'), "an empty run set clears the signature");
assert.ok(page.includes(String(agentRowSig)) && page.includes(String(syncAgentStats)), "the page runs the tested agent-row helpers");
assert.ok(page.includes(String(syncStatsLine)) && page.includes(String(doctorCol)) && page.includes(String(syncDoctorCards)), "the page runs the tested doctor-slot helpers");
assert.ok(page.includes('for (const b of document.querySelectorAll("#m-agent .agent-card"))'), "markActiveAgent's #m-agent scope still hits the in-column doctor cards");
// 000237 the detail card's relation lines: an SVG layer inside #m-agent (relative, fenced at
// z-index 0 so the sticky #m-head keeps covering the scrolled area) draws the run chain
// right-out/left-in with the board curve and drops a line from each run card's bottom edge into
// every sub and doctor card's left side, dimmed at rest, raised on hover and while selected
const boardPathCss = page.match(/#relations path \{[^}]*\}/)![0];
assert.ok(page.includes('<div id="m-agent"><svg id="agent-relations"></svg><div id="m-agent-btns"></div>'), "the relation SVG ships as #m-agent's first child, before the cards");
assert.ok(page.includes("#m-agent { position: relative; z-index: 0; margin-bottom: 12px; }"), "#m-agent is the SVG's offset parent and its own stacking context, so the z-index-2 cards stay under the sticky #m-head");
const relSvgCss = page.match(/#agent-relations \{[^}]*\}/)![0];
assert.ok(relSvgCss.includes("pointer-events: none") && relSvgCss.includes("z-index: 1"), "the relation SVG never intercepts card clicks and paints below the cards");
const relPathCss = page.match(/#agent-relations path \{ fill[^}]*\}/)![0];
assert.ok(relPathCss.replace("#agent-relations", "#relations") === boardPathCss.replace(" animation-direction: reverse;", ""), "the detail card's path style mirrors the board's #relations path apart from the board-only reversed dash flow");
assert.ok(page.includes("#agent-relations path.relations-hot, #agent-relations path.relations-sel { stroke-opacity: .8; }"), "hover and selection raise a connected line to the board's hot opacity");
assert.ok(page.includes("#relations path, #agent-relations path { animation: none; }"), "reduced motion stops the dashflow on the detail card's lines too");
assert.ok(agentCardCss.includes("position: relative") && agentCardCss.includes("z-index: 2"), "the agent cards stack at z-index 2 above the lines, like the board's cards");
const drawFn = page.match(/function drawAgentRelations\(\) \{[\s\S]*?\n\}/)![0];
assert.ok(drawFn.includes("curve("), "the run chain reuses the board curve geometry");
assert.ok(drawFn.includes('.replace(/\\.doctor$/, "")'), "a doctor card matches its analysed run by stripping the trailing .doctor (the #230 rule)");
assert.ok(drawFn.includes("if (svg.__html !== html)"), "the rewrite is html-gated, so the dash animation survives a refresh that changes nothing");
assert.ok(drawFn.includes("if (hoverHandle) hotAgentRelations(hoverHandle, true)"), "a rewrite re-applies the hover highlight, so a redraw landing mid-hover does not kill it");
assert.ok(page.includes("hoverHandle = on ? handle : null;"), "the hover helper tracks the hovered handle for the rewrite re-apply");
assert.ok(openTaskSrc.indexOf('classList.remove("hidden")') < openTaskSrc.indexOf("drawAgentRelations()"), "the open draw runs after the un-hide: rects read zero while the modal is display: none");
assert.ok(openTaskSrc.includes("onanimationend"), "the entrance transform skews the first measure, the settled box redraws once");
assert.ok(upd.includes("drawAgentRelations()"), "the poll refresh redraws the lines");
assert.ok(page.includes("markActiveAgent();\n\t\tdrawAgentRelations();"), "sub fetches landing redraw the lines");
assert.ok(page.includes('window.addEventListener("resize", drawAgentRelations);'), "a window resize redraws the lines");
assert.equal([...page.matchAll(/b\.onmouseenter = \(\) => hotAgentRelations\(b\.dataset\.handle, true\);/g)].length, 3, "run, sub and doctor cards all bind the hover raise, mouseleave reverts");
assert.ok(page.includes('for (const path of document.querySelectorAll("#agent-relations path"))'), "markActiveAgent also toggles the selection highlight on the connected lines");
// 000237/000238/000302 run against the served source: the drop leaves the run card's bottom edge
// heading down and enters the sub or doctor card's left side heading right; the horizontal approach
// is 2.5 times the span-scaled base, rounded to 5px and uncapped, so the SVG paints it outside the area
const relDrop = new Function(page.match(/function dropCurve\(from, to\) \{[\s\S]*?\n\}/)![0] + "; return dropCurve;")();
const dropPath = relDrop({ x: 0, y: 0, w: 200, h: 40 }, { x: 0, y: 44, w: 200, h: 30 });
assert.ok(dropPath.startsWith("M 100 40 C"), "the drop leaves the run card's bottom edge at its center");
assert.ok(dropPath.endsWith(", 0 59"), "the drop enters the sub card's left side at its vertical middle");
const dropSeg = dropPath.match(/C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)$/)!;
assert.ok(Number(dropSeg[1]) === 100 && Number(dropSeg[2]) === 49.5, "the departure control sits below the bottom edge at today's half-span, so the line heads down");
assert.ok(Number(dropSeg[3]) === -90 && Number(dropSeg[4]) === 59, "the approach is uncapped, so a card flush with the area's left edge takes the full 90px run-in and the arrival control sits left of the edge");
assert.equal(relDrop({ x: 0, y: 0, w: 200, h: 40 }, { x: 300, y: 44, w: 200, h: 30 }), "M 100 40 C 100 49.5, 150 59, 300 59", "a card with space to its left gets the base capped at 60px, 2.5 times to 150px and rounded to 5px");
// the six pinned spans: base 8, 20, 35, 60, then the two left-edge cards that took the old x2 cap
const relDropD = (x1, x2) => {
	const m = relDrop({ x: x1 - 100, y: 0, w: 200, h: 40 }, { x: x2, y: 44, w: 200, h: 30 }).match(/C -?[\d.]+ (-?[\d.]+), (-?[\d.]+) -?[\d.]+, -?[\d.]+ -?[\d.]+$/)!;
	return x2 - Number(m[2]);
};
for (const [x1, x2, d] of [[100, 123, 20], [100, 157, 50], [100, 200, 90], [100, 300, 150], [240, 40, 150], [100, 6, 80]])
	assert.equal(relDropD(x1, x2), d, "a " + Math.abs(x1 - x2) + "px span with " + x2 + "px of space left of the card gets a " + d + "px approach");
// 000237 run the served draw against a stub agent area: two run columns with run 2 wrapped below
// run 1, two subs under run 1, one doctor card in the residual #m-doctor row. The wrap must not
// break the chain: curve spans any x/y pair, so the line still connects the wrapped pair
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
assert.equal(relHotApply, "t.dev.0", "the rewrite re-applies the hovered handle's highlight");
const drawn = relSvg.innerHTML.match(/<path [^>]*\/>/g) ?? [];
assert.equal(drawn.length, 4, "two wrapped runs, two subs and one doctor draw four lines");
assert.ok(drawn[0].includes('data-from="t.dev.0"') && drawn[0].includes('data-to="t.rev.1"'), "the chain path carries both run handles");
const chainSeg = drawn[0].match(/d="M (-?[\d.]+) (-?[\d.]+) C (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+), (-?[\d.]+) (-?[\d.]+)"/)!;
assert.ok(chainSeg[1] === "200" && chainSeg[2] === "20", "the chain leaves the first run card's right edge");
assert.ok(chainSeg[7] === "0" && chainSeg[8] === "170", "the chain enters the wrapped run card's left edge: the wrap does not break the pair");
assert.ok(drawn[1].includes('data-from="t.dev.0"') && drawn[1].includes('data-to="t.dev.0"') && drawn[1].includes('d="M 100 40 C 100 49.5, -90 59, 0 59"'), "a sub's drop line runs from its run card's bottom edge into its left side");
assert.ok(drawn[3].includes('data-to="t.dev.0.doctor"') && drawn[3].includes('d="M 100 40 C 100 100, -90 215, 0 215"'), "a doctor card in the residual row still drops from its analysed run's card");
relHotApply = null;
relDraw();
assert.equal(relMarks, 1, "the rewrite is html-gated: an unchanged redraw neither rewrites nor re-runs markActiveAgent");
assert.equal(relHotApply, null, "an unchanged redraw re-applies no hover");
relHotApply = null;
relRun2.rect = { left: 0, top: 160, width: 200, height: 40 };
relDraw();
assert.ok(relSvg.innerHTML !== drawn.join("") && relMarks === 2, "a layout change rewrites the lines and re-applies the selection");
assert.equal(relHotApply, "t.dev.0", "a layout change re-applies the hovered handle's highlight");
const htmlHidden = relSvg.innerHTML;
relModal.className = "hidden";
relDraw();
assert.equal(relSvg.innerHTML, htmlHidden, "a draw with the modal hidden bails before measuring display: none rects");
relModal.className = "";
// 000237 hover: the hot function toggles only the paths the hovered card connects to
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
relHot("t.rev.1.doctor", true);
assert.ok(hotPath2.classList.contains("relations-hot"), "a doctor card's handle matches its drop line");
// 000237 selection: the selected card's connected lines carry .relations-sel while its log is
// open, a sub view selects through the parent's handle, closing the log clears them
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
assert.ok(selRun.classList.contains("agent-card-active"), "the open run's card is active");
assert.ok(selPath1.className.includes("relations-sel") && !selPath2.className.includes("relations-sel"), "the selected card's connected lines highlight, unconnected ones stay dim");
const markSubSel = new Function("logPane", "logState", "document", page.match(/function markActiveAgent\(\) \{[\s\S]*?\n\}/)![0] + "; return markActiveAgent;")(() => selPane, { handle: "t.dev.0", sub: "2" }, selDoc);
markSubSel();
assert.ok(selSub.classList.contains("agent-card-active") && selPath1.className.includes("relations-sel"), "a sub view selects through the parent run's handle, its run's lines stay lit");
const markNone = new Function("logPane", "logState", "document", page.match(/function markActiveAgent\(\) \{[\s\S]*?\n\}/)![0] + "; return markActiveAgent;")(() => selPane, null, selDoc);
markNone();
assert.ok(!selRun.classList.contains("agent-card-active") && !selPath1.className.includes("relations-sel"), "closing the log clears the active card and the line highlight");
// the cadence: 1 s while the open task has a live agent, 5 s otherwise, log pane open or closed
assert.equal(refreshMs({ agents: [{ alive: true }] }), 1000, "a live agent on the open card ticks the poll at 1 s");
assert.equal(refreshMs({ agents: [{ alive: false }], doctors: [{ alive: true }] }), 1000, "a live doctor with no live agent also ticks the poll at 1 s");
assert.equal(refreshMs({ agents: [{ alive: false }], doctors: [{ alive: false }] }), 5000, "no live agent and no live doctor keeps the 5 s cadence");
assert.equal(refreshMs({ agents: [{ alive: false }] }), 5000, "no live agent keeps the 5 s cadence");
assert.equal(refreshMs({ agents: [] }), 5000, "an empty agent history keeps the 5 s cadence");
assert.equal(refreshMs({}), 5000, "a task without agents keeps the 5 s cadence");
assert.equal(refreshMs(null), 5000, "a closed modal keeps the 5 s cadence");
assert.ok(page.includes(String(refreshMs)), "the page runs the tested cadence helper");

setState(root, getTask(root, task.file)!, "doing");
const slug = task.file.replace(/\.md$/, "");
mkdirSync(join(root, ".kanban", ".pids"), { recursive: true });
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), String(process.pid));
mkdirSync(join(root, ".kanban", ".logs"), { recursive: true });
const logFile = join(root, ".kanban", ".logs", `${slug}.developer.log`);
const logText = Array.from({ length: 350 }, () => "H".repeat(63) + "\n").join(""); // 64-byte lines: far under the old byte chunk, so the collapsed-line cap is what pages
writeFileSync(logFile, logText);

console.log("page.test.ts: all assertions passed");
