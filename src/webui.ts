import { readFileSync } from "node:fs";
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
					body: taskBody(root, t.file),
				})),
			),
		);
	} else {
		res.writeHead(404).end();
	}
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>se-llm-team board</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #f1f5f9; color: #0f172a; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
header { display: flex; align-items: baseline; gap: 10px; padding: 14px 18px 6px; }
h1 { font-size: 16px; margin: 0; }
#updated { font-size: 12px; color: #64748b; }
#board { display: flex; gap: 10px; padding: 10px 18px 18px; overflow-x: auto; align-items: flex-start; }
.col { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; border-top: 3px solid var(--ac); padding: 10px; min-width: 200px; flex: 1 0 200px; }
.col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 10px; color: #334155; }
.count { color: #94a3b8; }
.card { border: 1px solid #e2e8f0; border-left: 3px solid var(--ac); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; }
.card:hover { background: #f8fafc; }
.name { font-size: 13px; line-height: 1.35; margin-bottom: 6px; }
.chip { font-size: 10px; padding: 1px 7px; border-radius: 999px; background: #e2e8f0; color: #475569; }
.p-low { background: #e2e8f0; color: #475569; }
.p-medium { background: #dbeafe; color: #1d4ed8; }
.p-high { background: #ffedd5; color: #c2410c; }
.p-critical { background: #fee2e2; color: #b91c1c; }
.empty { font-size: 12px; color: #94a3b8; }
#modal { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); display: flex; align-items: center; justify-content: center; }
#modal.hidden { display: none; }
#m-box { background: #fff; border-radius: 10px; padding: 18px; width: min(760px, calc(100vw - 32px)); max-height: 82vh; overflow: auto; }
#m-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
#m-head h2 { font-size: 15px; margin: 0; }
#m-close { border: 1px solid #e2e8f0; background: #fff; border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
#m-close:hover { background: #f1f5f9; }
#m-attrs { font-size: 12px; color: #475569; margin-bottom: 12px; }
#m-attrs div { padding: 3px 0; }
#m-attrs span { display: inline-block; min-width: 80px; color: #94a3b8; }
#m-body { font-size: 13px; line-height: 1.5; }
#m-body h1, #m-body h2, #m-body h3 { font-size: 13px; margin: 12px 0 4px; }
#m-body ul { margin: 4px 0; padding-left: 20px; }
#m-body pre { background: #f1f5f9; border-radius: 6px; padding: 8px 10px; overflow: auto; font-size: 12px; }
#m-body code { background: #f1f5f9; border-radius: 4px; padding: 0 4px; font-size: 12px; }
#m-body pre code { padding: 0; background: none; }
#m-body a { color: #2563eb; }
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
<header><h1>se-llm-team</h1><span id="updated"></span></header>
<main id="board"></main>
<div id="modal" class="hidden"><div id="m-box">
<div id="m-head"><h2 id="m-title"></h2><button id="m-close" onclick="closeModal()">Close</button></div>
<div id="m-attrs"></div>
<div id="m-body"></div>
</div></div>
<script>
"use strict";
const STATES = ${JSON.stringify(STATES)};
let tasks = [];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
function render() {
	const board = document.getElementById("board");
	board.innerHTML = STATES.map(st => {
		const inState = tasks.filter(t => t.state === st);
		const cards = inState.map(t =>
			'<div class="card" data-file="' + esc(t.file) + '"><div class="name">' + esc(t.name) + '</div><span class="chip p-' + esc(t.priority) + '">' + esc(t.priority) + "</span></div>"
		).join("");
		return '<section class="col c-' + st + '"><h2>' + esc(st) + ' <span class="count">' + inState.length + "</span></h2>" + (cards || '<div class="empty">&mdash;</div>') + "</section>";
	}).join("");
	for (const el of board.querySelectorAll(".card")) el.onclick = () => openTask(el.dataset.file);
}
function openTask(file) {
	const t = tasks.find(x => x.file === file);
	if (!t) return;
	document.getElementById("m-title").textContent = t.name;
	document.getElementById("m-attrs").innerHTML =
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
setInterval(refresh, 2000);
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
