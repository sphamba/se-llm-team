import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIORITY_RANK } from "../kanban.ts";
import { esc, inline, logFixups, md } from "./logpane.ts";
import { agentLabel, agentRowSig, agentStatsText, buildShell, cardBaseHtml, cardHtml, curve, flipDiff, fmtDur, fmtTokens, LAYOUT, numLinkHtml, relationPaths, spinnerHtml, syncAgentStats, syncBoard, syncCardStats, taskStats, taskStatsText } from "./board.ts";

// the served page: PAGE interpolates the tested renderers and helpers as client source; the
// webui config loader and the per-tab client state helpers live here too
const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 4242;

export interface WebUiConfig {
	enabled: boolean;
	host: string;
	port: number;
}

// se-llm-team.json: user level first, project .kanban/se-llm-team.json overrides it;
// a missing file, invalid JSON or absent keys mean off
export function loadWebUiConfig(root?: string): WebUiConfig {
	const paths = [join(process.env.HOME ?? "", ".pi", "agent", "se-llm-team.json")];
	if (root) paths.push(join(root, ".kanban", "se-llm-team.json"));
	let webUi: { enabled?: boolean; host?: string; port?: number } | undefined;
	for (const path of paths) {
		try {
			webUi = JSON.parse(readFileSync(path, "utf8")).webUi ?? webUi;
		} catch {
			// missing file or invalid JSON
		}
	}
	return { enabled: webUi?.enabled === true, host: webUi?.host ?? DEFAULT_HOST, port: webUi?.port ?? DEFAULT_PORT };
}

// tab descriptors from the hub's /api/projects entries: one tab per registered project, and none for a
// single project, so a single-project setup (or the single-project server, whose /api/projects is
// a 404) keeps the old single-board ui. The identity is the entry's root, unique per checkout, so
// two same-named checkouts select their own boards; a name registered more than once appends the
// branch to the label ("" on a detached HEAD keeps the plain name)
export function tabNames(projects) {
	if (projects.length < 2) return [];
	const seen = Object.create(null); // a repo basename can collide with Object.prototype keys
	for (const p of projects) seen[p.name] = (seen[p.name] ?? 0) + 1;
	return projects.map((p) => ({
		id: p.root,
		label: seen[p.name] > 1 && p.branch ? p.name + " (" + p.branch + ")" : p.name,
	}));
}

// tab bar html: one button per tab, data-project carries the root identity, the active one
// marked; a single project renders no bar
export function tabsHtml(tabs, active) {
	if (tabs.length < 2) return "";
	return tabs
		.map((t) => '<button class="tab' + (t.id === active ? " active" : "") + '" data-project="' + esc(t.id) + '">' + esc(t.label) + "</button>")
		.join("");
}

// per-project client state: each tab keeps its payload and its fold choices, so a tab switch
// renders cached data with no flash and a poll of one project never clobbers another
export function boardOf(boards, name) {
	return (boards[name] ??= { tasks: [], expanded: new Set() });
}

// one poll cycle into the per-project state: each payload lands under its own project name, and a
// null payload (project vanished or its fetch failed) keeps that tab's previous data
export function mergeBoards(boards, rows) {
	for (const [name, tasks] of rows) if (tasks) boardOf(boards, name).tasks = tasks;
}

// the open detail card's poll cadence (000142): a live agent's tokens and duration advance with
// the run log, so while the open task has one the poll ticks at 1 s; otherwise the 5 s board poll
export function refreshMs(t) {
	return t && (t.agents || []).some((a) => a.alive) ? 1000 : 5000;
}

// Ayu Dark palette (ayu-theme/ayu-colors), written once and applied twice: explicit choice via data-theme, browser default via media query
const DARK_VARS = `
:root[data-theme="dark"] { --bg: #10141c; --fg: #bfbdb6; --panel: #141821; --border: #1b1f29; --heading: #bfbdb6; --muted: #5a6673; --faint: #5a6673; --soft: #bfbdb6; --hover: #1b1f29; --overlay: rgba(0, 0, 0, .6); --code-bg: #010102; --link: #e6b450;
/* 000129: medium/critical hues widened (yellow / strong red) so the priority chips read apart; -bg tints match their fg */
--low-bg: rgba(170, 217, 76, .15); --low-fg: #aad94c; --medium-bg: rgba(255, 209, 115, .15); --medium-fg: #ffd173; --high-bg: rgba(255, 143, 64, .15); --high-fg: #ff8f40; --critical-bg: rgba(255, 82, 82, .15); --critical-fg: #ff5252; }
:root[data-theme="dark"] #theme { color: var(--link); border-color: var(--link); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #10141c; --fg: #bfbdb6; --panel: #141821; --border: #1b1f29; --heading: #bfbdb6; --muted: #5a6673; --faint: #5a6673; --soft: #bfbdb6; --hover: #1b1f29; --overlay: rgba(0, 0, 0, .6); --code-bg: #010102; --link: #e6b450;
--low-bg: rgba(170, 217, 76, .15); --low-fg: #aad94c; --medium-bg: rgba(255, 209, 115, .15); --medium-fg: #ffd173; --high-bg: rgba(255, 143, 64, .15); --high-fg: #ff8f40; --critical-bg: rgba(255, 82, 82, .15); --critical-fg: #ff5252; }
:root:not([data-theme="light"]) #theme { color: var(--link); border-color: var(--link); } }
`;

// served by the single-project server and by the hub for every registered project; the tab bar
// comes from the hub's /api/projects and each tab polls /api/tasks?project=<root id>
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Software Engineering LLM Team</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; }
/* Ayu Light palette (ayu-theme/ayu-colors); 000129: medium moved to a deeper yellow so the priority chips read apart */
:root { --bg: #fcfcfc; --fg: #5c6166; --panel: #ffffff; --border: rgba(107, 125, 143, .12); --heading: #5c6166; --muted: #adaeb1; --faint: #adaeb1; --soft: #5c6166; --hover: rgba(130, 142, 159, .1); --overlay: rgba(15, 23, 42, .45); --code-bg: #ebeef0; --link: #f29718;
--low-bg: rgba(134, 179, 0, .15); --low-fg: #86b300; --medium-bg: rgba(201, 151, 0, .15); --medium-fg: #c99700; --high-bg: rgba(250, 133, 50, .15); --high-fg: #fa8532; --critical-bg: rgba(230, 80, 80, .15); --critical-fg: #e65050;
/* 000191: motion knobs, one place to retune the entrances, the chunk fade and the pulse loop */
--enter: 200ms; --fade: 150ms; --pulse: 1.8s; }
${DARK_VARS}
html, body { height: 100%; }
body { display: flex; flex-direction: column; margin: 0; background: var(--bg); color: var(--fg); font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
/* 000147: buttons inherit the page font instead of the UA Arial default */
button { font-family: inherit; }
header { display: flex; align-items: baseline; gap: 10px; padding: 14px 18px 6px; background: var(--code-bg); }
h1 { font-size: 16px; margin: 0; }
#theme { margin-left: auto; border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
#theme:hover { background: var(--hover); }
#updated { font-size: 12px; color: var(--muted); }
/* 000165: the serving hub's identity, hidden until the first /api/hub answer fills it */
#hub { padding: 2px 18px 8px; font-size: 11px; color: var(--muted); }
#hub:empty { display: none; }
/* 000091: a relative #tabs at z-index 1 keeps the bar above the overlay and clickable while a modal is open; 000119: #modal must sit above #tabs and #relations (both z-index 1) or the relation lines paint over it; 000124: the task cards stack at z-index 2, so #modal bumps to 3 */
#tabs { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 18px 0; }
#tabs:empty { display: none; }
.tab { border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px 6px 0 0; padding: 4px 12px; font-size: 12px; cursor: pointer; }
.tab:hover { background: var(--hover); }
.tab.active { border-color: var(--link); color: var(--link); }
#board { flex: 1 1 auto; min-height: 0; display: flex; gap: 10px; padding: 10px 18px 18px; overflow-x: auto; align-items: flex-start; position: relative; }
/* relation lines: absolute in the relative board, so the overlay scrolls with the content; z-index 1
paints them above the static .col/.pair containers and below the z-index-2 task cards, pointer-events
none so the card clicks pass through */
#relations { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }
/* 000127: the low opacity keeps the lines a subtle hint behind the semi-transparent cards; hovering either connected card raises it (.relations-hot) */
#relations path { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-opacity: .3; stroke-dasharray: 6 4; animation: dashflow 1s linear infinite; transition: stroke-opacity .15s ease; }
#relations path.relations-hot { stroke-opacity: .8; }
@keyframes dashflow { to { stroke-dashoffset: -10; } }
/* 000047: the middle columns stack as pairs, sized and gapped like the single columns */
.pair { display: flex; flex-direction: column; gap: 10px; min-width: 300px; flex: 1 0 300px; }
.col { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; border-top: 3px solid var(--ac); padding: 10px; min-width: 300px; flex: 1 0 300px; }
/* 000096: as a .pair child the .col basis would act on the height axis and floor it at 300px */
.pair .col { flex: 0 0 auto; }
.col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 10px; color: var(--heading); }
.count { color: var(--faint); }
/* 000124: positioned above the z-index-1 relation lines; the semi-transparent background lets a line passing under the card show through faintly (no --card var, --panel is the card's base color in both themes) */
.card { position: relative; z-index: 2; background: color-mix(in srgb, var(--panel) 85%, transparent); border: 1px solid var(--border); border-left: 3px solid var(--ac); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; }
.card:hover { background: color-mix(in srgb, var(--hover) 85%, transparent); }
/* 000191: genuinely new cards fade and rise in once at insertion; syncBoard adds .enter only at
creation and the page drops it on animationend, so a poll or a reorder never replays it */
.card.enter { animation: cardIn var(--enter) ease-out; }
@keyframes cardIn { from { opacity: 0; transform: translateY(3px); } }
.name { font-size: 13px; line-height: 1.35; margin-bottom: 6px; }
.num { color: var(--faint); margin-right: 4px; }
.num-link { color: var(--link); cursor: pointer; }
.num-link:hover { text-decoration: underline; }
.spin { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border: 2px solid var(--border); border-top-color: var(--fg); border-radius: 50%; vertical-align: -1px; animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } #relations path { animation: none; } }
.chip { font-size: 10px; padding: 1px 7px; border-radius: 999px; background: var(--border); color: var(--soft); }
.chip.issuer { background: var(--code-bg); color: var(--muted); }
.chip.cx { background: var(--code-bg); color: var(--muted); }
.issued { color: var(--muted); }
.card-stats { display: block; font-size: 10px; color: var(--muted); margin-top: 2px; }
.p-low { background: var(--low-bg); color: var(--low-fg); }
.p-medium { background: var(--medium-bg); color: var(--medium-fg); }
.p-high { background: var(--high-bg); color: var(--high-fg); }
.p-critical { background: var(--critical-bg); color: var(--critical-fg); }
/* 000129: per-value complexity chips reuse the priority palette; .chip.cx above stays as the fallback for an unknown value */
.chip.cx-simple { background: var(--low-bg); color: var(--low-fg); }
.chip.cx-moderate { background: var(--medium-bg); color: var(--medium-fg); }
.chip.cx-complex { background: var(--critical-bg); color: var(--critical-fg); }
/* 000143: calm blue-grey tint with the theme foreground, readable in both themes */
.chip.cx-trivial { background: rgba(100, 130, 165, .18); color: var(--fg); }
.empty { font-size: 12px; color: var(--faint); }
.toggle { display: block; width: 100%; margin-top: 2px; border: 1px solid var(--border); background: var(--panel); color: var(--link); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.toggle:hover { background: var(--hover); }
/* 000120: each run as a card, its subagent cards stacked below it in the same column */
.agent-card { display: block; border: 1px solid var(--border); background: var(--panel); color: var(--link); border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; text-align: left; }
.agent-card:hover { background: var(--hover); }
/* 000191: a genuinely new run card rises in with the board cards' entrance */
.agent-card.enter { animation: cardIn var(--enter) ease-out; }
.agent-card-active { border-color: var(--link); background: var(--medium-bg); }
.agent-dead { color: var(--critical-fg); }
.agent-stats { display: block; font-size: 10px; color: var(--muted); margin-top: 2px; }
.agent-col { display: flex; flex-direction: column; gap: 4px; }
.agent-subs { display: flex; flex-direction: column; gap: 4px; }
.agent-subs:empty { display: none; }
#m-agent-btns { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
.check { color: var(--low-fg); margin-right: 5px; }
.cross { color: var(--critical-fg); margin-right: 5px; }
#m-agent { margin-bottom: 12px; }
/* 000152: the pane grows to 70vh so long logs show more content */
#m-log { margin-top: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--code-bg); max-height: 70vh; overflow: auto; }
#m-log.hidden { display: none; }
/* 000191: the pane fades and rises on open; entrance only */
#m-log:not(.hidden) { animation: logIn var(--enter) ease-out; }
@keyframes logIn { from { opacity: 0; transform: translateY(4px); } }
#m-log-meta { padding: 6px 10px 0; font-size: 10px; line-height: 1.45; color: var(--muted); }
#m-log-meta.hidden { display: none; }
/* the log text renders in the page's Inter stack; 000152: the size matches the card body text, only the line-height stays tuned for logs; blocks are collapsed <details> the client fills in */
#m-log-text { margin: 0; padding: 8px 10px; font-size: 13px; line-height: 1.45; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; white-space: pre-wrap; overflow-wrap: break-word; }
#m-log-text pre { font: inherit; margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: break-word; }
#m-log-text details { margin: 2px 0; }
#m-log-text summary { cursor: pointer; }
#m-log-text details.lg-think, #m-log-text details.lg-tool { color: var(--muted); }
#m-log-text details > pre { padding-left: 12px; }
/* 000191: appended chunks fade and rise in; a CSS animation replays only on newly inserted
nodes, so untouched siblings never re-animate and only new content moves */
#m-log-text > * { animation: chunkIn var(--fade) ease-out; }
@keyframes chunkIn { from { opacity: 0; transform: translateY(2px); } }
/* 000191: while the viewed run is alive its log's first line shimmers left to right, a paint-only
background-position sweep through a low-alpha accent tint; the class follows the .spin spinner's
liveness signal, and the second reduced-motion rule stops the loop */
#m-log-text > .pulse { background-image: linear-gradient(90deg, transparent, color-mix(in srgb, var(--link) 14%, transparent) 50%, transparent); background-size: 300% 100%; background-repeat: no-repeat; animation: chunkIn var(--fade) ease-out, shimmer var(--pulse) linear infinite; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
#modal { position: fixed; inset: 0; z-index: 3; background: var(--overlay); display: flex; align-items: center; justify-content: center; }
#modal.hidden { display: none; }
/* 000191: the overlay fades and the panel rises slightly on open; entrance only, and the refresh
never replays it (the class list is untouched while the card stays open) */
#modal:not(.hidden) { animation: fadeIn var(--enter) ease-out; }
#modal:not(.hidden) #m-box { animation: boxIn var(--enter) ease-out; }
@keyframes fadeIn { from { opacity: 0; } }
@keyframes boxIn { from { opacity: 0; transform: translateY(6px) scale(.985); } }
/* 000191: reduced motion stops the entrance, chunk and pulse animations too; the rule sits
after every base animation rule so the later equal-specificity selectors cannot override it */
@media (prefers-reduced-motion: reduce) { .card.enter, .agent-card.enter, #modal:not(.hidden), #modal:not(.hidden) #m-box, #m-log:not(.hidden), #m-log-text > *, #m-log-text > .pulse { animation: none; } }
#m-box { background: var(--panel); border-radius: 10px; padding: 18px; width: min(760px, calc(100vw - 32px)); max-height: 82vh; overflow: auto; }
#m-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
#m-head h2 { font-size: 15px; margin: 0; }
#m-close { border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
#m-close:hover { background: var(--hover); }
#m-attrs { font-size: 12px; color: var(--soft); margin-bottom: 12px; }
#m-attrs div { padding: 3px 0; }
#m-attrs span:not(.chip):not(.num-link) { display: inline-block; min-width: 80px; color: var(--faint); }
#m-body { font-size: 13px; line-height: 1.5; }
#m-body h1, #m-body h2, #m-body h3 { font-size: 13px; margin: 12px 0 4px; }
#m-body ul { margin: 4px 0; padding-left: 20px; }
#m-body pre { background: var(--code-bg); border-radius: 6px; padding: 8px 10px; overflow: auto; font-size: 12px; }
#m-body code { background: var(--code-bg); border-radius: 4px; padding: 0 4px; font-size: 12px; }
#m-body pre code { padding: 0; background: none; }
/* 000153: only inline and fenced code render monospace; the Thinking prose and the tool args/output pres are not code, so the bare #m-log-text pre stays outside this selector and inherits the Inter page font */
#m-log-text code, #m-log-text pre code, #m-body code, #m-body pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
#m-body a { color: var(--link); }
/* one accent color per column, in pipeline order */
.c-backlog { --ac: #94a3b8; }
.c-to-do { --ac: #60a5fa; }
.c-doing { --ac: #818cf8; }
.c-to-review { --ac: #f59e0b; }
.c-reviewing { --ac: #d97706; }
.c-to-merge { --ac: #d946ef; }
.c-merging { --ac: #c026d3; }
.c-to-live-test { --ac: #14b8a6; }
.c-live-testing { --ac: #0d9488; }
.c-done { --ac: #22c55e; }
</style>
</head>
<body>
<header><h1>Software Engineering LLM Team</h1><span id="updated"></span><button id="theme" onclick="toggleTheme()">Dark</button></header>
<nav id="tabs"></nav>
<main id="board"></main>
<footer id="hub"></footer>
<div id="modal" class="hidden"><div id="m-box">
<div id="m-head"><h2 id="m-title"></h2><button id="m-close" onclick="closeModal()">Close</button></div>
<div id="m-attrs"></div>
<div id="m-agent"><div id="m-agent-btns"></div><div id="m-log-meta" class="hidden"></div><div id="m-log" class="hidden"><div id="m-log-text"></div></div></div>
<div id="m-body"></div>
</div></div>
<script>
"use strict";
const VISIBLE = 5;
let projects = [{ id: "", label: "" }]; // one tab per registered project; id "" is the single-project ui, one board, no tabs
let active = ""; // the active tab's id: a registry root, or "" for the single-project board
const boards = Object.create(null);
const esc = ${esc};
const rootEl = document.documentElement;
const storeTheme = t => { try { localStorage.setItem("theme", t); } catch {} };
function syncThemeBtn() { document.getElementById("theme").textContent = (rootEl.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "Light" : "Dark"; }
function toggleTheme() {
	const next = (rootEl.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "light" : "dark";
	rootEl.dataset.theme = next;
	storeTheme(next);
	syncThemeBtn();
}
try { const stored = localStorage.getItem("theme"); if (stored === "dark" || stored === "light") rootEl.dataset.theme = stored; } catch {}
syncThemeBtn();
const inline = ${inline};
${md}
// FLIP across a refresh: measure old positions, sync the cards, invert, play. Every card whose
// board-content position changed moves, the siblings shifting when a card enters or leaves a
// column included; positions are board-content relative, so a scrolled refresh animates nothing.
${flipDiff}
${curve}
${relationPaths}
// board layout and the card pass, interpolated as source so the client runs the tested code;
// constants go in as values, the functions as source
const LAYOUT = ${JSON.stringify(LAYOUT)};
const PRIORITY_RANK = ${JSON.stringify(PRIORITY_RANK)};
${spinnerHtml}
${numLinkHtml}
${cardBaseHtml}
${cardHtml}
${buildShell}
${syncBoard}
${logFixups}
${tabNames}
${tabsHtml}
${boardOf}
${mergeBoards}
${agentLabel}
${fmtTokens}
${fmtDur}
${agentStatsText}
${taskStats}
${taskStatsText}
${agentRowSig}
${syncAgentStats}
${syncCardStats}
${refreshMs}
// tabs: one per registered project, the active one renders that project's board
function renderTabs() {
	const el = document.getElementById("tabs");
	const html = tabsHtml(projects, active);
	if (el.innerHTML !== html) el.innerHTML = html;
	for (const b of el.querySelectorAll(".tab")) b.onclick = () => switchTab(b.dataset.project);
}
function switchTab(name) {
	if (name === active) return;
	active = name;
	closeModal();
	render(true); // no FLIP across boards: positions belong to the project just left
}
function activeBoard() { return boardOf(boards, active); }
// fold choice keyed by state name, so the 5 s refresh keeps it
function toggleCol(st) { const b = activeBoard(); if (b.expanded.has(st)) b.expanded.delete(st); else b.expanded.add(st); render(); }
// one element per task file, kept across refreshes: an unchanged card keeps its node, so its
// spinner animation and in-flight FLIP transform are never restarted
const cardEls = new Map();
let cols = null;
function makeCard(file) {
	const el = document.createElement("div");
	el.className = "card";
	el.dataset.file = file;
	el.onclick = () => openTask(file);
	el.onmouseenter = () => hotRelations(file, true);
	el.onmouseleave = () => hotRelations(file, false);
	// 000191: the entrance class is one-shot, dropped on animationend so a later poll or reorder
	// never replays it
	el.onanimationend = () => { el.classList.remove("enter"); el.onanimationend = null; };
	return el;
}
// board-content relative: page scroll cancels, board scroll is added back, so a refresh after
// scrolling measures identical positions and animates nothing; w/h feed the relation geometry
function cardBox(el) {
	const board = document.getElementById("board");
	const boardRect = board.getBoundingClientRect();
	const r = el.getBoundingClientRect();
	return { x: r.left - boardRect.left + board.scrollLeft, y: r.top - boardRect.top + board.scrollTop, w: r.width, h: r.height };
}
// hovering a card raises the opacity of the lines it connects to, in and out, mouseleave reverts
// (000127, 000144); the paths carry both endpoint files as data, so the match needs no selector
// interpolation
function hotRelations(file, on) {
	for (const p of document.querySelectorAll("#relations path")) {
		if (p.dataset.file === file || p.dataset.blocker === file) p.classList.toggle("relations-hot", on);
	}
}
// one dashed curve per drawn relation, sized to the rendered card extent (+ the loop bulge);
// rewritten only on change, so the dash animation keeps running across refreshes
function drawRelations() {
	const board = document.getElementById("board");
	const svg = document.getElementById("relations");
	if (!svg || !cols) return;
	let w = 0, h = 0;
	const rectOf = file => {
		const el = cardEls.get(file);
		if (!el) return null;
		const r = cardBox(el);
		w = Math.max(w, r.x + r.w);
		h = Math.max(h, r.y + r.h);
		return r;
	};
	const paths = relationPaths(activeBoard().tasks, rectOf);
	svg.setAttribute("width", w + 40);
	svg.setAttribute("height", h);
	const html = paths.map(p => '<path d="' + p.d + '" data-file="' + esc(p.file) + '" data-blocker="' + esc(p.blocker) + '"/>').join("");
	if (svg.__html !== html) { svg.innerHTML = html; svg.__html = html; }
}
function render(skipFlip) {
	renderTabs();
	const tab = activeBoard();
	const board = document.getElementById("board");
	if (!cols) {
		cols = buildShell(board, document);
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.id = "relations";
		svg.setAttribute("pointer-events", "none");
		board.insertBefore(svg, board.firstChild);
		for (const st in cols) cols[st].toggle.onclick = () => toggleCol(st);
		window.addEventListener("resize", drawRelations);
	}
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const old = {};
	if (!skipFlip) for (const el of cardEls.values()) {
		el.style.transition = "none";
		el.style.transform = "";
		old[el.dataset.file] = cardBox(el);
	}
	syncBoard(cols, tab.tasks, tab.expanded, cardEls, makeCard, VISIBLE, document);
	const now = {};
	for (const el of cardEls.values()) now[el.dataset.file] = cardBox(el);
	const diff = flipDiff(old, now);
	drawRelations(); // settled positions; transitionend redraws after a FLIP settles
	for (const el of cardEls.values()) {
		const d = diff[el.dataset.file];
		if (!d || reduced) continue;
		el.style.transition = "none";
		el.style.transform = "translate(" + d.dx + "px," + d.dy + "px)";
		el.getBoundingClientRect();
		el.style.transition = "transform .4s ease";
		el.style.transform = "";
		el.ontransitionend = () => { el.style.transition = ""; el.ontransitionend = null; drawRelations(); };
	}
}
// the title and attrs block: stateless markup, rewritten freely on open and on every refresh
function writeHead(t) {
	document.getElementById("m-title").textContent = t.name;
	document.getElementById("m-attrs").innerHTML = attrsHtml(t);
	for (const a of document.querySelectorAll("#m-attrs .num-link")) a.onclick = () => openTask(a.dataset.task);
}
// the attrs rows, shared by openTask and the 5 s refresh of the open card
function attrsHtml(t) {
	return "<div><span>number</span>" + numLinkHtml(t.file) + "</div>" +
		"<div><span>file</span>" + esc(t.file) + "</div>" +
		"<div><span>priority</span><span class='chip p-" + esc(t.priority) + "'>" + esc(t.priority) + "</span></div>" +
		"<div><span>complexity</span><span class='chip cx cx-" + esc(t.complexity || "moderate") + "'>" + esc(t.complexity || "moderate") + "</span></div>" +
		"<div><span>state</span>" + esc(t.state) + "</div>" +
		"<div><span>worktree</span>" + (esc(t.worktree) || "&mdash;") + "</div>" +
		"<div><span>issuer</span>" + esc(t.issuer || "user") + "</div>" +
		blockedRow(t);
}
// the body block, html-gated like syncBoard's cards: an unchanged body keeps its DOM node and
// with it the reader's scroll position
function setBody(t) {
	const el = document.getElementById("m-body");
	const html = md(t.body || "");
	if (el.__html === html) return;
	el.innerHTML = html;
	el.__html = html;
}
function openTask(file) {
	const t = activeBoard().tasks.find(x => x.file === file);
	if (!t) return;
	closeLog();
	modalFile = file;
	writeHead(t);
	renderAgent(t);
	setBody(t);
	document.getElementById("modal").classList.remove("hidden");
}
// the 5 s refresh of the open detail card: every block re-derives from the fresh payload with no
// close/reopen; renderAgent's keep mode moves only the stats lines on an unchanged run set and
// leaves the log pane alone
function updateOpenTask(t) {
	writeHead(t);
	renderAgent(t, true);
	setBody(t);
}
function closeModal() { closeLog(); document.getElementById("modal").classList.add("hidden"); }
// the blockedBy row: each stored ref links to its task's card when that task is on the board, and
// the row is dropped when the attribute is absent or empty
function blockedRow(t) {
	const refs = String(t.blockedBy || "").split(",").map(s => s.trim()).filter(Boolean);
	if (!refs.length) return "";
	const items = refs.map(ref => {
		const target = activeBoard().tasks.find(x => parseInt(x.file, 10) === parseInt(ref.replace(/^#/, ""), 10));
		return target ? numLinkHtml(target.file) : esc(ref);
	});
	return "<div><span>blockedBy</span>" + items.join(", ") + "</div>";
}
// live agent log pane: each run card carries only its handle, the server resolves the real
// path; each run's subagent transcripts load through the same endpoint with sub=list / sub=n
let modalFile = null;
let agentGen = 0; // bumped per renderAgent: a superseded open's sub fetches must not write
let logTimer = null;
let logState = null;
const logPane = () => document.getElementById("m-log");
const projectParam = () => (active ? "&project=" + encodeURIComponent(active) : "");
const logUrl = extra => "?file=" + encodeURIComponent(logState.handle) + (logState.sub == null ? "" : "&sub=" + logState.sub) + extra + projectParam();
function markActiveAgent() {
	const p = logPane();
	const st = logState && p && !p.classList.contains("hidden") ? logState : null;
	for (const b of document.querySelectorAll("#m-agent .agent-card")) {
		const active = !!st && b.dataset.handle === st.handle && (b.dataset.sub || null) === (st.sub == null ? null : String(st.sub));
		b.classList.toggle("agent-card-active", active);
	}
}
// 000191: while the viewed run is alive its log's first line carries the pulse shimmer; the same
// liveness signal the .spin spinner reads, dropped as soon as the run or the view changes
function markLiveLine() {
	const t = activeBoard().tasks.find(x => x.file === modalFile);
	const run = t && (t.agents || []).find(a => a.alive);
	const p = logPane();
	const on = !!run && !!logState && run.handle === logState.handle && !p.classList.contains("hidden");
	// the pulse stays on the first line only: a history back-fill inserts older lines above it,
	// and a demoted line must not keep the shimmer
	const first = document.querySelector("#m-log-text > *");
	for (const el of document.querySelectorAll("#m-log-text > .pulse")) el.classList.toggle("pulse", on && el === first);
}
const atBottom = () => { const p = logPane(); return p.scrollTop + p.clientHeight >= p.scrollHeight - 4; };
// the live auto-scroll glides to the bottom, an instant auto scroll under reduced motion
function glide(p) {
	const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
	p.scrollTo({ top: p.scrollHeight, behavior: behavior });
}
// the rendered chunk lands in the pane first, then logFixups runs the cross-chunk fixes over it
function ingest(html, where) {
	const el = document.getElementById("m-log-text");
	if (where === "init") el.innerHTML = html;
	else el.insertAdjacentHTML(where === "history" ? "afterbegin" : "beforeend", html);
	logFixups(el, document);
}
// one agent card: the role label, then a tokens/duration stats line (42k · 5m 12s); mark is the
// live spinner or the past check, empty on a sub card
function agentCardHtml(extraCls, attrs, label, tokens, duration, mark) {
	const stats = agentStatsText(tokens, duration);
	return '<button class="agent-card' + (extraCls ? " " + extraCls : "") + '" ' + attrs + ">" + mark + esc(label) + (stats ? '<span class="agent-stats">' + esc(stats) + "</span>" : "") + "</button>";
}
// the agent history as one horizontal row of columns: every run a card with its subagent cards
// stacked below, always visible (fetched for every run on open), oldest leftmost (payload order
// is log mtime order), the live run rightmost; a role with several runs labels them 1-based.
// keep=true is the poll refresh of the open card: an unchanged run set moves only the stats lines
// (syncAgentStats), so the live run's spinner animation survives the poll; a structure change
// rebuilds the row, each run's fetched sub box carried over by handle, and only the live run's
// sub list re-fetched; the log pane beside the row is untouched
function renderAgent(t, keep) {
	const el = document.getElementById("m-agent-btns");
	const runs = (t.agents || []).slice();
	const live = runs.find(a => a.alive);
	if (live) { runs.splice(runs.indexOf(live), 1); runs.push(live); }
	if (!runs.length) { el.innerHTML = ""; el.__sig = ""; return; }
	// the run set is the row's structure: role, run, aliveness, status, handle. Unchanged, the
	// stats lines update in place and the live run's spinner keeps spinning across the poll
	if (keep && syncAgentStats(el, runs, document)) {
		if (live) fetchSubs(agentGen, live, el.querySelector(".agent-col:last-child > .agent-subs"));
		return;
	}
	el.__sig = agentRowSig(runs);
	const oldSubs = keep ? new Map() : null;
	if (oldSubs) for (const c of el.querySelectorAll(".agent-col > .agent-card")) oldSubs.set(c.dataset.handle, c.parentElement.querySelector(".agent-subs"));
	const count = {};
	for (const a of runs) count[a.role] = (count[a.role] || 0) + 1;
	el.innerHTML = runs.map(a =>
		'<div class="agent-col">' +
		agentCardHtml(a.alive ? "agent-live" : a.status === "dead" ? "agent-dead" : "agent-past", 'data-handle="' + esc(a.handle) + '"', agentLabel(a, count), a.tokens, a.duration, a.alive ? '<span class="spin"></span>' : a.status === "dead" ? '<span class="cross">✗</span>' : '<span class="check">✓</span>') +
		'<div class="agent-subs"></div></div>').join("");
	// bind by dataset: a hand-written task file name can hold quotes or backslashes, which no
	// amount of HTML escaping makes safe inside inline JS; 000191: only a genuinely new run's
	// card animates in, the rebuilt old cards stay still
	for (const b of el.querySelectorAll(".agent-col > .agent-card")) {
		b.onclick = () => openAgentLog(b.dataset.handle);
		if (oldSubs && !oldSubs.has(b.dataset.handle)) b.classList.add("enter");
	}
	if (oldSubs) for (const c of el.querySelectorAll(".agent-col")) {
		const box = oldSubs.get(c.querySelector(".agent-col > .agent-card").dataset.handle);
		if (box) c.querySelector(".agent-subs").replaceWith(box);
	}
	markActiveAgent();
	// the live run is the last column, so its sub list is the one re-fetched: a sub spawned after
	// the card was opened surfaces without re-opening, past runs' lists are never re-fetched
	if (keep) {
		if (live) fetchSubs(agentGen, live, el.querySelector(".agent-col:last-child > .agent-subs"));
		return;
	}
	// every run's subs on open, in parallel: one sub=list fetch per run handle, each list rendered
	// under its caller column
	const gen = ++agentGen;
	const boxes = el.querySelectorAll(".agent-subs");
	runs.forEach((a, i) => fetchSubs(gen, a, boxes[i]));
}
// one run's subagent cards, labeled Sub-<caller role> without the id string, one per background
// Agent call in log order
function fetchSubs(gen, a, box) {
	fetch("/api/agent-log?file=" + encodeURIComponent(a.handle) + "&sub=list" + projectParam()).then(r => r.ok ? r.json() : []).then(list => {
		// a superseded open must not write into the new view
		if (gen !== agentGen || !box) return;
		const html = (Array.isArray(list) ? list : []).map(s =>
			agentCardHtml("agent-sub", 'data-handle="' + esc(a.handle) + '" data-sub="' + s.index + '"', "Sub-" + a.role, s.tokens, s.duration, "")).join("");
		// html-gated: the keep pass re-fetches the live run's list every second, so an unchanged
		// list never rebuilds and the sub cards' entrance never replays; only a new sub animates
		if (box.__html === html) return;
		const prev = box.__html === undefined ? null : new Set([...box.querySelectorAll(".agent-card")].map((c) => c.dataset.sub));
		box.innerHTML = html;
		box.__html = html;
		for (const b of box.querySelectorAll(".agent-card")) {
			b.onclick = () => openSubLog(b.dataset.handle, Number(b.dataset.sub));
			if (prev && !prev.has(b.dataset.sub)) {
				// same one-shot drop as makeCard: a row rebuild re-attaches the carried-over sub
				// boxes, and a lingering enter class would replay their entrance then
				b.classList.add("enter");
				b.onanimationend = () => { b.classList.remove("enter"); b.onanimationend = null; };
			}
		}
		markActiveAgent();
	}).catch(() => {});
}
function openAgentLog(handle) {
	if (logState && logState.handle === handle && logState.sub == null && !logPane().classList.contains("hidden")) { closeLog(); return; }
	openLog(handle, null);
}
function openSubLog(handle, n) {
	if (logState && logState.handle === handle && logState.sub === n && !logPane().classList.contains("hidden")) { closeLog(); return; }
	if (handle) openLog(handle, n);
}
function openLog(handle, sub) {
	const t = activeBoard().tasks.find(x => x.file === modalFile);
	const p = logPane();
	if (!t || !p) return;
	p.classList.remove("hidden");
	// the previous view's meta line must not flash before the init payload arrives
	const meta = document.getElementById("m-log-meta");
	if (meta) { meta.textContent = ""; meta.classList.add("hidden"); }
	logState = { handle, sub: sub == null ? null : sub, head: 0, tail: 0, atStart: false, busy: false, idle: false };
	markActiveAgent();
	pullLog(logUrl(""), "init");
	if (logTimer) clearInterval(logTimer);
	logTimer = setInterval(pollLog, 1000);
}
function closeLog() {
	if (logTimer) { clearInterval(logTimer); logTimer = null; }
	logState = null;
	const p = logPane();
	if (p) p.classList.add("hidden");
	// 000154: the meta line is a sibling above the pane now, so it must hide itself on close
	const meta = document.getElementById("m-log-meta");
	if (meta) { meta.textContent = ""; meta.classList.add("hidden"); }
	markActiveAgent();
	markLiveLine();
}
function pollLog() {
	if (!logState || logState.busy) return;
	const t = activeBoard().tasks.find(x => x.file === modalFile);
	const liveRun = t && (t.agents || []).find(a => a.alive);
	// logState carries the parent run's handle for a sub view too, so run aliveness keeps both the
	// run's own log and its sub transcripts polling while the run is alive
	const live = !!liveRun && liveRun.handle === logState.handle;
	// past agents write no lines: one empty poll is proof, stop the timer
	if (!live && logState.idle) {
		if (logTimer) { clearInterval(logTimer); logTimer = null; }
		return;
	}
	const p = logPane();
	// a scroll-to-top can land in a busy poll window and never re-fire; the tick retries history
	if (p && p.scrollTop === 0 && !logState.atStart) {
		pullLog(logUrl("&offset=" + logState.head + "&before=1"), "history");
		return;
	}
	pullLog(logUrl("&offset=" + logState.tail), "poll");
}
function pullLog(qs, mode) {
	const st = logState;
	if (!st) return;
	st.busy = true;
	const p = logPane();
	fetch("/api/agent-log" + qs).then(r => r.ok ? r.json() : null).then(d => {
		// a superseded open must not write into the new view
		if (!d || logState !== st || !p || p.classList.contains("hidden")) return;
		// 000146: the meta line above the log, model name and thinking level of the latest
		// usage-bearing record; nulls hide it, every payload mode refreshes it
		const meta = document.getElementById("m-log-meta");
		const label = d.model ? d.model + (d.thinkingLevel ? " \u00b7 thinking " + d.thinkingLevel : "") : "";
		if (meta) { meta.textContent = label; meta.classList.toggle("hidden", !label); }
		const el = document.getElementById("m-log-text");
		if (mode === "history") {
			st.head = d.head;
			st.atStart = d.atStart;
			if (d.text) {
				const before = p.scrollHeight;
				ingest(d.text, "history");
				p.scrollTop += p.scrollHeight - before;
			}
		} else {
			st.tail = d.tail;
			if (mode === "poll") st.idle = !d.text;
			if (mode === "init") {
				st.head = d.head;
				st.atStart = d.atStart;
				ingest(d.text, "init");
				glide(p);
			} else if (d.text) {
				const stick = atBottom();
				ingest(d.text, "poll");
				if (stick) glide(p);
			}
		}
		markLiveLine();
	}).catch(() => {}).finally(() => { if (logState === st) st.busy = false; });
}
document.getElementById("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
// the log pane is static markup: the scroll handler binds once and reads the live logState
const pane = logPane();
pane.onscroll = () => {
	if (!logState || logState.busy || logState.atStart || pane.scrollTop > 0) return;
	pullLog(logUrl("&offset=" + logState.head + "&before=1"), "history");
};
// the serving hub's identity (000165): pid, code checkout and commit; null keeps the last text
function renderHub(info) {
	const el = document.getElementById("hub");
	if (!el || !info) return;
	const text = info.old ? "hub: old hub code (restart needed)" : "hub pid " + info.pid + " \u00b7 " + info.root + (info.commit ? " \u00b7 " + info.commit.slice(0, 7) : "");
	if (el.textContent !== text) el.textContent = text;
}
function refresh() {
	// the serving hub's identity in the footer (000165): a stale-code hub or a failover shows
	// at a glance; a 404 means old hub code that predates the endpoint (a webui hot reload mix)
	fetch("/api/hub").then(r => r.status === 404 ? { old: true } : r.ok ? r.json() : null).catch(() => null).then(renderHub);
	fetch("/api/projects").then(r => r.ok ? r.json() : null).catch(() => null).then(list => {
		// the single-project server 404s here, and a transient hub failure keeps the last known
		// tabs: only a real projects list replaces them
		if (Array.isArray(list)) {
			const tabs = tabNames(list);
			projects = tabs.length ? tabs : [{ id: "", label: "" }]; // single project: the old ui, one board, no tabs
		}
		// a project that vanished from the registry closes the modal its task lived in
		if (!projects.some(t => t.id === active)) { active = projects[0].id; closeModal(); }
		const url = t => t.id ? "/api/tasks?project=" + encodeURIComponent(t.id) : "/api/tasks";
		// every tab polls every cycle, only the active one renders
		return Promise.all(projects.map(t => fetch(url(t)).then(r => r.ok ? r.json() : null).catch(() => null).then(tasks => [t.id, tasks])));
	}).then(rows => {
		mergeBoards(boards, rows);
		render();
		// the open detail card re-derives from the fresh payload: a state change or a new agent run
		// shows in place, and a task gone from the board closes the card
		let open = null;
		if (modalFile && !document.getElementById("modal").classList.contains("hidden")) {
			open = activeBoard().tasks.find(x => x.file === modalFile);
			if (open) updateOpenTask(open); else closeModal();
		}
		// stamp only a served board: during a hub outage the old stamp stays visible
		const current = rows.find(([id]) => id === active);
		if (current && current[1]) document.getElementById("updated").textContent = "updated " + new Date().toLocaleTimeString();
		// the next tick keys on the fresh open card (000142): while it shows a live agent the stats
		// advance at log speed, so the cadence is 1 s; no live agent keeps the 5 s board poll
		setTimeout(refresh, refreshMs(open));
	}).catch(() => setTimeout(refresh, 5000)); // a failed cycle retries at the board cadence
}
refresh();
</script>
</body>
</html>
`;
