import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { kanbanDir, listAll, STATES } from "./kanban.ts";

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

function taskBody(root: string, file: string): string {
	try {
		const raw = readFileSync(join(kanbanDir(root), file), "utf8");
		const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
		return m ? m[2] : raw;
	} catch {
		return "";
	}
}

function taskUpdated(root: string, file: string): number {
	try {
		return statSync(join(kanbanDir(root), file)).mtimeMs;
	} catch {
		return 0;
	}
}

function serve(root: string, req: IncomingMessage, res: ServerResponse): void {
	const path = (req.url ?? "/").split("?")[0];
	if (req.method !== "GET") {
		res.writeHead(404).end();
	} else if (path === "/") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
		res.end(PAGE);
	} else if (path === "/api/tasks") {
		res.writeHead(200, { "content-type": "application/json; charset=utf-8", connection: "close" });
		res.end(
			JSON.stringify(
				listAll(root).map((t) => ({
					file: t.file,
					name: t.name,
					priority: t.priority,
					state: t.state,
					worktree: t.worktree,
					updated: taskUpdated(root, t.file),
					body: taskBody(root, t.file),
				})),
			),
		);
	} else {
		res.writeHead(404).end();
	}
}

// Ayu Dark palette (ayu-theme/ayu-colors), written once and applied twice: explicit choice via data-theme, browser default via media query
const DARK_VARS = `
:root[data-theme="dark"] { --bg: #10141c; --fg: #bfbdb6; --panel: #141821; --border: #1b1f29; --heading: #bfbdb6; --muted: #5a6673; --faint: #5a6673; --soft: #bfbdb6; --hover: #1b1f29; --overlay: rgba(0, 0, 0, .6); --code-bg: #010102; --link: #e6b450;
--low-bg: rgba(170, 217, 76, .15); --low-fg: #aad94c; --medium-bg: rgba(255, 180, 84, .15); --medium-fg: #ffb454; --high-bg: rgba(255, 143, 64, .15); --high-fg: #ff8f40; --critical-bg: rgba(217, 87, 87, .15); --critical-fg: #d95757; }
:root[data-theme="dark"] #theme { color: var(--link); border-color: var(--link); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #10141c; --fg: #bfbdb6; --panel: #141821; --border: #1b1f29; --heading: #bfbdb6; --muted: #5a6673; --faint: #5a6673; --soft: #bfbdb6; --hover: #1b1f29; --overlay: rgba(0, 0, 0, .6); --code-bg: #010102; --link: #e6b450;
--low-bg: rgba(170, 217, 76, .15); --low-fg: #aad94c; --medium-bg: rgba(255, 180, 84, .15); --medium-fg: #ffb454; --high-bg: rgba(255, 143, 64, .15); --high-fg: #ff8f40; --critical-bg: rgba(217, 87, 87, .15); --critical-fg: #d95757; }
:root:not([data-theme="light"]) #theme { color: var(--link); border-color: var(--link); } }
`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Software Engineering LLM Team</title>
<style>
* { box-sizing: border-box; }
/* Ayu Light palette (ayu-theme/ayu-colors) */
:root { --bg: #fcfcfc; --fg: #5c6166; --panel: #ffffff; --border: rgba(107, 125, 143, .12); --heading: #5c6166; --muted: #adaeb1; --faint: #adaeb1; --soft: #5c6166; --hover: rgba(130, 142, 159, .1); --overlay: rgba(15, 23, 42, .45); --code-bg: #ebeef0; --link: #f29718;
--low-bg: rgba(134, 179, 0, .15); --low-fg: #86b300; --medium-bg: rgba(235, 164, 0, .15); --medium-fg: #eba400; --high-bg: rgba(250, 133, 50, .15); --high-fg: #fa8532; --critical-bg: rgba(230, 80, 80, .15); --critical-fg: #e65050; }
${DARK_VARS}
body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
header { display: flex; align-items: baseline; gap: 10px; padding: 14px 18px 6px; background: var(--code-bg); }
h1 { font-size: 16px; margin: 0; }
#theme { margin-left: auto; border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
#theme:hover { background: var(--hover); }
#updated { font-size: 12px; color: var(--muted); }
#board { display: flex; gap: 10px; padding: 10px 18px 18px; overflow-x: auto; align-items: flex-start; }
.col { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; border-top: 3px solid var(--ac); padding: 10px; min-width: 200px; flex: 1 0 200px; }
.col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 10px; color: var(--heading); }
.count { color: var(--faint); }
.card { border: 1px solid var(--border); border-left: 3px solid var(--ac); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; }
.card:hover { background: var(--hover); }
.name { font-size: 13px; line-height: 1.35; margin-bottom: 6px; }
.num { color: var(--faint); margin-right: 4px; }
.spin { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border: 2px solid var(--border); border-top-color: var(--fg); border-radius: 50%; vertical-align: -1px; animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.chip { font-size: 10px; padding: 1px 7px; border-radius: 999px; background: var(--border); color: var(--soft); }
.p-low { background: var(--low-bg); color: var(--low-fg); }
.p-medium { background: var(--medium-bg); color: var(--medium-fg); }
.p-high { background: var(--high-bg); color: var(--high-fg); }
.p-critical { background: var(--critical-bg); color: var(--critical-fg); }
.empty { font-size: 12px; color: var(--faint); }
.toggle { display: block; width: 100%; margin-top: 2px; border: 1px solid var(--border); background: var(--panel); color: var(--link); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.toggle:hover { background: var(--hover); }
#modal { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; }
#modal.hidden { display: none; }
#m-box { background: var(--panel); border-radius: 10px; padding: 18px; width: min(760px, calc(100vw - 32px)); max-height: 82vh; overflow: auto; }
#m-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
#m-head h2 { font-size: 15px; margin: 0; }
#m-close { border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
#m-close:hover { background: var(--hover); }
#m-attrs { font-size: 12px; color: var(--soft); margin-bottom: 12px; }
#m-attrs div { padding: 3px 0; }
#m-attrs span:not(.chip) { display: inline-block; min-width: 80px; color: var(--faint); }
#m-body { font-size: 13px; line-height: 1.5; }
#m-body h1, #m-body h2, #m-body h3 { font-size: 13px; margin: 12px 0 4px; }
#m-body ul { margin: 4px 0; padding-left: 20px; }
#m-body pre { background: var(--code-bg); border-radius: 6px; padding: 8px 10px; overflow: auto; font-size: 12px; }
#m-body code { background: var(--code-bg); border-radius: 4px; padding: 0 4px; font-size: 12px; }
#m-body pre code { padding: 0; background: none; }
#m-body a { color: var(--link); }
/* one accent color per column, in pipeline order */
.c-backlog { --ac: #94a3b8; }
.c-to-do { --ac: #60a5fa; }
.c-doing { --ac: #818cf8; }
.c-to-review { --ac: #f59e0b; }
.c-reviewing { --ac: #d97706; }
.c-to-live-test { --ac: #14b8a6; }
.c-live-testing { --ac: #0d9488; }
.c-done { --ac: #22c55e; }
</style>
</head>
<body>
<header><h1>Software Engineering LLM Team</h1><span id="updated"></span><button id="theme" onclick="toggleTheme()">Dark</button></header>
<main id="board"></main>
<div id="modal" class="hidden"><div id="m-box">
<div id="m-head"><h2 id="m-title"></h2><button id="m-close" onclick="closeModal()">Close</button></div>
<div id="m-attrs"></div>
<div id="m-body"></div>
</div></div>
<script>
"use strict";
const STATES = ${JSON.stringify(STATES)};
const WORKING = ["doing", "reviewing", "live-testing"];
const VISIBLE = 5;
let tasks = [];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 000042_fix_x.md -> #42; parseInt stops at the first non-digit and drops leading zeros
const num = t => "#" + parseInt(t.file, 10);
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
// minimal Markdown renderer for the board subset (headings, lists, code fences, inline code, bold,
// links, paragraphs); ceiling: swap for a full renderer when the subset grows
const inline = s => s
	.replace(/\`([^\`]+)\`/g, "<code>$1</code>")
	.replace(/\\*\\*([^*]+)\\*\\*/g, "<b>$1</b>")
	.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
function md(src) {
	let html = "", list = false, fence = false;
	const closeList = () => { if (list) { html += "</ul>"; list = false; } };
	for (const line of esc(src).split("\\n")) {
		if (line.trim().slice(0, 3) === "\`\`\`") { closeList(); fence = !fence; html += fence ? "<pre><code>" : "</code></pre>"; continue; }
		if (fence) { html += line + "\\n"; continue; }
		const h = line.match(/^(#{1,6}) (.+)$/);
		if (h) { closeList(); html += "<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"; continue; }
		const li = line.match(/^[-*] (.+)$/);
		if (li) { if (!list) { html += "<ul>"; list = true; } html += "<li>" + inline(li[1]) + "</li>"; continue; }
		closeList();
		if (line.trim()) html += "<p>" + inline(line) + "</p>";
	}
	closeList();
	if (fence) html += "</code></pre>";
	return html;
}
// FLIP across the innerHTML replace: measure old positions, render, invert, play. Only cards whose
// state changed move, so a refresh with no state changes re-animates nothing.
let prevStates = {};
// fold choice keyed by state name, so the 5 s refresh keeps it
const expanded = new Set();
function toggleCol(st) { if (expanded.has(st)) expanded.delete(st); else expanded.add(st); render(); }
function render() {
	const board = document.getElementById("board");
	const states = {};
	for (const t of tasks) states[t.file] = t.state;
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const old = {};
	for (const el of board.querySelectorAll(".card")) {
		el.style.transition = "none";
		el.style.transform = "";
		old[el.dataset.file] = el.getBoundingClientRect();
	}
	board.innerHTML = STATES.map(st => {
		const inState = tasks.filter(t => t.state === st).sort((a, b) => b.updated - a.updated);
		const shown = expanded.has(st) ? inState : inState.slice(0, VISIBLE);
		const cards = shown.map(t =>
			'<div class="card" data-file="' + esc(t.file) + '"><div class="name">' + (WORKING.includes(st) ? '<span class="spin"></span>' : "") + '<span class="num">' + num(t) + "</span>" + esc(t.name) + '</div><span class="chip p-' + esc(t.priority) + '">' + esc(t.priority) + "</span></div>"
		).join("");
		const toggle = inState.length > VISIBLE ? '<button class="toggle" onclick="toggleCol(\\'' + esc(st) + '\\')">' + (expanded.has(st) ? "show less" : "show all (" + inState.length + ")") + "</button>" : "";
		return '<section class="col c-' + st + '"><h2>' + esc(st) + ' <span class="count">' + inState.length + "</span></h2>" + (cards || '<div class="empty">&mdash;</div>') + toggle + "</section>";
	}).join("");
	for (const el of board.querySelectorAll(".card")) {
		el.onclick = () => openTask(el.dataset.file);
		const from = old[el.dataset.file], before = prevStates[el.dataset.file];
		if (!from || before === undefined || before === states[el.dataset.file] || reduced) continue;
		const rect = el.getBoundingClientRect(), dx = from.left - rect.left, dy = from.top - rect.top;
		if (!dx && !dy) continue;
		el.style.transition = "none";
		el.style.transform = "translate(" + dx + "px," + dy + "px)";
		el.getBoundingClientRect();
		el.style.transition = "transform .4s ease";
		el.style.transform = "";
		el.ontransitionend = () => { el.style.transition = ""; el.ontransitionend = null; };
	}
	prevStates = states;
}
function openTask(file) {
	const t = tasks.find(x => x.file === file);
	if (!t) return;
	document.getElementById("m-title").textContent = t.name;
	document.getElementById("m-attrs").innerHTML =
		"<div><span>number</span>" + num(t) + "</div>" +
		"<div><span>file</span>" + esc(t.file) + "</div>" +
		"<div><span>name</span>" + esc(t.name) + "</div>" +
		"<div><span>priority</span><span class='chip p-" + esc(t.priority) + "'>" + esc(t.priority) + "</span></div>" +
		"<div><span>state</span>" + esc(t.state) + "</div>" +
		"<div><span>worktree</span>" + (esc(t.worktree) || "&mdash;") + "</div>";
	document.getElementById("m-body").innerHTML = md(t.body || "");
	document.getElementById("modal").classList.remove("hidden");
}
function closeModal() { document.getElementById("modal").classList.add("hidden"); }
document.getElementById("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
function refresh() {
	fetch("/api/tasks").then(r => r.ok ? r.json() : null).then(data => {
		if (!data) return;
		tasks = data;
		render();
		document.getElementById("updated").textContent = "updated " + new Date().toLocaleTimeString();
	}).catch(() => {});
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
`;

// read-only dashboard server; resolves null on any failure (EADDRINUSE and friends) instead of
// throwing, so the pipeline can log and continue
export function startWebUi(root: string, opts: { host?: string; port?: number } = {}): Promise<{ port: number; close: () => void } | null> {
	const server = createServer((req, res) => {
		res.on("error", () => {}); // client aborted mid-response
		try {
			serve(root, req, res);
		} catch (err) {
			try {
				res.writeHead(500, { "content-type": "text/plain" });
				res.end("web ui error: " + (err instanceof Error ? err.message : String(err)));
			} catch {
				/* headers already sent */
			}
		}
	});
	return new Promise((resolve) => {
		server.on("error", () => resolve(null));
		server.listen(opts.port ?? DEFAULT_PORT, opts.host ?? DEFAULT_HOST, () => {
			const addr = server.address();
			resolve({
				port: addr && typeof addr === "object" ? addr.port : opts.port ?? DEFAULT_PORT,
				close: () => server.close(),
			});
		});
	});
}
