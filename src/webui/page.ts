import { PRIORITY_RANK } from "../kanban.ts";
import { readConfigFiles, type StageFlags } from "../orchestrator/config.ts";
export type { StageFlags };
import { esc, inline, logFixups, md } from "./logpane.ts";
import { agentLabel, agentStatsText, applyCardStats, applyStages, buildShell, cardBaseHtml, curve, flipDiff, fmtDur, fmtTokens, isHeld, makeStatsQueue, mergeCardStats, numLinkHtml, priorityRuler, relationPaths, sortStation, spinnerHtml, statsKey, STATIONS, syncBoard, syncCardStats, taskStats } from "./board.ts";
import { ARCHIVE_PAGE, archivePage, archiveTasks, decodeFilters, emptyFilters, encodeFilters, FILTER_COMPLEXITIES, FILTER_DEBOUNCE, FILTER_PRIORITIES, FILTERS_KEY, filterReason, filterTasks, filtersActive, matchesFilters, PALETTE_MAX, paletteResults, PHASES } from "./filters.ts";
import { CSS } from "./theme.ts";

// the served page: PAGE interpolates the tested renderers and helpers as client source; the
// webui config loader and the per-tab client state helpers live here too
const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 4242;

export interface WebUiConfig {
	enabled: boolean;
	host: string;
	port: number;
}

export const DEFAULT_STAGES: StageFlags = { reviews: true, liveTesting: true, integrationTesting: true };

// project root se-llm-team.json overrides ~/.se-llm-team/config.json, nested objects are
// merged deeply; a missing file, invalid JSON or absent keys mean off
export function loadWebUiConfig(root?: string): WebUiConfig {
	const webUi = readConfigFiles(root).webUi as { enabled?: boolean; host?: string; port?: number } | undefined;
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
		...(p.stages ? { stages: p.stages } : {}),
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

// the open detail card's poll cadence (000142): a live agent's or live doctor's tokens and
// duration advance with the run log, so while the open task has one the poll ticks at 1 s;
// otherwise the 5 s board poll
export function refreshMs(t) {
	return t && ((t.agents || []).some((a) => a.alive) || (t.doctors || []).some((d) => d.alive)) ? 1000 : 5000;
}

// served by the single-project server and by the hub for every registered project; the tab bar
// comes from the hub's /api/projects and each tab polls /api/tasks?project=<root id>
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Software Engineering LLM Team</title>
<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/space-grotesk-500.woff2">
<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/ibm-plex-mono-400.woff2">
<style>
${CSS}</style>
</head>
<body>
<header><h1>Software Engineering LLM Team</h1><span id="updated"></span><button id="theme" onclick="toggleTheme()">Dark</button></header>
<nav id="tabs"></nav>
<div id="filters" aria-label="Filter tasks">
<input id="f-q" type="text" placeholder="filter: text or #num  (/)" aria-label="Filter by text or number" autocomplete="off">
<div id="f-phases" role="group" aria-label="Station"></div>
<select id="f-prio" multiple size="1" aria-label="Priority"></select>
<select id="f-cx" multiple size="1" aria-label="Complexity"></select>
<select id="f-issuer" aria-label="Issuer"></select>
<button id="f-held" class="f-chip" aria-pressed="false">held</button>
<button id="f-live" class="f-chip" aria-pressed="false">live</button>
<button id="f-clear" class="f-chip" hidden>clear</button>
</div>
<main id="board"></main>
<section id="archive" class="hidden" aria-label="Done archive">
<div class="arch-head"><span>Done</span><span id="arch-count"></span><button id="arch-back" class="m-action" onclick="backToBoard()">Board</button></div>
<div id="arch-list"></div>
<div id="arch-empty" class="empty"></div>
<div id="arch-foot"><button id="arch-newer" class="m-action" hidden onclick="archNewer()">newer</button><span id="arch-page"></span><button id="arch-more" class="m-action" hidden onclick="loadOlder()">+50 older</button></div>
</section>
<footer id="hub"></footer>
<aside id="panel" class="hidden" aria-label="Task detail">
<div id="p-head"><h2 id="p-title" tabindex="-1"></h2><button id="p-close" onclick="closePanel()">Close</button></div>
<div id="p-outside" class="hidden"></div>
<div id="p-facts"></div>
<div id="p-prio-wrap"><span class="k">priority</span><div id="p-prio" role="group" aria-label="Priority"></div><div id="p-prio-err" role="status"></div></div>
<div id="p-actions"></div>
<div id="p-runs"></div>
<div id="p-body"></div>
<div id="p-history"></div>
</aside>
<section id="console" class="hidden" aria-label="Agent log">
<div id="c-handle" role="separator" tabindex="0" aria-label="Resize the log console" aria-orientation="horizontal" aria-valuemin="120" aria-valuenow="240"></div>
<div id="c-head"><span id="c-title"></span><span id="c-state"></span><span id="c-tokens"></span><button id="c-close" onclick="closeConsole()">Close</button></div>
<div id="c-meta" class="hidden"></div>
<div id="c-log"><div id="c-text"></div></div>
</section>
<div id="palette" class="hidden" role="dialog" aria-modal="true" aria-label="Find a task">
<div id="pal-box">
<input id="pal-input" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" placeholder="find a task: number, name or summary" autocomplete="off">
<div id="pal-list" role="listbox" aria-label="Tasks"></div>
<div id="pal-empty" class="hidden" role="status"></div>
<div id="pal-more" class="hidden"></div>
</div>
</div>
<script>
"use strict";
const VISIBLE = 5;
const DEFAULT_STAGES = ${JSON.stringify(DEFAULT_STAGES)};
let projects = [{ id: "", label: "", stages: DEFAULT_STAGES }]; // one tab per registered project; id "" is the single-project ui, one board, no tabs
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
// station included; positions are board-content relative, so a scrolled refresh animates nothing.
${flipDiff}
${curve}
${relationPaths}
// board layout and the card pass, interpolated as source so the client runs the tested code;
// constants go in as values, the functions as source
const STATIONS = ${JSON.stringify(STATIONS)};
const PRIORITY_RANK = ${JSON.stringify(PRIORITY_RANK)};
${spinnerHtml}
${numLinkHtml}
${priorityRuler}
${isHeld}
${cardBaseHtml}
${buildShell}
${applyStages}
${sortStation}
${syncBoard}
${logFixups}
${tabNames}
${tabsHtml}
${boardOf}
${mergeBoards}
${agentLabel}
${agentStatsText}
${fmtTokens}
${fmtDur}
${taskStats}
${syncCardStats}
${statsKey}
${applyCardStats}
${mergeCardStats}
${makeStatsQueue}
${refreshMs}
// #368 the filter bar: the URL's ?f=<base64> value is the filter and localStorage holds the last
// used set for a URL that carries none; a corrupt value falls back to no filter
let filters = null, archiveView = false, archPageNo = 0;
let palOpen = false, palSel = 0, palHits = [], palReturn = null, fqTimer = null;
const FILTERS_KEY = ${JSON.stringify(FILTERS_KEY)};
const FILTER_DEBOUNCE = ${FILTER_DEBOUNCE};
const PALETTE_MAX = ${PALETTE_MAX};
const ARCHIVE_PAGE = ${ARCHIVE_PAGE};
const PHASES = ${JSON.stringify(PHASES)};
const FILTER_PRIORITIES = ${JSON.stringify(FILTER_PRIORITIES)};
const FILTER_COMPLEXITIES = ${JSON.stringify(FILTER_COMPLEXITIES)};
${emptyFilters}
${encodeFilters}
${decodeFilters}
${filtersActive}
${matchesFilters}
${filterTasks}
${filterReason}
${paletteResults}
${archiveTasks}
${archivePage}
filters = initialFilters();
function initialFilters() {
	const qs = new URLSearchParams(location.search);
	let raw = qs.get("f");
	if (!qs.has("f")) { try { raw = localStorage.getItem(FILTERS_KEY); } catch {} }
	return decodeFilters(raw);
}
function applyFilters() {
	saveFilters();
	render();
	const t = openDetail || (panelFile ? activeBoard().tasks.find(x => x.file === panelFile) : null);
	if (t) writeOutside(t);
}
function saveFilters() {
	const enc = encodeFilters(filters);
	try { history.replaceState(null, "", (filtersActive(filters) ? "?f=" + enc : "") + location.hash); } catch {}
	try { localStorage.setItem(FILTERS_KEY, enc); } catch {}
}
function clearFilters() { filters = emptyFilters(); applyFilters(); }
function clearQuery() { filters.q = ""; const el = document.getElementById("f-q"); if (el) el.value = ""; applyFilters(); }
// the panel's notice when a palette or archive click lands on a task the active filter hides: it
// names the filter and offers the one click that shows the task, the filter itself stays
function writeOutside(t) {
	const el = document.getElementById("p-outside");
	if (!el) return;
	const outside = filtersActive(filters) && !matchesFilters(t, filters);
	if (writeGated(el, outside ? '<span>outside the active filter</span><button class="m-action" onclick="clearFilters()">show it</button>' : "")) el.classList.toggle("hidden", !outside);
}
function renderFilterBar() {
	const ph = document.getElementById("f-phases");
	if (ph) {
		if (ph.children.length !== STATIONS.length) {
			ph.innerHTML = STATIONS.map(s => '<button class="f-chip" data-phase="' + s.id + '" aria-pressed="false">' + esc(s.label) + "</button>").join("");
			for (const b of ph.children) b.onclick = () => togglePhase(b.dataset.phase);
		}
		for (const b of ph.children) b.setAttribute("aria-pressed", String(filters.phases.includes(b.dataset.phase)));
	}
	const q = document.getElementById("f-q");
	if (q && document.activeElement !== q && q.value !== filters.q) q.value = filters.q;
	fillSelect("f-prio", FILTER_PRIORITIES, filters.priorities);
	fillSelect("f-cx", FILTER_COMPLEXITIES, filters.complexities);
	fillIssuers(activeBoard().tasks);
	const held = document.getElementById("f-held"), liveEl = document.getElementById("f-live");
	if (held) held.setAttribute("aria-pressed", String(filters.held));
	if (liveEl) liveEl.setAttribute("aria-pressed", String(filters.live));
	const clear = document.getElementById("f-clear");
	if (clear) clear.hidden = !filtersActive(filters);
}
function fillSelect(id, values, chosen) {
	const el = document.getElementById(id);
	if (!el) return;
	if (el.children.length !== values.length) el.innerHTML = values.map(v => '<option value="' + v + '">' + v + "</option>").join("");
	for (const o of el.children) o.selected = chosen.includes(o.value);
}
function fillIssuers(tasks) {
	const el = document.getElementById("f-issuer");
	if (!el) return;
	const seen = [];
	for (const t of tasks) { const v = t.issuer || "user"; if (!seen.includes(v)) seen.push(v); }
	if (filters.issuer && !seen.includes(filters.issuer)) seen.push(filters.issuer);
	seen.sort((a, b) => (a[0] === "#") === (b[0] === "#") ? (a[0] === "#" ? parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10) : a.localeCompare(b)) : a[0] === "#" ? 1 : -1);
	const html = '<option value="">any issuer</option>' + seen.map(v => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
	if (writeGated(el, html)) el.value = filters.issuer;
}
function togglePhase(id) {
	const i = filters.phases.indexOf(id);
	if (i < 0) filters.phases.push(id); else filters.phases.splice(i, 1);
	applyFilters();
}
// the palette: a dialog over the chrome, the keyboard walks the capped list and Enter opens the row
function openPalette() {
	if (palOpen) return;
	palOpen = true;
	palSel = 0;
	palReturn = document.activeElement;
	const el = document.getElementById("palette");
	if (el) el.classList.remove("hidden");
	const input = document.getElementById("pal-input");
	if (input) { input.value = ""; input.focus(); }
	renderPalette();
}
function closePalette() {
	if (!palOpen) return;
	palOpen = false;
	const el = document.getElementById("palette");
	if (el) el.classList.add("hidden");
	const back = palReturn;
	palReturn = null;
	if (back && back.focus) back.focus();
}
function renderPalette() {
	const input = document.getElementById("pal-input");
	const res = paletteResults(activeBoard().tasks, input ? input.value : "");
	palHits = res.hits;
	if (palSel >= palHits.length) palSel = Math.max(0, palHits.length - 1);
	const list = document.getElementById("pal-list");
	const html = palHits.map((t, i) => {
		const live = (t.agents || []).find(a => a.alive);
		return '<button class="pal-row" role="option" tabindex="0" id="pal-' + i + '" aria-selected="' + String(i === palSel) + '" data-task="' + esc(t.file) + '">' +
			'<span class="pal-num">#' + String(parseInt(t.file, 10)) + '</span><span class="pal-name">' + esc(t.name || "") + '</span><span class="pal-state">' + esc(t.state || "") + "</span>" +
			(live ? '<span class="pal-live">' + esc(live.role) + "</span>" : "") + "</button>";
	}).join("");
	if (list && writeGated(list, html)) for (const b of list.children) b.onclick = () => openTask(b.dataset.task);
	const empty = document.getElementById("pal-empty");
	if (empty) { const text = palHits.length ? "" : 'no task matches "' + (input ? input.value.trim() : "") + '"'; if (empty.textContent !== text) empty.textContent = text; empty.classList.toggle("hidden", !!palHits.length); }
	const more = document.getElementById("pal-more");
	if (more) { const text = res.more ? "+" + res.more + " more" : ""; if (more.textContent !== text) more.textContent = text; more.classList.toggle("hidden", !res.more); }
}
function setPalSel(i, focus) {
	if (!palHits.length) return;
	palSel = Math.max(0, Math.min(i, palHits.length - 1));
	const list = document.getElementById("pal-list");
	if (!list) return;
	for (let k = 0; k < list.children.length; k++) list.children[k].setAttribute("aria-selected", String(k === palSel));
	const row = list.children[palSel];
	if (focus && row && row.focus) row.focus();
}
function paletteKeydown(e) {
	if (e.key === "Escape") { e.stopPropagation(); return closePalette(); }
	if (e.key === "ArrowDown") { e.preventDefault(); return setPalSel(palSel + 1, true); }
	if (e.key === "ArrowUp") { e.preventDefault(); return setPalSel(palSel - 1, true); }
	if (e.key !== "Enter") return;
	e.preventDefault();
	const t = palHits[palSel];
	if (t) { closePalette(); openTask(t.file); }
}
// the done archive: one window of 50 done tasks, opened from the Done overflow or the #archive hash
const archDate = ms => typeof ms === "number" && ms ? new Date(ms).toLocaleDateString() : "";
function openArchive() { if (location.hash !== "#archive") location.hash = "archive"; }
function backToBoard() { if (location.hash) location.hash = ""; else showView(false); }
function loadOlder() { archPageNo++; renderArchive(); }
function archNewer() { archPageNo = Math.max(0, archPageNo - 1); renderArchive(); }
function showView(archive) {
	if (archive && !archiveView) archPageNo = 0;
	archiveView = archive;
	const b = document.getElementById("board"), a = document.getElementById("archive");
	if (b) b.classList.toggle("hidden", archive);
	if (a) a.classList.toggle("hidden", !archive);
	syncPanelTop();
	if (archive) renderArchive();
}
function renderArchive() {
	const all = activeBoard().tasks;
	const rows = archiveTasks(all, filters);
	const win = archivePage(rows, archPageNo);
	archPageNo = win.page;
	const done = all.filter(t => t.state === "done").length;
	const count = document.getElementById("arch-count");
	if (count) { const text = filtersActive(filters) ? rows.length + " of " + done + " done tasks match" : done + " done tasks"; if (count.textContent !== text) count.textContent = text; }
	const list = document.getElementById("arch-list");
	const html = win.rows.map(t => '<button class="arch-row" data-task="' + esc(t.file) + '"><span class="arch-num">#' + String(parseInt(t.file, 10)) + '</span><span class="arch-name">' + esc(t.name || "") + '</span><span class="arch-date">' + esc(archDate(t.updated)) + "</span></button>").join("");
	if (list && writeGated(list, html)) for (const b of list.children) b.onclick = () => openTask(b.dataset.task);
	const empty = document.getElementById("arch-empty");
	if (empty) { const text = rows.length ? "" : filtersActive(filters) ? filterReason(filters) : "nothing finished yet"; if (empty.textContent !== text) empty.textContent = text; empty.classList.toggle("hidden", !!rows.length); }
	const pageEl = document.getElementById("arch-page");
	if (pageEl) { const text = win.pages > 1 ? "page " + (win.page + 1) + " of " + win.pages + " \u00b7 " + (win.start + 1) + "-" + win.end + " of " + rows.length : ""; if (pageEl.textContent !== text) pageEl.textContent = text; }
	const older = document.getElementById("arch-more");
	if (older) older.hidden = win.page >= win.pages - 1;
	const newer = document.getElementById("arch-newer");
	if (newer) newer.hidden = win.page <= 0;
}
const bind = (id, ev, fn) => { const el = document.getElementById(id); if (el) el[ev] = fn; };
const typingTarget = el => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true);
bind("f-q", "oninput", e => { clearTimeout(fqTimer); fqTimer = setTimeout(() => { filters.q = e.target.value.trim(); applyFilters(); }, FILTER_DEBOUNCE); });
bind("f-prio", "onchange", e => { filters.priorities = [...e.target.selectedOptions].map(o => o.value); applyFilters(); });
bind("f-cx", "onchange", e => { filters.complexities = [...e.target.selectedOptions].map(o => o.value); applyFilters(); });
bind("f-issuer", "onchange", e => { filters.issuer = e.target.value; applyFilters(); });
bind("f-held", "onclick", () => { filters.held = !filters.held; applyFilters(); });
bind("f-live", "onclick", () => { filters.live = !filters.live; applyFilters(); });
bind("f-clear", "onclick", () => clearFilters());
bind("pal-input", "oninput", () => { palSel = 0; renderPalette(); });
bind("palette", "onkeydown", paletteKeydown);
bind("palette", "onmousedown", e => { if (e.target && e.target.id === "palette") closePalette(); });
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
	closePanel();
	render(true); // no FLIP across boards: positions belong to the project just left
}
function activeBoard() { return boardOf(boards, active); }
// fold choice keyed by station id, so the 5 s refresh keeps it
function toggleStation(id) { const b = activeBoard(); if (b.expanded.has(id)) b.expanded.delete(id); else b.expanded.add(id); render(); if (b.expanded.has(id)) queueStats(id); }
// 000271: the lazy stats queue, one file per request in each station's top-to-bottom board order,
// drained off the click/render path; the queue dedupes on the fetched-or-in-flight keys (a
// successful file stays fetched) and skips done cards with known stats. A failed fetch drops its
// key, so the next poll's re-enqueue retries it; each response merges and re-renders
const statsQueue = makeStatsQueue(
	statsKey,
	(project, file) => fetch("/api/card-stats?files=" + encodeURIComponent(file) + (project ? "&project=" + encodeURIComponent(project) : "")).then(r => r.ok ? r.json() : null).catch(() => null),
	(project, stats) => { mergeCardStats(stats, boardOf(boards, project).tasks, statsKnown, localStorage, project); render(); },
);
function queueStats(id) { const b = activeBoard(); statsQueue.enqueueStation(active, b.tasks, STATIONS.find(s => s.id === id), VISIBLE); }
function queueExpanded() { const b = activeBoard(); for (const st of b.expanded) queueStats(st); }
// one element per task file, kept across refreshes: an unchanged card keeps its node, so its
// spinner animation and in-flight FLIP transform are never restarted
const cardEls = new Map();
let stations = null;
// 000264: the lazily-known card stats, keyed per project and task (statsKey)
const statsKnown = Object.create(null);
function makeCard(file) {
	const el = document.createElement("div");
	el.className = "card";
	el.dataset.file = file;
	el.onclick = () => openTask(file);
	// #366: the card is a link in the tab order, so Enter opens the card under the focus ring
	el.tabIndex = 0;
	el.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); openTask(file); } };
	el.onmouseenter = () => hotRelations(file, true);
	el.onmouseleave = () => hotRelations(file, false);
	// 000191: the entrance class is one-shot, dropped on animationend so a later poll or reorder
	// never replays it
	el.onanimationend = () => { el.classList.remove("enter"); el.onanimationend = null; };
	return el;
}
// board-content relative: page scroll cancels, board scroll is added back, so a refresh after
// scrolling measures identical positions and animates nothing; w/h feed the relation geometry.
// #366 a card inside a scrolled station moves with that station's own scroll, so every scroll
// ancestor up to the board adds its offset too
function cardBox(el) {
	const board = document.getElementById("board");
	const boardRect = board.getBoundingClientRect();
	const r = el.getBoundingClientRect();
	let dx = board.scrollLeft, dy = board.scrollTop;
	for (let p = el.parentElement; p && p !== board; p = p.parentElement) { dx += p.scrollLeft; dy += p.scrollTop; }
	return { x: r.left - boardRect.left + dx, y: r.top - boardRect.top + dy, w: r.width, h: r.height };
}
// hovering a card raises the opacity of the lines it connects to, in and out, mouseleave reverts
// (000127, 000144); the paths carry both endpoint files as data, so the match needs no selector
// interpolation
function hotRelations(file, on) {
	for (const p of document.querySelectorAll("#relations path")) {
		if (p.dataset.file === file || p.dataset.blocker === file) p.classList.toggle("relations-hot", on);
	}
}
// one dashed curve per drawn relation, sized to the rendered card extent; the bow paints outside
// that box through overflow: visible, so the overlay adds no scroll width; rewritten only on
// change, so the dash animation keeps running across refreshes
function drawRelations() {
	const board = document.getElementById("board");
	const svg = document.getElementById("relations");
	if (!svg || !stations) return;
	let w = 0, h = 0;
	const rectOf = file => {
		const el = cardEls.get(file);
		if (!el) return null;
		const r = cardBox(el);
		// a card with no box (a collapsed station, a hidden row) has no drawn line either
		if (!r.w || !r.h) return null;
		w = Math.max(w, r.x + r.w);
		h = Math.max(h, r.y + r.h);
		return r;
	};
	const paths = relationPaths(activeBoard().tasks, rectOf);
	svg.setAttribute("width", w);
	svg.setAttribute("height", h);
	const html = paths.map(p => '<path d="' + p.d + '" data-file="' + esc(p.file) + '" data-blocker="' + esc(p.blocker) + '"/>').join("");
	if (svg.__html !== html) { svg.innerHTML = html; svg.__html = html; }
}
function render(skipFlip) {
	renderTabs();
	renderFilterBar();
	const tab = activeBoard();
	const board = document.getElementById("board");
	if (!stations) {
		stations = buildShell(board, document);
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.id = "relations";
		svg.setAttribute("pointer-events", "none");
		board.insertBefore(svg, board.firstChild);
		for (const id in stations) stations[id].toggle.onclick = id === "done" ? openArchive : () => toggleStation(id);
		window.addEventListener("resize", drawRelations);
	}
	const project = projects.find(t => t.id === active);
	applyStages(stations, project?.stages ?? DEFAULT_STAGES);
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const old = {};
	if (!skipFlip) for (const el of cardEls.values()) {
		el.style.transition = "none";
		el.style.transform = "";
		old[el.dataset.file] = cardBox(el);
	}
	// 000264: the lazily-known stats land on the rows before the board pass, so the 5 s poll's
	// agent-less cards 6+ never wipe revealed stats; the payload's eager first-5 agents win
	applyCardStats(tab.tasks, statsKnown, localStorage, active);
	syncBoard(stations, filterTasks(tab.tasks, filters), tab.expanded, cardEls, makeCard, VISIBLE, document, filterReason(filters));
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
	if (archiveView) renderArchive();
}
// the shared animated close: .closing runs the entrance in reverse, the element hides on
// animationend with a fixed-timeout fallback (a background tab never fires the event); a reopen
// drops .closing first, so the late event must not re-hide
function closeAnimated(el) {
	if (el.classList.contains("closing")) return;
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.classList.add("hidden"); return; }
	// 000194: a stale fallback from a cancelled close (the reopen dropped .closing) must not cut the next exit
	clearTimeout(el.__closeTimer);
	el.classList.add("closing");
	const hide = e => {
		if (e && e.target !== el) return; // descendant chunkIn ends bubble up, only the element's own exit ends the hide
		el.removeEventListener("animationend", hide);
		if (!el.classList.contains("closing")) return;
		el.classList.remove("closing");
		el.classList.add("hidden");
	};
	el.addEventListener("animationend", hide);
	el.__closeTimer = setTimeout(hide, 400);
}
// every panel block writes through this gate: an unchanged block keeps its DOM node, so the
// panel's scroll position and the focused control survive the 1 s poll
function writeGated(el, html) {
	if (!el || el.__html === html) return false;
	el.innerHTML = html;
	el.__html = html;
	return true;
}
const numOf = file => parseInt(file.slice(0, 6), 10);
const projectParam = () => (active ? "&project=" + encodeURIComponent(active) : "");
// 000242: the detail url, the num off the file name and the active tab's project for the hub
const detailUrl = file => "/api/task-detail?num=" + numOf(file) + projectParam();
// 000248: the heavy history url, fetched after the detail's text shows
const historyUrl = file => "/api/task-history?num=" + numOf(file) + projectParam();
// a stored "#<num>" ref resolved to its task on the active board: undefined when absent
function taskByNum(ref) {
	return activeBoard().tasks.find(x => numOf(x.file) === parseInt(ref.replace(/^#/, ""), 10));
}
// the blockedBy row: each stored ref links to its task's card when that task is on the board, and
// the row is dropped when the attribute is absent or empty
function blockedRow(t) {
	const refs = String(t.blockedBy || "").split(",").map(s => s.trim()).filter(Boolean);
	if (!refs.length) return "";
	const items = refs.map(ref => {
		const target = taskByNum(ref);
		return target ? numLinkHtml(target.file) : esc(ref);
	});
	return "<div><span class='k'>blockedBy</span>" + items.join(", ") + "</div>";
}
// the issuer row: a task-issued issuer ("#<num>") links to its card when that task is on the
// active board; "user", the orchestrator's "auto", an absent issuer, or an off-board number stays
// plain text (auto never carries an issuer link)
function issuerCell(t) {
	const target = t.issuer && t.issuer !== "user" && t.issuer !== "auto" ? taskByNum(t.issuer) : null;
	return target ? numLinkHtml(target.file) : esc(t.issuer || "user");
}
// the panel header's facts: number, state slug and phase, complexity, issuer, hold and worktree
function factsHtml(t) {
	const station = STATIONS.find(s => s.states.includes(t.state));
	return "<div><span class='k'>number</span>#" + esc(String(numOf(t.file))) + "</div>" +
		"<div><span class='k'>state</span>" + esc(t.state) + (station ? " <span class='sub-state'>" + esc(station.label) + "</span>" : "") + "</div>" +
		"<div><span class='k'>complexity</span><span class='chip cx cx-" + esc(t.complexity || "moderate") + "'>" + esc(t.complexity || "moderate") + "</span></div>" +
		"<div><span class='k'>issuer</span>" + issuerCell(t) + "</div>" +
		(isHeld(t) ? "<div><span class='k'>hold</span><span class='held'>held</span></div>" : "") +
		blockedRow(t) +
		"<div><span class='k'>worktree</span>" + (esc(t.worktree) || "&mdash;") + "</div>";
}
// the actions: block or unblock the user hold, copy the number, copy the worktree or the file path.
// The hold toggle stays outside the rebuilt facts block, so a detail refresh never rebuilds it
function actionsHtml(t) {
	const copy = '<button class="m-action" data-copy="' + esc(String(numOf(t.file))) + '">Copy number</button>' +
		(t.worktree ? '<button class="m-action" data-copy="' + esc(t.worktree) + '">Copy worktree</button>' : '<button class="m-action" data-copy="' + esc(t.file) + '">Copy file</button>');
	if (t.state === "done") return copy;
	if (isHeld(t)) return '<button class="m-action m-unblock" onclick="toggleHold(this)" title="Remove the user hold"><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor"/></svg>Unblock</button>' + copy;
	if (t.state === "merging") return copy;
	return '<button class="m-action m-block" onclick="toggleHold(this)" title="Hold this task and stop its agent"><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>Block</button>' + copy;
}
// the detail poll redraws the row from the file once the hold lands; a failure keeps the button
// usable and names the error in the header's status line
function toggleHold(btn) {
	const action = btn.classList.contains("m-unblock") ? "unblock" : "block";
	btn.disabled = true;
	fetch("/api/task-block?num=" + numOf(panelFile) + projectParam(), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action })
	}).then(r => r.json().then(b => r.ok ? b : Promise.reject(b)))
		.then(() => pollDetail())
		.catch(e => {
			document.getElementById("updated").textContent = "block failed: " + ((e && e.error) || "request failed");
			btn.disabled = false;
		});
}
// copies through the clipboard api; the button's own label carries the feedback
function copyText(btn) {
	const label = btn.textContent;
	const done = ok => { btn.textContent = ok ? "Copied" : "Copy failed"; setTimeout(() => { btn.textContent = label; }, 1200); };
	if (navigator.clipboard) navigator.clipboard.writeText(btn.dataset.copy).then(() => done(true), () => done(false));
	else done(false);
}
const PRIOS = ["low", "medium", "high", "critical"];
// the optimistic priority: the control shows the chosen value at once, a non-200 reverts it, and a
// poll that lands while the write is in flight never clobbers it. The write clears the value once
// a fresh detail agrees with it, so a poll that started before the write cannot revert it either
let prioWant = null;
const prioValue = t => prioWant ?? t.priority;
function writePriority(t) {
	if (prioWant && t.priority === prioWant) prioWant = null;
	const el = document.getElementById("p-prio");
	if (!el) return;
	if (el.children.length !== PRIOS.length) {
		el.innerHTML = PRIOS.map(p => '<button class="seg p-' + p + '" data-p="' + p + '">' + p + "</button>").join("");
		for (const b of el.querySelectorAll(".seg")) b.onclick = () => setPriority(b.dataset.p);
		el.__html = "";
	}
	const value = prioValue(t);
	for (const b of el.children) b.setAttribute("aria-pressed", String(b.dataset.p === value));
}
function clearPriority() {
	const el = document.getElementById("p-prio");
	if (!el) return;
	el.innerHTML = "";
	el.__html = "";
}
function setPriority(p) {
	const t = openDetail;
	if (!t || p === prioValue(t)) return;
	prioWant = p;
	writePriority(t);
	const err = document.getElementById("p-prio-err");
	if (err) err.textContent = "";
	fetch("/api/task-priority", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ num: numOf(panelFile), priority: p, ...(active ? { project: active } : {}) })
	}).then(r => r.json().then(b => r.ok ? b : Promise.reject(b)))
		.then(() => {
			// the local row carries the new priority into the board pass at once; the poll confirms
			const row = activeBoard().tasks.find(x => x.file === panelFile);
			if (row) row.priority = p;
			render();
			return pollDetail();
		})
		.catch(e => {
			prioWant = null;
			if (openDetail) writePriority(openDetail);
			if (err) err.textContent = "priority not saved: " + ((e && e.error) || "request failed");
		});
}
// payload role to row marker class; a run, its sub rows and a doctor row share the run's role class
const ROLE_CLS = { splitter: "agent-splitter", developer: "agent-developer", reviewer: "agent-reviewer", merger: "agent-merger", "live-tester": "agent-livetest", "integration-tester": "agent-integration" };
const startText = ms => typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toLocaleTimeString() : "";
// one run row: the role label, then the start time, the duration and the tokens at the right; a
// live run spins, a dead one turns red, and a click opens the console on that run's log
function runRowHtml(a, extra, label, sub) {
	const mark = a.alive ? '<span class="spin"></span>' : a.status === "dead" ? '<span class="cross">✗</span>' : '<span class="check">✓</span>';
	const meta = [startText(a.start), fmtDur(a.duration), fmtTokens(a.tokens)].filter(Boolean).join(" · ");
	const activeRow = logState && logState.handle === a.handle && (logState.sub ?? null) === (sub ?? null) ? " agent-row-active" : "";
	return '<button class="run-row ' + (ROLE_CLS[a.role] || "") + " " + extra + (a.alive ? " agent-live" : a.status === "dead" ? " agent-dead" : " agent-past") + activeRow +
		'" data-handle="' + esc(a.handle) + '" data-role="' + esc(a.role) + '"' + (sub == null ? "" : ' data-sub="' + sub + '"') + ">" + mark +
		'<span class="row-role">' + esc(label) + "</span>" + (meta ? '<span class="row-meta">' + esc(meta) + "</span>" : "") + "</button>";
}
// the subagent rows of one run, fetched once per handle: /api/agent-log?sub=list answers the run's
// Agent calls in log order with their token and duration totals
const subCache = Object.create(null);
function loadSubs(handle) {
	if (subCache[handle]) return;
	subCache[handle] = [];
	fetch("/api/agent-log?file=" + encodeURIComponent(handle) + "&sub=list" + projectParam())
		.then(r => r.ok ? r.json() : [])
		.then(list => { subCache[handle] = Array.isArray(list) ? list : []; writeRuns(); })
		.catch(() => { delete subCache[handle]; });
}
function bindRows(el) {
	for (const b of el.querySelectorAll(".run-row")) b.onclick = () => openConsole(b.dataset.handle, b.dataset.sub == null ? null : Number(b.dataset.sub), b.dataset.role);
}
// the runs block: one row per agent run with its subagent rows stacked under it, oldest first,
// the live run last (the payload order)
function writeRuns() {
	const el = document.getElementById("p-runs");
	const t = openDetail && openDetail.file === panelFile ? openDetail : null;
	if (!t) { writeGated(el, ""); return; }
	const runs = (t.agents || []).slice();
	const count = {};
	for (const a of runs) count[a.role] = (count[a.role] || 0) + 1;
	const html = runs.map(a => {
		loadSubs(a.handle); // cached: only the first pass per handle hits the endpoint
		const subs = subCache[a.handle] || [];
		return runRowHtml(a, "", agentLabel(a, count), null) + subs.map(s =>
			runRowHtml({ role: a.role, alive: a.alive, status: a.status, handle: a.handle, tokens: s.tokens, duration: s.duration }, "agent-sub", "Sub-" + a.role, s.index)).join("");
	}).join("");
	if (writeGated(el, html)) bindRows(el);
}
// the history block: the doctor rows of this task's analysed runs, same row and same click
function writeHistory() {
	const el = document.getElementById("p-history");
	const t = openDetail && openDetail.file === panelFile ? openDetail : null;
	const docs = (t && t.doctors) || [];
	const count = {};
	for (const d of docs) count[d.role] = (count[d.role] || 0) + 1;
	if (writeGated(el, docs.map(d => runRowHtml(d, "agent-doctor", agentLabel(d, count), null)).join(""))) bindRows(el);
}
// the panel heading: the number and the name, and the focus target on open. The text is only
// assigned when it changes, so a poll leaves the focused heading and its text node in place
function writeTitle(t) {
	const el = document.getElementById("p-title");
	const text = "#" + numOf(t.file) + " " + (t.name || "");
	if (el && el.textContent !== text) el.textContent = text;
}
// the whole panel from one task payload: every block is html-gated, so an unchanged poll keeps the
// DOM nodes, the panel's scroll position and the focused control
function writePanel(t, withBody) {
	writeTitle(t);
	writeOutside(t);
	const facts = document.getElementById("p-facts");
	if (writeGated(facts, factsHtml(t))) for (const a of facts.querySelectorAll(".num-link")) a.onclick = () => openTask(a.dataset.task);
	writePriority(t);
	const actions = document.getElementById("p-actions");
	if (writeGated(actions, actionsHtml(t))) for (const b of actions.querySelectorAll("[data-copy]")) b.onclick = () => copyText(b);
	writeRuns();
	if (withBody !== false) writeGated(document.getElementById("p-body"), md(t.body || ""));
	writeHistory();
	writeConsoleHead();
}
// the page chrome's height, so the docked panel starts under it and never covers a station head
function syncPanelTop() {
	const el = document.getElementById(archiveView ? "archive" : "board");
	if (el) document.body.style.setProperty("--chrome", Math.max(0, Math.round(el.getBoundingClientRect().top)) + "px");
}
// on open, focus moves to the panel's first heading; the board keeps its own width, so no backdrop
// and no dim
function showPanel() {
	syncPanelTop();
	const p = document.getElementById("panel");
	const wasHidden = p.classList.contains("hidden");
	document.body.classList.add("panel-open");
	p.classList.remove("closing");
	p.classList.remove("hidden");
	if (wasHidden) { const h = document.getElementById("p-title"); if (h && h.focus) h.focus(); }
}
// on close, focus returns to the card that opened the panel
function hidePanel() {
	const p = document.getElementById("panel");
	const card = openerFile && cardEls.get(openerFile);
	panelFile = null;
	openDetail = null;
	prioWant = null;
	notFoundNum = null;
	openerFile = null;
	for (const k in subCache) delete subCache[k];
	document.body.classList.remove("panel-open");
	if (p.classList.contains("hidden")) return;
	closeAnimated(p);
	if (card) card.focus();
}
// the user close: clearing the hash is the close, so back and forward stay in step
function closePanel() {
	if (location.hash.slice(1)) { location.hash = archiveView ? "archive" : ""; return; }
	hidePanel();
}
// an unknown routed number: a dim line names it and the board stays usable
let notFoundNum = null;
function writeNotFound(num) {
	notFoundNum = num;
	panelFile = null;
	openDetail = null;
	prioWant = null;
	document.getElementById("p-title").textContent = "Task #" + num;
	writeGated(document.getElementById("p-facts"), "");
	clearPriority();
	writeGated(document.getElementById("p-actions"), "");
	writeGated(document.getElementById("p-runs"), "");
	writeGated(document.getElementById("p-body"), '<div class="empty">No task #' + esc(String(num)) + " on this board</div>");
	writeGated(document.getElementById("p-history"), "");
	showPanel();
}
// the hash is the route: #task/<num> opens that task, an empty hash closes the panel, and browser
// back and forward replay both; a direct load resolves on the first /api/tasks response
function syncRoute() {
	const h = location.hash.slice(1);
	if (h === "archive") showView(true);
	else if (!h.startsWith("task/")) showView(false);
	routeNum = hashNum();
	const p = document.getElementById("panel");
	if (routeNum == null) { if (!p.classList.contains("hidden") || panelFile || notFoundNum != null) hidePanel(); return; }
	const t = activeBoard().tasks.find(x => numOf(x.file) === routeNum);
	if (t) {
		notFoundNum = null;
		if (panelFile === t.file && visible()) return; // already open: the poll keeps it fresh
		return openPanel(t);
	}
	if (served && notFoundNum !== routeNum) writeNotFound(routeNum);
}
function hashNum() {
	if (!location.hash.startsWith("#task/")) return null;
	const n = Number(location.hash.slice(6));
	return Number.isInteger(n) && n > 0 ? n : null;
}
const visible = () => { const p = document.getElementById("panel"); return !p.classList.contains("hidden") && !p.classList.contains("closing"); };
// open a task by file: the card click routes to the number, so back closes the panel and forward
// re-opens it. A task already routed opens in place
function openTask(file) {
	const t = activeBoard().tasks.find(x => x.file === file);
	if (!t) return;
	openerFile = file;
	if (routeNum === t.num) return openPanel(t);
	location.hash = "task/" + t.num;
}
// 000242: the light rows carry no body or agent data, so openPanel renders the shell from the row
// and loads the heavy detail per task; the panelFile and panel-state checks gate every write, so a
// superseded open never paints into the new view
function openPanel(t) {
	const fresh = panelFile !== t.file;
	if (fresh) {
		panelFile = t.file;
		openDetail = null;
		prioWant = null;
		for (const k in subCache) delete subCache[k];
	}
	writePanel(t, fresh);
	// the loading placeholder: the heavy blocks fill on the detail's arrival
	if (fresh) writeGated(document.getElementById("p-body"), '<div class="empty"><span class="spin"></span>Loading task details…</div>');
	showPanel();
	fetch(detailUrl(t.file)).then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
		if (panelFile !== t.file || !visible()) return;
		if (!d) {
			writeGated(document.getElementById("p-body"), '<div class="empty">Task details failed to load</div>');
			return;
		}
		openDetail = Object.assign({}, openDetail, d);
		writePanel(openDetail);
		markLiveLine();
		// 000248: the text is up, the heavy agent/doctor history loads in a follow-up fetch
		return fetch(historyUrl(t.file)).then(r => r.ok ? r.json() : null).catch(() => null).then(h => {
			if (panelFile !== t.file || !visible() || !h) return;
			openDetail = Object.assign({}, openDetail, h);
			writePanel(openDetail);
			markLiveLine();
		});
	});
}
// the poll's re-fetch of the open task: a failed fetch keeps the last detail, a hidden panel
// discards the response. The heavy history chains after the detail, so the poll paces on the
// merged payload
function pollDetail() {
	const file = panelFile;
	if (!file) return Promise.resolve();
	return fetch(detailUrl(file)).then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
		if (!d || panelFile !== d.file || !visible()) return;
		openDetail = Object.assign({}, openDetail, d);
		writePanel(openDetail);
		markLiveLine();
		return fetch(historyUrl(file)).then(r => r.ok ? r.json() : null).catch(() => null).then(h => {
			if (!h || panelFile !== d.file || !visible()) return;
			openDetail = Object.assign({}, openDetail, h);
			writePanel(openDetail);
			markLiveLine();
		});
	});
}
// the routed task number, the open file, the card that opened it and the served flag that turns a
// missing number into a not-found line instead of a pending open
let routeNum = null;
let panelFile = null;
let openerFile = null;
let served = false;
// 000242: the open task's detail (the heavy per-task payload), fetched on open and re-fetched by the
// poll; the panelFile and panel-state checks gate the writes
let openDetail = null;
// live agent log: each run row carries only its handle, the server resolves the real path; each
// run's subagent transcripts load through the same endpoint with sub=list / sub=n. The console is
// independent of the panel: logState carries everything it renders, so closing the panel never
// closes the run
let logState = null;
let logTimer = null;
const logPane = () => document.getElementById("c-log");
const logUrl = extra => "?file=" + encodeURIComponent(logState.handle) + (logState.sub == null ? "" : "&sub=" + logState.sub) + extra + projectParam();
// 000194: while the viewed run is alive, the shine sits on the LATEST block and only while the run
// is inside one: an open thinking block (data-open) or a tool block still awaiting its result pre
// (tool_execution_start without its end); plain text, closed blocks and idle or dead runs leave
// nothing shining, the same liveness signal the .spin spinner reads
function markLiveLine() {
	const t = openDetail && openDetail.file === panelFile ? openDetail : null;
	const run = t && (t.agents || []).find(a => a.alive);
	const p = logPane();
	const on = !!run && !!logState && run.handle === logState.handle && !p.classList.contains("hidden");
	const text = document.getElementById("c-text");
	let live = null;
	if (on && text) for (const el of text.children) {
		if (el.classList.contains("lg-think") && el.dataset.open) live = el;
		else if (el.classList.contains("lg-tool") && !el.querySelector("pre.lg-out")) live = el;
	}
	if (text) for (const el of text.children) el.classList.toggle("pulse", el === live);
}
const atBottom = () => { const p = logPane(); return p.scrollTop + p.clientHeight >= p.scrollHeight - 4; };
// the live auto-scroll glides to the bottom, an instant auto scroll under reduced motion
function glide(p) {
	const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
	p.scrollTo({ top: p.scrollHeight, behavior: behavior });
}
// the rendered chunk lands in the pane first, then logFixups runs the cross-chunk fixes over it
function ingest(html, where) {
	const el = document.getElementById("c-text");
	if (where === "init") el.innerHTML = html;
	else el.insertAdjacentHTML(where === "history" ? "afterbegin" : "beforeend", html);
	logFixups(el, document);
}
// the console header: task number, role, running or finished state, elapsed and tokens; a finished
// run keeps its last numbers readable
function writeConsoleHead() {
	if (!logState) return;
	const t = openDetail && openDetail.file === panelFile ? openDetail : null;
	const run = t && ((t.agents || []).find(a => a.handle === logState.handle) || (t.doctors || []).find(a => a.handle === logState.handle));
	const label = logState.sub != null ? "Sub-" + logState.role : logState.role ? logState.role[0].toUpperCase() + logState.role.slice(1) : "";
	document.getElementById("c-title").textContent = "#" + logState.num + " " + label;
	document.getElementById("c-state").textContent = run && run.alive ? "running" : "finished";
	document.getElementById("c-tokens").textContent = run ? [fmtDur(run.duration), fmtTokens(run.tokens)].filter(Boolean).join(" · ") : "";
}
function openConsole(handle, sub, role) {
	const c = document.getElementById("console");
	c.classList.remove("closing");
	c.classList.remove("hidden");
	applyConsoleH(consoleH);
	// the previous view's meta line must not flash before the init payload arrives
	const meta = document.getElementById("c-meta");
	if (meta) { meta.textContent = ""; meta.classList.add("hidden"); }
	// 000243: the previous agent's log must not stay visible while the new one loads: the pane
	// clears at once, and the loading text stays until the init payload replaces it
	const text = document.getElementById("c-text");
	if (text) text.textContent = "Loading...";
	logState = { handle, sub: sub == null ? null : sub, role: role || "", num: panelFile ? numOf(panelFile) : "", head: 0, tail: 0, atStart: false, busy: false, idle: false };
	writeConsoleHead();
	writeRuns();
	pullLog(logUrl(""), "init");
	if (logTimer) clearInterval(logTimer);
	logTimer = setInterval(pollLog, 1000);
}
function closeConsole() {
	if (logTimer) { clearInterval(logTimer); logTimer = null; }
	logState = null;
	const c = document.getElementById("console");
	// 000194: poll and state clear at once, only the visual hide waits for the exit animation
	if (c && !c.classList.contains("hidden")) {
		document.body.style.setProperty("--console-h", "0px");
		closeAnimated(c);
	}
	// the loaded log text is the heavy part, dropped at close so the tab holds no transcript memory
	const text = document.getElementById("c-text");
	if (text) text.textContent = "";
	const meta = document.getElementById("c-meta");
	if (meta) { meta.textContent = ""; meta.classList.add("hidden"); }
	writeRuns();
}
function pollLog() {
	// a run's aliveness comes from the open task's detail: with the panel shut the console stops
	// after one empty poll. Ceiling: a live run that is silent mid-tool-call stops its poll too;
	// upgrade path is a light /api/task-history poll from the console itself
	if (!logState || logState.busy) return;
	const t = openDetail && openDetail.file === panelFile ? openDetail : null;
	const liveRun = t && (t.agents || []).find(a => a.alive);
	// logState carries the parent run's handle for a sub view too, so run aliveness keeps both the
	// run's own log and its sub transcripts polling while the run is alive; a live doctor entry
	// keeps its log polling the same way
	const liveDoctor = t && (t.doctors || []).find(d => d.alive);
	const live = (!!liveRun && liveRun.handle === logState.handle) || (!!liveDoctor && liveDoctor.handle === logState.handle);
	// past agents write no lines: one empty poll is proof, stop the timer
	if (!live && logState.idle) {
		if (logTimer) { clearInterval(logTimer); logTimer = null; }
		markLiveLine(); // the death sweep: a run that died while its log idles drops its pulse here
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
		const meta = document.getElementById("c-meta");
		const label = d.model ? d.model + (d.thinkingLevel ? " \u00b7 thinking " + d.thinkingLevel : "") : "";
		if (meta) { meta.textContent = label; meta.classList.toggle("hidden", !label); }
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
		writeConsoleHead();
		markLiveLine();
	}).catch(() => {}).finally(() => { if (logState === st) st.busy = false; });
}
// the console height: dragged from its top edge, adjustable from the keyboard, persisted under one
// key and clamped between the minimum and 60vh
const CONSOLE_KEY = "consoleHeight";
const CONSOLE_MIN = 120;
const consoleMax = () => Math.round(innerHeight * 0.6);
let consoleH = 240;
const clampConsole = h => Math.max(CONSOLE_MIN, Math.min(Math.round(h) || CONSOLE_MIN, consoleMax()));
function applyConsoleH(h) {
	consoleH = clampConsole(h);
	const c = document.getElementById("console");
	if (c && !c.classList.contains("hidden")) document.body.style.setProperty("--console-h", consoleH + "px");
	const handle = document.getElementById("c-handle");
	if (handle) {
		handle.setAttribute("aria-valuemin", String(CONSOLE_MIN));
		handle.setAttribute("aria-valuemax", String(consoleMax()));
		handle.setAttribute("aria-valuenow", String(consoleH));
	}
	try { localStorage.setItem(CONSOLE_KEY, String(consoleH)); } catch {}
}
try { const stored = Number(localStorage.getItem(CONSOLE_KEY)); if (stored) consoleH = clampConsole(stored); } catch {}
// the drag handle: a pointer drag on the top edge, and the arrow keys step it while Home and End
// jump to the limits
let dragging = false;
const handleEl = document.getElementById("c-handle");
handleEl.onpointerdown = e => { dragging = true; if (handleEl.setPointerCapture) handleEl.setPointerCapture(e.pointerId); e.preventDefault(); };
handleEl.onpointermove = e => { if (dragging) applyConsoleH(innerHeight - e.clientY); };
handleEl.onpointerup = handleEl.onpointercancel = () => { dragging = false; };
handleEl.onkeydown = e => {
	const step = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : 0;
	if (step) { applyConsoleH(consoleH + step); e.preventDefault(); return; }
	if (e.key === "Home") { applyConsoleH(CONSOLE_MIN); e.preventDefault(); return; }
	if (e.key === "End") { applyConsoleH(consoleMax()); e.preventDefault(); }
};
applyConsoleH(consoleH);
// 000194: Esc clears the palette, then the filter query, then the console, then the panel; / and
// Cmd-K (Ctrl-K) reach the filter bar and the palette from anywhere but a text field
window.addEventListener("keydown", e => {
	if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); return palOpen ? closePalette() : openPalette(); }
	if (e.key === "/" && !typingTarget(e.target)) { e.preventDefault(); const el = document.getElementById("f-q"); if (el && el.focus) el.focus(); return; }
	if (e.key !== "Escape") return;
	if (palOpen) return closePalette();
	if (filters && filters.q) return clearQuery();
	if (!document.getElementById("console").classList.contains("hidden")) return closeConsole();
	closePanel();
});
window.addEventListener("hashchange", syncRoute);
window.addEventListener("resize", () => { syncPanelTop(); applyConsoleH(consoleH); });
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
// 000235: poll bookkeeping for the wake check: the stamp of the last served board, the delay of
// the pending tick, and its handle (cleared before a forced wake cycle)
let pollTimer = null, lastReload = Date.now(), lastDelay = 5000;
function refresh() {
	// the serving hub's identity in the footer (000165): a stale-code hub or a failover shows
	// at a glance; a 404 means old hub code that predates the endpoint (a webui hot reload mix)
	fetch("/api/hub").then(r => r.status === 404 ? { old: true } : r.ok ? r.json() : null).catch(() => null).then(renderHub);
	fetch("/api/projects").then(r => r.ok ? r.json() : null).catch(() => null).then(list => {
		// the single-project server 404s here, and a transient hub failure keeps the last known
		// tabs: only a real projects list replaces them
		if (Array.isArray(list)) {
			const tabs = tabNames(list);
			projects = tabs.length ? tabs : [{ id: "", label: "", stages: list[0]?.stages ?? DEFAULT_STAGES }]; // single project: the old ui, one board, no tabs
		}
		// a project that vanished from the registry closes the panel its task lived in
		if (!projects.some(t => t.id === active)) { active = projects[0].id; closePanel(); }
		const url = t => t.id ? "/api/tasks?project=" + encodeURIComponent(t.id) : "/api/tasks";
		// every tab polls every cycle, only the active one renders
		return Promise.all(projects.map(t => fetch(url(t)).then(r => r.ok ? r.json() : null).catch(() => null).then(tasks => [t.id, tasks])));
	}).then(rows => {
		mergeBoards(boards, rows);
		render();
		queueExpanded(); // 000271: each poll re-queues the expanded stations, retrying failed files
		// stamp only a served board: during a hub outage the old stamp stays visible
		const current = rows.find(([id]) => id === active);
		if (current && current[1]) {
			served = true;
			document.getElementById("updated").textContent = "updated " + new Date().toLocaleTimeString();
			lastReload = Date.now();
		}
		// the board just landed: the routed number resolves, or names itself unknown
		syncRoute();
		const open = panelFile ? activeBoard().tasks.find(x => x.file === panelFile) : null;
		// the next tick keys on the fresh open card (000142): while it shows a live agent the stats
		// advance at log speed, so the cadence is 1 s; no live agent keeps the 5 s board poll
		if (!open) { lastDelay = 5000; return setTimeout(refresh, 5000); }
		return pollDetail().then(() => {
			lastDelay = refreshMs(openDetail);
			return setTimeout(refresh, refreshMs(openDetail));
		});
	}).catch(() => setTimeout(refresh, 5000)).then(t => { pollTimer = t; }); // a failed cycle retries at the board cadence
}
refresh();
// 000235: a wake past twice the last scheduled cadence means the tab slept; cancel the delayed
// tick and refresh at once, so the "updated" line catches up within a second of the wake
addEventListener("visibilitychange", () => {
	if (document.visibilityState !== "visible" || Date.now() - lastReload <= 2 * lastDelay) return;
	clearTimeout(pollTimer);
	refresh();
});
</script>
</body>
</html>
`;
