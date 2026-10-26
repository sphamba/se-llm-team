import { PRIORITY_RANK } from "../kanban.ts";
import { readConfigFiles, type StageFlags } from "../orchestrator/config.ts";
export type { StageFlags };
import { esc, inline, logFixups, md } from "./logpane.ts";
import { agentLabel, agentStatsText, agentLive, applyCardStats, applyStages, archRowHtml, archStatsText, blockerTasks, buildShell, cardBaseHtml, curve, flipDiff, fmtDur, fmtTokens, groupRuns, heldToken, isHeld, makeStatsQueue, mergeCardStats, numLinkHtml, priorityRuler, relationPaths, sortStation, spinnerHtml, stationFor, statsKey, STATIONS, syncBoard, syncCardStats, taskStats, taskTokenTotal, waitsOnText } from "./board.ts";
import { ARCHIVE_PAGE, archivePage, archiveTasks, decodeFilters, emptyFilters, encodeFilters, FILTER_COMPLEXITIES, FILTER_DEBOUNCE, FILTER_PRIORITIES, FILTERS_KEY, filterReason, filterTasks, filtersActive, filtersCount, matchesFilters, PALETTE_MAX, paletteResults } from "./filters.ts";
import { CSS, MOBILE_MAX } from "./theme.ts";

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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Software Engineering LLM Team</title>
<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/space-grotesk-500.woff2">
<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/ibm-plex-mono-400.woff2">
<style>
${CSS}</style>
</head>
<body>
<header><h1>Software Engineering LLM Team</h1><span id="updated"></span><button id="theme" onclick="toggleTheme()">Dark</button></header>
<nav id="tabs"></nav>
<button id="f-toggle" aria-expanded="false" aria-controls="filters" onclick="toggleFilters()">Filters<span id="f-count" hidden></span></button>
<div id="filters" aria-label="Filter tasks">
<input id="f-q" type="text" placeholder="filter: text or #num  (/)" aria-label="Filter by text or number" autocomplete="off">
<div id="f-prio" class="f-group" role="group" aria-label="Priority"></div>
<div id="f-cx" class="f-group" role="group" aria-label="Complexity"></div>
<button id="f-user" class="f-chip" aria-pressed="false">user</button>
<button id="f-held" class="f-chip" aria-pressed="false">held</button>
<button id="f-live" class="f-chip" aria-pressed="false">live</button>
<button id="f-clear" class="f-chip" hidden>clear</button>
<button id="f-apply" class="f-chip" onclick="closeFilters()">apply</button>
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
<div id="p-head"><div id="p-handle" aria-hidden="true"></div><h2 id="p-title" tabindex="-1"></h2><button id="p-close" onclick="closePanel()">Close</button></div>
<div id="p-outside" class="hidden"></div>
<div id="p-facts"></div>
<div id="p-prio-wrap"><span class="k">priority</span><div id="p-prio" role="group" aria-label="Priority"></div><div id="p-prio-err" role="status"></div></div>
<div id="p-actions"></div>
<div id="p-runs"></div>
<div id="p-body"></div>
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
// #370 the stylesheet's one phone breakpoint, so the CSS switch and the JS check cannot drift
const MOBILE_MAX = ${MOBILE_MAX};
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
// #377 one motion mode: the system preference alone, live unless it asks for reduced motion. The
// attribute lands before the first paint, so no frame shows the wrong mode, and the JS gates below
// read the same ask through noMotion()
const reduceMq = matchMedia("(prefers-reduced-motion: reduce)");
let tickTimer = null, polledAt = 0;
const noMotion = () => reduceMq.matches;
function applyMotion() { rootEl.dataset.motion = reduceMq.matches ? "none" : "live"; syncTicker(); }
applyMotion();
reduceMq.addEventListener("change", applyMotion);
document.addEventListener("visibilitychange", () => { rootEl.classList.toggle("motion-paused", document.hidden); syncTicker(); });
const inline = ${inline};
${md}
// FLIP across a refresh: measure old positions, sync the cards, invert, play. Every card whose
// board-content position changed moves, the siblings shifting when a card enters or leaves a
// station included; positions are board-content relative, so a scrolled refresh animates nothing.
${flipDiff}
${curve}
${relationPaths}
${blockerTasks}
${heldToken}
${waitsOnText}
${stationFor}
// board layout and the card pass, interpolated as source so the client runs the tested code;
// constants go in as values, the functions as source
const STATIONS = ${JSON.stringify(STATIONS)};
const PRIORITY_RANK = ${JSON.stringify(PRIORITY_RANK)};
${spinnerHtml}
${numLinkHtml}
${priorityRuler}
${isHeld}
${agentLive}
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
${groupRuns}
${agentStatsText}
${fmtTokens}
${fmtDur}
${taskTokenTotal}
${taskStats}
${archStatsText}
${archRowHtml}
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
const FILTER_PRIORITIES = ${JSON.stringify(FILTER_PRIORITIES)};
const FILTER_COMPLEXITIES = ${JSON.stringify(FILTER_COMPLEXITIES)};
${emptyFilters}
${encodeFilters}
${decodeFilters}
${filtersActive}
${filtersCount}
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
	const q = document.getElementById("f-q");
	if (q && document.activeElement !== q && q.value !== filters.q) q.value = filters.q;
	renderChips("f-prio", "priorities");
	renderChips("f-cx", "complexities");
	const user = document.getElementById("f-user"), held = document.getElementById("f-held"), liveEl = document.getElementById("f-live");
	if (user) user.setAttribute("aria-pressed", String(filters.issuer === "user"));
	if (held) held.setAttribute("aria-pressed", String(filters.held));
	if (liveEl) liveEl.setAttribute("aria-pressed", String(filters.live));
	const clear = document.getElementById("f-clear");
	if (clear) clear.hidden = !filtersActive(filters);
	syncFilterToggle();
}
// #378 the two chip groups: a chip is a real button over a set, its own value hue marks the pressed
// state, and one click applies
const CHIP_HUE = { priorities: "pr-", complexities: "cx-" };
function renderChips(id, field) {
	const el = document.getElementById(id);
	if (!el) return;
	const values = field === "priorities" ? FILTER_PRIORITIES : FILTER_COMPLEXITIES;
	const chosen = filters[field];
	if (el.children.length !== values.length) {
		el.innerHTML = values.map(v => '<button class="f-chip ' + CHIP_HUE[field] + v + '" data-value="' + v + '" aria-pressed="false">' + v + "</button>").join("");
		for (const b of el.children) b.onclick = () => toggleChip(field, b.dataset.value);
	}
	for (const b of el.children) b.setAttribute("aria-pressed", String(chosen.includes(b.dataset.value)));
}
function toggleChip(field, value) {
	const list = filters[field];
	const i = list.indexOf(value);
	if (i < 0) list.push(value); else list.splice(i, 1);
	applyFilters();
}
function toggleIssuer() {
	filters.issuer = filters.issuer === "user" ? "" : "user";
	applyFilters();
}
// #370 the phone filter button: the bar collapses behind one button, the badge counts the active
// dimensions, and the sheet holds the same controls with an apply that closes it
function syncFilterToggle() {
	const b = document.getElementById("f-toggle"), n = document.getElementById("f-count");
	const count = filtersCount(filters);
	if (n) { const text = count ? String(count) : ""; if (n.textContent !== text) n.textContent = text; n.hidden = !count; }
	if (b) b.setAttribute("aria-expanded", String(document.body.classList.contains("filters-open")));
}
function openFilters() {
	document.body.classList.add("filters-open");
	syncFilterToggle();
	const q = document.getElementById("f-q");
	if (q && q.focus) q.focus();
}
function closeFilters() {
	document.body.classList.remove("filters-open");
	syncFilterToggle();
}
function toggleFilters() {
	if (document.body.classList.contains("filters-open")) return closeFilters();
	return openFilters();
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
// #380 the archive's stats batch: one /api/card-stats request for the files of the rendered page
// that the session map does not know yet, merged into the same statsKnown map the cards use and
// applied onto the rows, then the archive re-renders in place; a file in flight is never asked
// twice, and a failed batch drops its files so the next render retries
const archAsked = new Set();
function queueArchiveStats(rows) {
	const project = active;
	const key = file => statsKey(project, file);
	const want = rows.filter(t => !t.agents && !statsKnown[key(t.file)] && !archAsked.has(key(t.file))).map(t => t.file);
	if (!want.length) return;
	for (const f of want) archAsked.add(key(f));
	const drop = () => { for (const f of want) archAsked.delete(key(f)); };
	fetch("/api/card-stats?files=" + encodeURIComponent(want.join(",")) + (project ? "&project=" + encodeURIComponent(project) : ""))
		.then(r => r.ok ? r.json() : null)
		.then(stats => {
			if (!stats) { drop(); return; }
			mergeCardStats(stats, boardOf(boards, project).tasks, statsKnown, localStorage, project);
			applyCardStats(boardOf(boards, project).tasks, statsKnown, localStorage, project);
			renderArchive();
		}, drop);
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
	const html = win.rows.map(t => archRowHtml(t, archDate(t.updated))).join("");
	if (list && writeGated(list, html)) for (const b of list.children) b.onclick = () => openTask(b.dataset.task);
	const empty = document.getElementById("arch-empty");
	if (empty) { const text = rows.length ? "" : filtersActive(filters) ? filterReason(filters) : "nothing finished yet"; if (empty.textContent !== text) empty.textContent = text; empty.classList.toggle("hidden", !!rows.length); }
	const pageEl = document.getElementById("arch-page");
	if (pageEl) { const text = win.pages > 1 ? "page " + (win.page + 1) + " of " + win.pages + " \u00b7 " + (win.start + 1) + "-" + win.end + " of " + rows.length : ""; if (pageEl.textContent !== text) pageEl.textContent = text; }
	const older = document.getElementById("arch-more");
	if (older) older.hidden = win.page >= win.pages - 1;
	const newer = document.getElementById("arch-newer");
	if (newer) newer.hidden = win.page <= 0;
	queueArchiveStats(win.rows);
}
const bind = (id, ev, fn) => { const el = document.getElementById(id); if (el) el[ev] = fn; };
const typingTarget = el => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true);
bind("f-q", "oninput", e => { clearTimeout(fqTimer); fqTimer = setTimeout(() => { filters.q = e.target.value.trim(); applyFilters(); }, FILTER_DEBOUNCE); });
bind("f-user", "onclick", toggleIssuer);
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
// the one 1 px/s tick: a running card's elapsed time and its progress line advance between polls,
// both reseeded from the authoritative payload on every render; it runs whenever the tab is visible,
// because the stylesheet floor lands every change with no animation under reduced motion
function syncTicker() {
	if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
	if (document.hidden) return;
	tickTimer = setInterval(tickCards, 1000);
}
function tickCards() {
	const delta = polledAt ? Math.max(0, Date.now() - polledAt) : 0;
	for (const el of cardEls.values()) {
		if (!el.classList.contains("running")) continue;
		const t = activeBoard().tasks.find(x => x.file === el.dataset.file);
		const live = t && (t.agents || []).find(a => a.alive);
		if (!live) continue;
		syncCardStats(el, { agents: t.agents.map(a => (a === live ? { ...a, duration: (a.duration || 0) + delta } : a)) });
		el.style.setProperty("--p", String(Math.min(1, ((live.duration || 0) + delta) / 1000 / (el.offsetWidth || 1))));
	}
}
// 000264: the lazily-known card stats, keyed per project and task (statsKey)
const statsKnown = Object.create(null);
function makeCard(file) {
	const el = document.createElement("div");
	el.className = "card";
	el.dataset.file = file;
	// #373 a click or an Enter on the marker belongs to the popover, not to the card under it
	const onMarker = (e) => e.target.closest && e.target.closest(".c-wait");
	el.onclick = (e) => { if (!onMarker(e)) openTask(file); };
	// #366: the card is a link in the tab order, so Enter opens the card under the focus ring
	el.tabIndex = 0;
	el.onkeydown = (e) => { if (e.key === "Enter" && !onMarker(e)) { e.preventDefault(); openTask(file); } };
	// #402 the reveal follows the event, not the device: a mouse hover arms and clears, a finger or a
	// pen arms only while pressed, so a hybrid device keeps both behaviours, one per input
	el.onpointerenter = (e) => { if (e.pointerType === "mouse") hotRelations(file, true); };
	el.onpointerleave = (e) => { if (e.pointerType === "mouse") hotRelations(file, false); };
	el.onpointerdown = (e) => { if (e.pointerType === "touch" || e.pointerType === "pen") hotRelations(file, true); };
	el.onpointerup = el.onpointercancel = (e) => { if (e.pointerType === "touch" || e.pointerType === "pen") hotRelations(file, false); };
	// #373 #402 focus arms only the keyboard's own focus: :focus-visible is true after Tab and false
	// after a pointer or a tap, so the sheet's focus restore cannot re-arm the touched card
	el.onfocus = () => { if (el.matches(":focus-visible")) hotRelations(file, true); };
	el.onblur = () => hotRelations(file, false);
	// 000191: the entrance class is one-shot, dropped on animationend so a later poll or reorder
	// never replays it
	el.onanimationend = () => { el.classList.remove("enter"); el.onanimationend = null; };
	return el;
}
// board-content relative: page scroll cancels, board scroll is added back, so a refresh after
// scrolling measures identical positions and animates nothing; w/h feed the relation geometry.
// #392 the overlay is absolute in the board, so a station body's inner scroll never moves a drawn
// endpoint: the draw path adds the board scroll alone. #366 the FLIP step measures before the
// re-render resets that inner scroll, so it alone adds every scroll ancestor up to the board
function cardBox(el, flip) {
	const board = document.getElementById("board");
	const boardRect = board.getBoundingClientRect();
	const r = el.getBoundingClientRect();
	let dx = board.scrollLeft, dy = board.scrollTop;
	if (flip) for (let p = el.parentElement; p && p !== board; p = p.parentElement) { dx += p.scrollLeft; dy += p.scrollTop; }
	return { x: r.left - boardRect.left + dx, y: r.top - boardRect.top + dy, w: r.width, h: r.height };
}
// #373 hovering or focusing a card reveals its relations: the board gains a class, the paths that
// touch the hovered card raise in both directions, the far end of each line stays lit and takes the
// rim, and every other card dims. The paths carry both endpoint files as data, so the match needs no
// selector interpolation
function hotRelations(file, on) {
	const board = document.getElementById("board");
	if (board) board.classList.toggle("reveal", on);
	const lit = new Set([file]);
	for (const p of document.querySelectorAll("#relations path")) {
		const mine = p.dataset.file === file || p.dataset.blocker === file;
		p.classList.toggle("relations-hot", on && mine);
		if (!on || !mine) continue;
		lit.add(p.dataset.file === file ? p.dataset.blocker : p.dataset.file);
	}
	for (const el of document.querySelectorAll("#board .card")) {
		el.classList.toggle("hot", on && lit.has(el.dataset.file));
		el.classList.toggle("rim", on && el.dataset.file !== file && lit.has(el.dataset.file));
	}
}
// #398 the panel path clears the reveal through the same switch, so an open or a close cannot leave a
// card selected on any input
const clearReveal = () => hotRelations(null, false);
// #370 the phone layout stacks every card in one column, so no relation curve has a span to cross
const verticalSpine = () => matchMedia("(max-width: " + MOBILE_MAX + "px)").matches;
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
	const paths = relationPaths(activeBoard().tasks, rectOf, verticalSpine());
	svg.setAttribute("width", w);
	svg.setAttribute("height", h);
	const html = paths.map(p => '<path d="' + p.d + '" data-file="' + esc(p.file) + '" data-blocker="' + esc(p.blocker) + '"/>').join("");
	if (svg.__html !== html) { svg.innerHTML = html; svg.__html = html; }
	drawStubs(paths);
}
// #392 one redraw entry, one draw per frame: a scroll burst, a resize and a poll in the same frame
// coalesce into a single pass
let relationsFrame = 0;
function queueRelations() {
	if (relationsFrame) return;
	relationsFrame = requestAnimationFrame(() => { relationsFrame = 0; drawRelations(); });
}
// #373 an off-board blocker keeps a stub at its blocked card's right edge: two at most, then a count.
// The element is reused across refreshes, so a poll neither flickers nor widens the board
function drawStubs(paths) {
	const byFile = {};
	for (const p of paths) if (p.offBoard) (byFile[p.file] = byFile[p.file] || []).push(p.blocker);
	for (const el of cardEls.values()) {
		const list = byFile[el.dataset.file] || [];
		const stub = el.querySelector(".c-stub");
		if (!list.length) { if (stub) stub.remove(); continue; }
		const items = list.slice(0, 2).map(f => '<span class="c-stub-item">← #' + parseInt(f, 10) + '<span class="stub-tag">off board</span></span>');
		if (list.length > 2) items.push('<span class="c-stub-item">+' + (list.length - 2) + "</span>");
		const html = items.join("");
		if (stub) { if (stub.__html === html) continue; stub.innerHTML = html; stub.__html = html; }
		else { const made = document.createElement("div"); made.className = "c-stub"; made.innerHTML = html; made.__html = html; el.appendChild(made); }
	}
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
		// #373 the marker delegation: one listener for every card, so a re-render never rebinds it
		board.addEventListener("click", (e) => {
			const marker = e.target.closest && e.target.closest(".c-wait");
			if (!marker) return;
			e.stopPropagation();
			toggleWaits(marker.closest(".card").dataset.file);
		});
		window.addEventListener("resize", queueRelations);
		// #392 the station bodies are rebuilt by every render, so the board carries the capture-phase
		// scroll listener; the observer covers the docked panel's class-toggle width change
		board.addEventListener("scroll", queueRelations, true);
		new ResizeObserver(queueRelations).observe(board);
	}
	const project = projects.find(t => t.id === active);
	applyStages(stations, project?.stages ?? DEFAULT_STAGES);
	const reduced = noMotion();
	const old = {};
	if (!skipFlip) for (const el of cardEls.values()) {
		el.style.transition = "none";
		el.style.transform = "";
		old[el.dataset.file] = cardBox(el, true);
	}
	// 000264: the lazily-known stats land on the rows before the board pass, so the 5 s poll's
	// agent-less cards 6+ never wipe revealed stats; the payload's eager first-5 agents win
	applyCardStats(tab.tasks, statsKnown, localStorage, active);
	syncBoard(stations, filterTasks(tab.tasks, filters), tab.expanded, cardEls, makeCard, VISIBLE, document, filterReason(filters), tab.tasks);
	// #369 the authoritative values land here on every poll; the 1 px/s tick advances from them
	polledAt = Date.now();
	syncTicker();
	const now = {};
	for (const el of cardEls.values()) now[el.dataset.file] = cardBox(el, true);
	const diff = flipDiff(old, now);
	queueRelations(); // settled positions; transitionend redraws after a FLIP settles
	for (const el of cardEls.values()) {
		const d = diff[el.dataset.file];
		if (!d || reduced) continue;
		el.style.transition = "none";
		el.style.transform = "translate(" + d.dx + "px," + d.dy + "px)";
		el.getBoundingClientRect();
		el.style.transition = "transform .4s ease";
		el.style.transform = "";
		el.ontransitionend = () => { el.style.transition = ""; el.ontransitionend = null; queueRelations(); };
	}
	if (archiveView) renderArchive();
}
// the shared animated close: .closing runs the entrance in reverse, the element hides on
// animationend with a fixed-timeout fallback (a background tab never fires the event); a reopen
// drops .closing first, so the late event must not re-hide
function closeAnimated(el) {
	if (el.classList.contains("closing")) return;
	if (noMotion()) { el.classList.add("hidden"); return; }
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
// the blockedBy row: the user hold leads as a held item, each stored task ref links to its card
// when that task is on the board, and the row is dropped when the list is empty and unheld
function blockedRow(t) {
	const refs = String(t.blockedBy || "").split(",").map(s => s.trim()).filter(Boolean);
	const items = refs.filter(ref => ref.toLowerCase() !== "user").map(ref => {
		const target = taskByNum(ref);
		return target ? numLinkHtml(target.file) : esc(ref);
	});
	if (isHeld(t)) items.unshift('<span class="held">held</span>');
	if (!items.length) return "";
	return "<div><span class='k'>blockedBy</span>" + items.join(", ") + "</div>";
}
// #373 the waits-on popover: one row per stored ref in stored order, the number as the board's own id
// link, the name on one line, the state, and a badge. A rendered row opens that card, a ref that
// resolves to no task prints its own text alone
let waitFile = null;
function waitRows(t) {
	return String(t.blockedBy || "").split(",").map(s => s.trim()).filter(Boolean).map(ref => {
		const target = taskByNum(ref);
		if (!target) return '<div class="wait-row"><span class="wait-name">' + esc(ref) + "</span></div>";
		const onBoard = cardEls.has(target.file);
		// a done blocker reads as satisfied first, because a done card is usually folded away as well
		const badge = target.state === "done" ? '<span class="wait-badge wait-done">✓</span>' : onBoard ? "" : '<span class="wait-badge">off board</span>';
		const cells = '<span class="wait-name">' + esc(target.name) + '</span><span class="wait-state">' + esc(target.state) + "</span>" + badge;
		return onBoard
			? '<button type="button" class="wait-row" data-wait-open="' + esc(target.file) + '">' + numLinkHtml(target.file) + cells + "</button>"
			: '<div class="wait-row">' + numLinkHtml(target.file) + cells + "</div>";
	}).join("");
}
// #393 both axes come from the marker rect: a card is taller than the one-row popover, so a
// card-anchored top lands a card height above the row the popover belongs to; the phone layout
// puts it under the card at full width instead of floating it
function placeWaits(pop, card) {
	const m = card.querySelector(".c-wait").getBoundingClientRect();
	if (verticalSpine()) {
		const c = card.getBoundingClientRect();
		pop.style.left = "8px";
		pop.style.right = "8px";
		pop.style.top = Math.round(c.bottom + 4) + "px";
		return;
	}
	pop.style.left = Math.round(Math.max(8, Math.min(m.left, innerWidth - pop.offsetWidth - 8))) + "px";
	pop.style.top = Math.round(m.top >= pop.offsetHeight + 12 ? m.top - pop.offsetHeight - 8 : m.bottom + 8) + "px";
}
function closeWaits(restore) {
	const pop = document.getElementById("waits-pop");
	const file = waitFile;
	waitFile = null;
	if (pop) pop.remove();
	if (!restore || !file) return;
	const card = cardEls.get(file);
	const marker = card && card.querySelector(".c-wait");
	if (marker) marker.focus();
}
// #373 one popover at a time, keyed by the blocked file: a poll leaves it open, and only another
// marker replaces it. A rendered row scrolls its card into view and replays the card entrance
function openWaits(file) {
	const t = activeBoard().tasks.find(x => x.file === file);
	const card = cardEls.get(file);
	if (!t || !card || !card.querySelector(".c-wait")) return;
	closeWaits(false);
	waitFile = file;
	const pop = document.createElement("div");
	pop.id = "waits-pop";
	pop.setAttribute("role", "dialog");
	pop.setAttribute("aria-label", "blocked by");
	pop.innerHTML = waitRows(t);
	pop.onclick = (e) => {
		const row = e.target.closest && e.target.closest(".wait-row[data-wait-open]");
		if (!row) return;
		const target = cardEls.get(row.dataset.waitOpen);
		closeWaits(true);
		if (target) {
			target.scrollIntoView({ block: "nearest", inline: "nearest" });
			target.classList.add("enter");
			target.onanimationend = () => { target.classList.remove("enter"); target.onanimationend = null; };
		}
	};
	document.body.appendChild(pop);
	placeWaits(pop, card);
	const first = pop.querySelector("button.wait-row");
	if (first) first.focus();
}
function toggleWaits(file) {
	if (waitFile === file) closeWaits(true);
	else openWaits(file);
}
// escape, an outside click and a scroll close the popover; a click on a marker is the toggle's own
// business. #393 the popover is fixed while the cards move, so a scroll of #board or of a station
// body closes it instead of leaving it at a stale position, and capture reaches both
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && waitFile) closeWaits(true); });
document.addEventListener("scroll", () => { if (waitFile) closeWaits(false); }, true);
document.addEventListener("click", (e) => {
	if (!waitFile) return;
	const pop = document.getElementById("waits-pop");
	if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest(".c-wait"))) closeWaits(false);
});
// the issuer row: a task-issued issuer ("#<num>") links to its card when that task is on the
// active board; "user", the orchestrator's "auto", an absent issuer, or an off-board number stays
// plain text (auto never carries an issuer link)
function issuerCell(t) {
	const target = t.issuer && t.issuer !== "user" && t.issuer !== "auto" ? taskByNum(t.issuer) : null;
	return target ? numLinkHtml(target.file) : esc(t.issuer || "user");
}
// the panel header's facts: number, state slug, complexity, issuer, blockedBy and worktree
function factsHtml(t) {
	return "<div><span class='k'>number</span>#" + esc(String(numOf(t.file))) + "</div>" +
		"<div><span class='k'>state</span>" + esc(t.state) + "</div>" +
		"<div><span class='k'>complexity</span><span class='chip cx cx-" + esc(t.complexity || "moderate") + "'>" + esc(t.complexity || "moderate") + "</span></div>" +
		"<div><span class='k'>issuer</span>" + issuerCell(t) + "</div>" +
		blockedRow(t) +
		"<div><span class='k'>worktree</span>" + (esc(t.worktree) || "&mdash;") + "</div>";
}
// the actions: block or unblock the user hold. The hold toggle stays outside the rebuilt facts
// block, so a detail refresh never rebuilds it
function actionsHtml(t) {
	if (t.state === "done") return "";
	if (isHeld(t)) return '<button class="m-action m-unblock" onclick="toggleHold(this)" title="Remove the user hold"><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor"/></svg>Unblock</button>';
	if (t.state === "merging") return "";
	return '<button class="m-action m-block" onclick="toggleHold(this)" title="Hold this task and stop its agent"><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>Block</button>';
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
// the runs block: one group per run, oldest first and the live run last (the payload order); a
// group holds the run row, its subagent rows, then its doctor row, and the doctors whose run is
// gone render after the last run under a label row, so nothing is lost silently
function writeRuns() {
	const el = document.getElementById("p-runs");
	const t = openDetail && openDetail.file === panelFile ? openDetail : null;
	if (!t) { writeGated(el, ""); return; }
	const doctors = t.doctors || [];
	const count = {};
	for (const a of t.agents || []) count[a.role] = (count[a.role] || 0) + 1;
	const docCount = {};
	for (const d of doctors) docCount[d.role] = (docCount[d.role] || 0) + 1;
	const { groups, unmatched } = groupRuns(t.agents || [], doctors);
	const html = groups.map(({ run, doctor }) => {
		loadSubs(run.handle); // cached: only the first pass per handle hits the endpoint
		const kids = (subCache[run.handle] || []).map(s =>
			runRowHtml({ role: run.role, alive: run.alive, status: run.status, handle: run.handle, tokens: s.tokens, duration: s.duration }, "agent-sub", "Sub-" + run.role, s.index)).join("") +
			(doctor ? runRowHtml(doctor, "agent-doctor", agentLabel(doctor, docCount), null) : "");
		return '<div class="run-group' + (run.alive ? " run-group-live" : "") + '">' + runRowHtml(run, "", agentLabel(run, count), null) + kids + "</div>";
	}).join("") + (unmatched.length
		? '<div class="run-note">no matching run</div>' + unmatched.map(d => runRowHtml(d, "agent-doctor", agentLabel(d, docCount), null)).join("")
		: "");
	if (writeGated(el, html)) bindRows(el);
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
	writeGated(actions, actionsHtml(t));
	writeRuns();
	if (withBody !== false) writeGated(document.getElementById("p-body"), md(t.body || ""));
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
	clearReveal();
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
	clearReveal();
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
	clearReveal();
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
	const behavior = noMotion() ? "auto" : "smooth";
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
	c.classList.remove("raised");
	syncConsoleSheet();
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
// #405 the phone sheet starts collapsed at 92px, so that is its floor and a drag from the collapsed
// sheet does not jump; the desktop dock keeps 120
const CONSOLE_MIN_TOUCH = 92;
const consoleMax = () => Math.round(innerHeight * 0.6);
let consoleH = 240;
const consoleMin = () => verticalSpine() ? CONSOLE_MIN_TOUCH : CONSOLE_MIN;
const clampConsole = h => Math.max(consoleMin(), Math.min(Math.round(h) || consoleMin(), consoleMax()));
function applyConsoleH(h) {
	consoleH = clampConsole(h);
	const narrow = verticalSpine();
	const c = document.getElementById("console");
	if (c && !c.classList.contains("hidden")) document.body.style.setProperty(narrow ? "--console-h-touch" : "--console-h", consoleH + "px");
	const handle = document.getElementById("c-handle");
	if (handle) {
		handle.setAttribute("aria-valuemin", String(consoleMin()));
		handle.setAttribute("aria-valuemax", String(consoleMax()));
		handle.setAttribute("aria-valuenow", String(consoleH));
	}
	try { localStorage.setItem(CONSOLE_KEY, String(consoleH)); } catch {}
}
try { const stored = Number(localStorage.getItem(CONSOLE_KEY)); if (stored) consoleH = clampConsole(stored); } catch {}
// #370 the console sheet: a run opens as one status line, a tap on the handle raises the sheet, and
// the raised class is inert above the breakpoint so the desktop dock keeps its dragged height
function syncConsoleSheet() {
	const c = document.getElementById("console"), h = document.getElementById("c-handle");
	if (c && h) h.setAttribute("aria-expanded", String(c.classList.contains("raised")));
}
function toggleConsoleSheet() {
	const c = document.getElementById("console");
	if (!c) return;
	c.classList.toggle("raised");
	syncConsoleSheet();
}
// the drag handle: a pointer drag on the top edge, and the arrow keys step it while Home and End
// jump to the limits
let dragging = false, dragged = false, dragY = 0;
const handleEl = document.getElementById("c-handle");
// #405 a pointer that clears 3px is a drag, so the click that ends it does not also raise the sheet;
// the tap stays the quick raise and collapse, and the keyboard path is unchanged
const handleTap = () => { if (dragged) { dragged = false; return; } toggleConsoleSheet(); };
handleEl.onclick = handleTap;
handleEl.onpointerdown = e => { dragging = true; dragged = false; dragY = e.clientY; if (handleEl.setPointerCapture) handleEl.setPointerCapture(e.pointerId); e.preventDefault(); };
handleEl.onpointermove = e => { if (!dragging) return; if (Math.abs(e.clientY - dragY) > 3) dragged = true; applyConsoleH(innerHeight - e.clientY); };
handleEl.onpointerup = handleEl.onpointercancel = () => { dragging = false; };
handleEl.onkeydown = e => {
	const step = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : 0;
	if (step) { applyConsoleH(consoleH + step); e.preventDefault(); return; }
	if (e.key === "Home") { applyConsoleH(CONSOLE_MIN); e.preventDefault(); return; }
	if (e.key === "End") { applyConsoleH(consoleMax()); e.preventDefault(); return; }
	if (e.key === "Enter" || e.key === " ") { toggleConsoleSheet(); e.preventDefault(); }
};
applyConsoleH(consoleH);
syncConsoleSheet();
// 000194: Esc clears the palette, then the filter query, then the console, then the panel; / and
// Cmd-K (Ctrl-K) reach the filter bar and the palette from anywhere but a text field
window.addEventListener("keydown", e => {
	if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); return palOpen ? closePalette() : openPalette(); }
	if (e.key === "/" && !typingTarget(e.target)) { e.preventDefault(); openFilters(); return; }
	if (e.key !== "Escape") return;
	if (palOpen) return closePalette();
	if (document.body.classList.contains("filters-open")) return closeFilters();
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
