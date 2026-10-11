import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { kanbanDir, listAll, STATES, taskFiles, type Task } from "./kanban.ts";

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 4242;
export const LOG_CHUNK = 81920;
// working state -> the agent role the orchestrator spawns for it (spawnAgent, src/orchestrator.ts)
const AGENT_ROLE = { doing: "developer", reviewing: "reviewer", "live-testing": "live-tester" };
// the roles the orchestrator writes per task log, in pipeline order
const PIPELINE_ROLES = Object.values(AGENT_ROLE);

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

// mirror of orchestrator.ts pidAlive; webui and hub cannot import orchestrator (it imports webui),
// so this copy is shared with hub.ts
export function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM"; // exists but not signalable: still alive
	}
}

// the orchestrator's pid file (.kanban/.pids/{slug}.pid) holds the current agent's pid
function currentPid(root: string, slug: string): number {
	try {
		return parseInt(readFileSync(join(kanbanDir(root), ".pids", `${slug}.pid`), "utf8").trim(), 10) || 0;
	} catch {
		return 0; // no agent spawned yet, or the pid file was already cleared
	}
}

// role + liveness from the working state and the orchestrator's pid file (.kanban/.pids/{slug}.pid);
// log is only a handle for the client, the real path is rebuilt server-side in agentLogPath
function agentInfo(root: string, t: Task): { role: string; alive: boolean; log: string } | null {
	const role = AGENT_ROLE[t.state];
	if (!role) return null;
	const slug = t.file.replace(/\.md$/, "");
	return { role, alive: pidAlive(currentPid(root, slug)), log: `${slug}.${role}` };
}

// one entry per existing role log file: only the state-mapped role with a live pid is alive,
// every other existing role is a past agent
function agentHistory(root: string, t: Task): { role: string; alive: boolean }[] {
	const slug = t.file.replace(/\.md$/, "");
	const liveRole = AGENT_ROLE[t.state];
	return PIPELINE_ROLES.filter((role) => existsSync(join(kanbanDir(root), ".logs", `${slug}.${role}.log`)))
		.map((role) => ({ role, alive: role === liveRole && pidAlive(currentPid(root, slug)) }));
}

// rebuild the log path from the handle: the task must exist on the board and the suffix must be a
// role the orchestrator actually writes, so a raw client-supplied path can never reach the fs
function agentLogPath(root: string, handle: string): string | null {
	const m = handle.match(/^(.+)\.(developer|reviewer|live-tester)$/);
	if (!m || !taskFiles(root).includes(`${m[1]}.md`)) return null;
	return join(kanbanDir(root), ".logs", `${m[1]}.${m[2]}.log`);
}

// pi --mode json writes JSONL event records (docs/json.md); everything else in the log file is
// non-JSON: stderr diagnostics and legacy print-mode final text. One tool line per call: the
// streamed toolcall_end and the execution start both carry name + args, so dedupe by id within
// the chunk. An assistant message_end repeats its streamed text deltas, so only the user prompt
// (the run's opening message) renders from message_end.
const ARG_KEYS = ["command", "path", "file_path", "pattern", "url", "query"];
const cap = (s: string, max = 160) => (s.length > max ? s.slice(0, max - 3) + "..." : s);

function argSummary(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const rec = args as Record<string, unknown>;
	let value: unknown;
	for (const key of ARG_KEYS) {
		if (typeof rec[key] === "string" && rec[key]) {
			value = rec[key];
			break;
		}
	}
	value ??= Object.values(rec).find((v) => typeof v === "string" && v);
	return typeof value === "string" ? cap(value.replace(/\s+/g, " ").trim()) : "";
}

function textOf(result: unknown): string {
	const content = (result as { content?: { type?: string; text?: string }[] } | undefined)?.content;
	const text = Array.isArray(content) ? content.find((c) => c?.type === "text")?.text : undefined;
	return typeof text === "string" ? cap(text.replace(/\s+/g, " ").trim(), 200) : "";
}

export function renderLogChunk(text: string): string {
	const out: string[] = [];
	let pending = "";
	const flush = () => {
		if (pending) {
			out.push(pending + "\n");
			pending = "";
		}
	};
	const lines = text.split("\n");
	if (lines[lines.length - 1] !== "") lines.pop(); // the byte boundary split a record: drop the partial
	const seenTools = new Set<string>();
	for (const line of lines) {
		if (!line) continue;
		let rec: Record<string, any>;
		try {
			rec = JSON.parse(line);
		} catch {
			flush();
			out.push(line + "\n");
			continue;
		}
		if (!rec || typeof rec !== "object") {
			flush();
			out.push(line + "\n");
			continue;
		}
		if (rec.type === "message_update") {
			const ev = rec.assistantMessageEvent;
			if (!ev || typeof ev !== "object") continue;
			if (ev.type === "thinking_start") {
				flush();
				out.push("── thinking ──\n");
			} else if (ev.type === "thinking_delta" || ev.type === "text_delta") {
				pending += ev.delta ?? "";
			} else if (ev.type === "text_start") {
				flush();
			} else if (ev.type === "toolcall_end") {
				const id = ev.toolCall?.id;
				if (typeof id === "string" && !seenTools.has(id)) {
					seenTools.add(id);
					flush();
					const summary = argSummary(ev.toolCall.arguments);
					out.push("[tool] " + (ev.toolCall.name ?? "?") + (summary ? ": " + summary : "") + "\n");
				}
			}
		} else if (rec.type === "tool_execution_start") {
			if (typeof rec.toolCallId === "string" && !seenTools.has(rec.toolCallId)) {
				seenTools.add(rec.toolCallId);
				flush();
				const summary = argSummary(rec.args);
				out.push("[tool] " + (rec.toolName ?? "?") + (summary ? ": " + summary : "") + "\n");
			}
		} else if (rec.type === "tool_execution_end" && rec.isError === true) {
			flush();
			const err = textOf(rec.result);
			out.push("[tool] " + (rec.toolName ?? "?") + " failed" + (err ? ": " + err : "") + "\n");
		} else if (rec.type === "message_end") {
			const msg = rec.message;
			if (msg?.role === "user" && typeof msg.content === "string" && msg.content.trim()) {
				flush();
				out.push("[prompt] " + cap(msg.content.replace(/\s+/g, " ").trim()) + "\n");
			}
		}
	}
	flush();
	return out.join("");
}

function readRange(path: string, start: number, end: number): string {
	if (end <= start) return "";
	const buf = Buffer.alloc(end - start);
	const fh = openSync(path, "r");
	try {
		const n = readSync(fh, buf, 0, buf.length, start);
		// lenient decode: a multi-byte char split at the chunk edge becomes one replacement glyph
		return buf.subarray(0, n).toString("utf8");
	} finally {
		closeSync(fh);
	}
}

// one payload per task, from board files and pid files of one project root; the single-project
// server and the hub's per-project variant both serve it
export function taskPayload(root: string) {
	return listAll(root).map((t) => ({
		file: t.file,
		name: t.name,
		priority: t.priority,
		state: t.state,
		worktree: t.worktree,
		updated: taskUpdated(root, t.file),
		body: taskBody(root, t.file),
		agents: agentHistory(root, t),
		agent: agentInfo(root, t),
	}));
}

// {status, body} for /api/agent-log against one project root; null = unknown file or handle
export function agentLogPayload(root: string, q: URLSearchParams): string | null {
	const log = agentLogPath(root, q.get("file") ?? "");
	if (!log) return null;
	const n = parseInt(q.get("offset") ?? "", 10);
	const off = Number.isInteger(n) && n >= 0 ? n : null;
	let head: number, tail: number;
	if (q.get("before") === "1") {
		tail = off ?? 0;
		head = Math.max(0, tail - LOG_CHUNK);
	} else {
		let size = 0;
		try {
			size = statSync(log).size;
		} catch {
			// agent spawned but no output yet
		}
		head = off ? Math.min(off, size) : Math.max(0, size - LOG_CHUNK);
		tail = size;
	}
	let text = "";
	try {
		// a finished log's tail is terminal records that render to nothing (assistant
		// message_end, turn_end, agent_end, agent_settled): walk the window back until a
		// chunk renders, so a fresh open or history page never lands on an empty pane; an
		// offset poll keeps its window, the client already consumed the region below its
		// offset and walking back would re-serve it (live watching stays delta-streamed)
		const walk = off == null || q.get("before") === "1";
		for (;;) {
			text = readRange(log, head, tail);
			if (head > 0 && readRange(log, head - 1, head) !== "\n") {
				// head lands mid-record: drop the partial head line, only whole records render
				const nl = text.indexOf("\n");
				text = nl === -1 ? "" : text.slice(nl + 1);
			}
			text = renderLogChunk(text);
			if (text || head === 0 || !walk) break;
			head = Math.max(0, head - LOG_CHUNK);
		}
	} catch {
		// log vanished mid-request
	}
	return JSON.stringify({ text, head, tail, atStart: head === 0 });
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
		res.end(JSON.stringify(taskPayload(root)));
	} else if (path === "/api/agent-log") {
		const payload = agentLogPayload(root, new URLSearchParams((req.url ?? "").split("?")[1] ?? ""));
		if (!payload) {
			res.writeHead(404).end();
		} else {
			res.writeHead(200, { "content-type": "application/json; charset=utf-8", connection: "close" });
			res.end(payload);
		}
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

// FLIP diff, interpolated into PAGE so the client ships this exact source: which files changed
// board-content position between renders; new files and unchanged positions get no transform
export function flipDiff(oldPos, newPos) {
	const diff = {};
	for (const file in newPos) {
		const from = oldPos[file];
		if (!from) continue;
		const dx = from.x - newPos[file].x, dy = from.y - newPos[file].y;
		if (dx || dy) diff[file] = { dx, dy };
	}
	return diff;
}

// served by the single-project server and by the hub for every registered project (000039 makes it tabbed)
export const PAGE = `<!doctype html>
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
html, body { height: 100%; }
body { display: flex; flex-direction: column; margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
header { display: flex; align-items: baseline; gap: 10px; padding: 14px 18px 6px; background: var(--code-bg); }
h1 { font-size: 16px; margin: 0; }
#theme { margin-left: auto; border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
#theme:hover { background: var(--hover); }
#updated { font-size: 12px; color: var(--muted); }
#board { flex: 1 1 auto; min-height: 0; display: flex; gap: 10px; padding: 10px 18px 18px; overflow-x: auto; align-items: flex-start; }
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
.agent-btn { display: inline-flex; align-items: center; border: 1px solid var(--border); background: var(--panel); color: var(--link); border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 10px; }
.agent-btn:hover { background: var(--hover); }
.agent-btn-active { border-color: var(--link); }
.agent-btn.agent-btn-active { background: var(--medium-bg); }
.agent-past { display: flex; width: fit-content; margin-top: 6px; }
.agent-live { margin-top: 6px; }
.check { color: var(--low-fg); margin-right: 5px; }
#m-agent { margin-bottom: 12px; }
#m-agent:empty { display: none; }
#m-log { margin-top: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--code-bg); max-height: 300px; overflow: auto; }
#m-log.hidden { display: none; }
#m-log pre { margin: 0; padding: 8px 10px; font-size: 12px; line-height: 1.45; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: break-word; }
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
<div id="m-agent"></div>
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
// FLIP across the innerHTML replace: measure old positions, render, invert, play. Every card whose
// board-content position changed moves, the siblings shifting when a card enters or leaves a
// column included; positions are board-content relative, so a scrolled refresh animates nothing.
${flipDiff}
// fold choice keyed by state name, so the 5 s refresh keeps it
const expanded = new Set();
function toggleCol(st) { if (expanded.has(st)) expanded.delete(st); else expanded.add(st); render(); }
function render() {
	const board = document.getElementById("board");
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	// board-content relative: page scroll cancels, board scroll is added back, so a refresh after
	// scrolling measures identical positions and animates nothing
	const boardRect = board.getBoundingClientRect();
	const pos = el => { const r = el.getBoundingClientRect(); return { x: r.left - boardRect.left + board.scrollLeft, y: r.top - boardRect.top + board.scrollTop }; };
	const old = {};
	for (const el of board.querySelectorAll(".card")) {
		el.style.transition = "none";
		el.style.transform = "";
		old[el.dataset.file] = pos(el);
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
	const now = {};
	for (const el of board.querySelectorAll(".card")) {
		el.onclick = () => openTask(el.dataset.file);
		now[el.dataset.file] = pos(el);
	}
	const diff = flipDiff(old, now);
	for (const el of board.querySelectorAll(".card")) {
		const d = diff[el.dataset.file];
		if (!d || reduced) continue;
		el.style.transition = "none";
		el.style.transform = "translate(" + d.dx + "px," + d.dy + "px)";
		el.getBoundingClientRect();
		el.style.transition = "transform .4s ease";
		el.style.transform = "";
		el.ontransitionend = () => { el.style.transition = ""; el.ontransitionend = null; };
	}
}
function openTask(file) {
	const t = tasks.find(x => x.file === file);
	if (!t) return;
	closeLog();
	modalFile = file;
	document.getElementById("m-title").textContent = t.name;
	document.getElementById("m-attrs").innerHTML =
		"<div><span>number</span>" + num(t) + "</div>" +
		"<div><span>file</span>" + esc(t.file) + "</div>" +
		"<div><span>name</span>" + esc(t.name) + "</div>" +
		"<div><span>priority</span><span class='chip p-" + esc(t.priority) + "'>" + esc(t.priority) + "</span></div>" +
		"<div><span>state</span>" + esc(t.state) + "</div>" +
		"<div><span>worktree</span>" + (esc(t.worktree) || "&mdash;") + "</div>";
	renderAgent(t);
	document.getElementById("m-body").innerHTML = md(t.body || "");
	document.getElementById("modal").classList.remove("hidden");
}
function closeModal() { closeLog(); document.getElementById("modal").classList.add("hidden"); }
// live agent log pane: the button carries only the handle, the server resolves the real path
let modalFile = null;
let logTimer = null;
let logState = null;
const logPane = () => document.getElementById("m-log");
function markActiveAgent() {
	const p = logPane();
	const role = logState && p && !p.classList.contains("hidden") ? logState.role : null;
	for (const b of document.querySelectorAll("#m-agent .agent-btn")) b.classList.toggle("agent-btn-active", b.dataset.role === role);
}
const atBottom = () => { const p = logPane(); return p.scrollTop + p.clientHeight >= p.scrollHeight - 4; };
function renderAgent(t) {
	const el = document.getElementById("m-agent");
	el.innerHTML = "";
	const cap = s => s[0].toUpperCase() + s.slice(1);
	const btns = [];
	for (const a of (t.agents || []).filter(a => !a.alive)) btns.push('<button class="agent-btn agent-past" data-role="' + esc(a.role) + '" onclick="openAgentLog(\\'' + esc(a.role) + '\\')"><span class="check">\u2713</span>' + esc(cap(a.role)) + "</button>");
	if (t.agent && t.agent.alive) btns.push('<button class="agent-btn agent-live" data-role="' + esc(t.agent.role) + '" onclick="openAgentLog(\\'' + esc(t.agent.role) + '\\')"><span class="spin"></span>' + esc(cap(t.agent.role)) + "</button>");
	if (!btns.length) return;
	el.innerHTML = btns.join("") + '<div id="m-log" class="hidden"><pre id="m-log-text"></pre></div>';
	markActiveAgent();
	const p = logPane();
	p.onscroll = () => {
		if (!logState || logState.busy || logState.atStart || p.scrollTop > 0) return;
		pullLog("?file=" + encodeURIComponent(logState.handle) + "&offset=" + logState.head + "&before=1", "history");
	};
}
function openAgentLog(role) {
	if (logState && logState.role === role && !logPane().classList.contains("hidden")) { closeLog(); return; }
	openLog(role);
}
function openLog(role) {
	const t = tasks.find(x => x.file === modalFile);
	const p = logPane();
	if (!t || !p) return;
	p.classList.remove("hidden");
	logState = { handle: t.file.replace(/\\.md$/, "") + "." + role, role, head: 0, tail: 0, atStart: false, busy: false, idle: false };
	markActiveAgent();
	pullLog("?file=" + encodeURIComponent(logState.handle), "init");
	if (logTimer) clearInterval(logTimer);
	logTimer = setInterval(pollLog, 1000);
}
function closeLog() {
	if (logTimer) { clearInterval(logTimer); logTimer = null; }
	logState = null;
	const p = logPane();
	if (p) p.classList.add("hidden");
	markActiveAgent();
}
function pollLog() {
	if (!logState || logState.busy) return;
	const t = tasks.find(x => x.file === modalFile);
	const live = !!(t && t.agent && t.agent.alive && t.agent.role === logState.role);
	// past agents write no lines: one empty poll is proof, stop the timer
	if (!live && logState.idle) {
		if (logTimer) { clearInterval(logTimer); logTimer = null; }
		return;
	}
	const p = logPane();
	// a scroll-to-top can land in a busy poll window and never re-fire; the tick retries history
	if (p && p.scrollTop === 0 && !logState.atStart) {
		pullLog("?file=" + encodeURIComponent(logState.handle) + "&offset=" + logState.head + "&before=1", "history");
		return;
	}
	pullLog("?file=" + encodeURIComponent(logState.handle) + "&offset=" + logState.tail, "poll");
}
function pullLog(qs, mode) {
	const st = logState;
	if (!st) return;
	st.busy = true;
	const p = logPane();
	fetch("/api/agent-log" + qs).then(r => r.ok ? r.json() : null).then(d => {
		// a superseded open must not write into the new view
		if (!d || logState !== st || !p || p.classList.contains("hidden")) return;
		const el = document.getElementById("m-log-text");
		if (mode === "history") {
			st.head = d.head;
			st.atStart = d.atStart;
			if (d.text) {
				const before = p.scrollHeight;
				el.textContent = d.text + el.textContent;
				p.scrollTop += p.scrollHeight - before;
			}
		} else {
			st.tail = d.tail;
			if (mode === "poll") st.idle = !d.text;
			if (mode === "init") {
				st.head = d.head;
				st.atStart = d.atStart;
				el.textContent = d.text;
				p.scrollTop = p.scrollHeight;
			} else if (d.text) {
				const stick = atBottom();
				el.textContent += d.text;
				if (stick) p.scrollTop = p.scrollHeight;
			}
		}
	}).catch(() => {}).finally(() => { if (logState === st) st.busy = false; });
}
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
