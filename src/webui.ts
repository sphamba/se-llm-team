import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { kanbanDir, listAll, PRIORITY_RANK, splitFrontmatter, STATES, taskFiles, taskSlug, type Task } from "./kanban.ts";
import { agentAlive } from "./pid.ts";

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 4242;
export const LOG_CHUNK = 81920;
// working state -> the agent role the orchestrator spawns for it (spawnAgent, src/orchestrator.ts)
const AGENT_ROLE = { doing: "developer", reviewing: "reviewer", "live-testing": "live-tester" };
// the roles the orchestrator writes per task log, in pipeline order, plus the merger
const LOG_ROLES = [...Object.values(AGENT_ROLE), "merger"];
// pi's background Agent tool writes each subagent transcript under this dir and names it in the
// tool result text; both are emergent pi behavior, the parser keys on the text (see subagentLogs)
const SUB_ROOT = "/tmp/pi-subagents-1000/";

// one agent run: run is the index in `<slug>.<role>.<n>.log`, null for a legacy unsuffixed file
interface AgentEntry {
	role: string;
	run: number | null;
	alive: boolean;
	handle: string;
}

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
		return splitFrontmatter(raw)?.body ?? raw;
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

// current agent: the state-mapped role with its pid file liveness, and the handle of the run the
// client should open; the per-run entries below carry the whole history
function agentInfo(root: string, t: Task, agents: AgentEntry[]): { role: string; alive: boolean; log: string } | null {
	const role = AGENT_ROLE[t.state];
	if (!role) return null;
	const own = agents.filter((a) => a.role === role);
	const live = own.find((a) => a.alive);
	return { role, alive: !!live, log: (live ?? own[own.length - 1])?.handle ?? `${taskSlug(t.file)}.${role}` };
}

function logDirFiles(root: string): string[] {
	try {
		return readdirSync(join(kanbanDir(root), ".logs"));
	} catch {
		return []; // no agent has run yet
	}
}

// the indexed run numbers of one role log, ascending: `<slug>.<role>.<n>.log`; a legacy
// unsuffixed file yields "log" here and the digit check drops it
function indexRuns(files: string[], base: string): number[] {
	return files
		.filter((f) => f.startsWith(`${base}.`) && f.endsWith(".log"))
		.map((f) => f.slice(base.length + 1, -4))
		.filter((n) => /^\d+$/.test(n))
		.map(Number)
		.sort((a, b) => a - b);
}

// one entry per existing run log `.logs/<slug>.<role>[.<n>].log`: roles in pipeline order then
// merger, a legacy unsuffixed file before that role's indexed runs, the list then ordered by log
// mtime so the detail card shows the runs oldest-first across roles; equal mtimes keep the
// enumeration order (role order, legacy first, index ascending). Only the newest run of the
// state-mapped role is the live agent
function agentHistory(root: string, t: Task, files: string[]): AgentEntry[] {
	const slug = taskSlug(t.file);
	const liveRole = AGENT_ROLE[t.state];
	const live = !!liveRole && agentAlive(root, slug);
	const entries: (AgentEntry & { mtime: number })[] = [];
	for (const role of LOG_ROLES) {
		const base = `${slug}.${role}`;
		const runs: { run: number | null; handle: string }[] = [];
		if (files.includes(`${base}.log`)) runs.push({ run: null, handle: base });
		for (const n of indexRuns(files, base)) runs.push({ run: n, handle: `${base}.${n}` });
		if (!runs.length) continue;
		const newest = runs[runs.length - 1].handle;
		for (const r of runs) {
			let mtime = 0;
			try {
				mtime = statSync(join(kanbanDir(root), ".logs", `${r.handle}.log`)).mtimeMs;
			} catch {
				/* raced away between readdir and stat */
			}
			entries.push({ role, run: r.run, alive: live && role === liveRole && r.handle === newest, handle: r.handle, mtime });
		}
	}
	return entries.sort((a, b) => a.mtime - b.mtime).map(({ role, run, alive, handle }) => ({ role, run, alive, handle }));
}

// rebuild the log path from the handle: the task must exist on the board and the handle must be
// `<slug>.<role>` or `<slug>.<role>.<n>` for a role the orchestrator actually writes, so a raw
// client-supplied path can never reach the fs
function agentLogPath(root: string, handle: string): string | null {
	const m = handle.match(/^(.+)\.(developer|reviewer|live-tester|merger)(?:\.(\d+))?$/);
	if (!m || !taskFiles(root).includes(`${m[1]}.md`)) return null;
	return join(kanbanDir(root), ".logs", m[3] === undefined ? `${m[1]}.${m[2]}.log` : `${m[1]}.${m[2]}.${m[3]}.log`);
}

// the Agent tool's tool result names the background agent and its .output transcript; ids are in
// log order, so a subagent's number is its index here. Paths come from the log, never the client:
// resolve first, then only pi's own subagent dir and .output transcripts pass
// parsing a parent log is not free (a live-tester log can pass 50 MB), and every panel open asks
// for the list: memoize per path until the file size changes. A log only ever grows
const subsCache = new Map<string, { size: number; subs: { id: string; path: string }[] }>();
function subagentLogs(log: string): { id: string; path: string }[] {
	let text = "";
	let size = 0;
	try {
		size = statSync(log).size;
		const hit = subsCache.get(log);
		if (hit && hit.size === size) return hit.subs;
		text = readFileSync(log, "utf8");
	} catch {
		return []; // parent log gone or not written yet
	}
	const subs: { id: string; path: string }[] = [];
	for (const line of text.split("\n")) {
		if (!line.includes('"tool_execution_end"')) continue; // cheap filter before JSON.parse
		let rec: any;
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		if (rec?.type !== "tool_execution_end") continue;
		const content = rec.result?.content;
		const result: string = Array.isArray(content) ? (content.find((c: any) => c?.type === "text")?.text ?? "") : "";
		const id = result.match(/Agent ID: (\S+)/)?.[1];
		const path = result.match(/Output file: (\S+)/)?.[1];
		const resolved = path ? resolve(path) : "";
		if (!id || !resolved.startsWith(SUB_ROOT) || !resolved.endsWith(".output")) continue;
		subs.push({ id, path: resolved });
	}
	subsCache.set(log, { size, subs });
	return subs;
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
	lines.pop(); // split's last element is the trailing-newline sentinel or a byte-split partial record, not content
	const seenTools = new Set<string>();
	for (const line of lines) {
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

// [decoded text, byte offset just past the window's last newline-terminated record]
function readRange(path: string, start: number, end: number): [string, number] {
	if (end <= start) return ["", start];
	const buf = Buffer.alloc(end - start);
	const fh = openSync(path, "r");
	try {
		const n = readSync(fh, buf, 0, buf.length, start);
		const nl = buf.subarray(0, n).lastIndexOf(0x0a);
		// lenient decode: a multi-byte char split at the chunk edge becomes one replacement glyph
		return [buf.subarray(0, n).toString("utf8"), nl === -1 ? start : start + nl + 1];
	} finally {
		closeSync(fh);
	}
}

// one payload per task, from board files and pid files of one project root; the single-project
// server and the hub's per-project variant both serve it
export function taskPayload(root: string) {
	const files = logDirFiles(root);
	return listAll(root).map((t) => {
		const agents = agentHistory(root, t, files);
		return {
			file: t.file,
			name: t.name,
			priority: t.priority,
			state: t.state,
			worktree: t.worktree,
			blockedBy: t.blockedBy,
			issuer: t.issuer,
			complexity: t.complexity,
			updated: taskUpdated(root, t.file),
			body: taskBody(root, t.file),
			agents,
			agent: agentInfo(root, t, agents),
		};
	});
}

// {status, body} for /api/agent-log against one project root; null = unknown file or handle
// `sub=list` lists the handle's subagent transcripts, `sub=<n>` serves the n-th of them through
// the same chunked payload; no matching record is an empty list, not an error
export function agentLogPayload(root: string, q: URLSearchParams): string | null {
	const log = agentLogPath(root, q.get("file") ?? "");
	if (!log) return null;
	const sub = q.get("sub");
	if (sub === "list") return JSON.stringify(subagentLogs(log).map((s, index) => ({ id: s.id, index })));
	let target = log;
	if (sub !== null) {
		const subIndex = /^\d+$/.test(sub) ? parseInt(sub, 10) : -1;
		const found = subIndex >= 0 ? subagentLogs(log)[subIndex] : undefined;
		if (!found) return null; // no such subagent in this run
		target = found.path;
	}
	const n = parseInt(q.get("offset") ?? "", 10);
	const off = Number.isInteger(n) && n >= 0 ? n : null;
	let head: number, tail: number;
	if (q.get("before") === "1") {
		tail = off ?? 0;
		head = Math.max(0, tail - LOG_CHUNK);
	} else {
		let size = 0;
		try {
			size = statSync(target).size;
		} catch {
			// agent spawned but no output yet
		}
		head = off ? Math.min(off, size) : Math.max(0, size - LOG_CHUNK);
		tail = size;
	}
	let text = "";
	let next = tail;
	try {
		// a finished log's tail is terminal records that render to nothing (assistant
		// message_end, turn_end, agent_end, agent_settled): walk the window back until a
		// chunk renders, so a fresh open or history page never lands on an empty pane; an
		// offset poll keeps its window, the client already consumed the region below its
		// offset and walking back would re-serve it (live watching stays delta-streamed)
		const walk = off == null || q.get("before") === "1";
		for (;;) {
			const [raw, boundary] = readRange(target, head, tail);
			// a forward poll reports a tail on a record boundary: the client's next offset then
			// starts at a whole record, so a record split across two windows is re-read from its
			// start and renders once when its newline arrives, never just as a stripped head line
			if (q.get("before") !== "1") next = boundary;
			text = raw;
			if (head > 0 && readRange(target, head - 1, head)[0] !== "\n") {
				// head lands mid-record: drop the partial head line, only whole records render
				const nl = text.indexOf("\n");
				text = nl === -1 ? "" : text.slice(nl + 1);
			}
			text = renderLogChunk(text);
			if (text || head === 0 || !walk) break;
			head = Math.max(0, head - LOG_CHUNK);
		}
		tail = next;
	} catch {
		// log vanished mid-request
	}
	return JSON.stringify({ text, head, tail, atStart: head === 0 });
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

// html escape, shipped to the client and shared with the tab renderer
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

// a run label on the detail card: the role capitalized, 1-based when the role has several runs
// (payload run 0 reads "1"), unnumbered for a solo run or a legacy unsuffixed log (a.run == null)
export function agentLabel(a, count) {
	return a.role[0].toUpperCase() + a.role.slice(1) + (count[a.role] > 1 && a.run != null ? " " + (a.run + 1) : "");
}

// board layout, left to right: a string is a single column, an array is a stacked pair with the
// first state on top. backlog and done stay single side columns, the states between them stack two
// by two in pipeline order (to-do over doing, to-review over reviewing, ...), so the queued
// to-merge/merging states become another pair with no change here
export function pairLayout(states: readonly string[]): (string | string[])[] {
	const layout: (string | string[])[] = [states[0]];
	const middle = states.slice(1, -1);
	for (let i = 0; i < middle.length; i += 2) {
		const pair = middle.slice(i, i + 2);
		layout.push(pair.length > 1 ? pair : pair[0]);
	}
	layout.push(states[states.length - 1]);
	return layout;
}

// interpolated into PAGE as JSON, so the client renders this exact layout
export const LAYOUT = pairLayout(STATES);

// the spinner marks a task the orchestrator is working on; a task that changes column changes this
// markup, so its animation starts or stops with the state, and prefers-reduced-motion turns the CSS
// animation off underneath
export function spinnerHtml(st: string) {
	return st === "doing" || st === "reviewing" || st === "live-testing" || st === "merging" ? '<span class="spin"></span>' : "";
}

// one card's markup; this string is the card's identity across a refresh, see syncBoard.
// user-issued cards stay full contrast, task-issued ones (issuer "#<num>") dim the name and
// carry a small #<num> badge instead of the plain user chip; the complexity chip renders quiet
// next to the priority chip
export function cardHtml(t: Task, st: string) {
	const issued = !!t.issuer && t.issuer !== "user";
	return (
		'<div class="name' +
		(issued ? " issued" : "") +
		'">' +
		spinnerHtml(st) +
		numLinkHtml(t.file, "num") +
		esc(t.name) +
		'</div><span class="chip p-' +
		esc(t.priority) +
		'">' +
		esc(t.priority) +
		'</span><span class="chip cx">' +
		esc(t.complexity || "moderate") +
		'</span><span class="chip' +
		(issued ? " issuer" : "") +
		'">' +
		(issued ? esc(t.issuer) : "user") +
		"</span>"
	);
}

// a task id as a link: clicking opens that task's card in place of the shown one; data-task carries
// the file for the post-render binding, never an inline onclick (file names can hold quotes); the
// card's own id opens its own card, a blockedBy ref opens the referenced task's card
export function numLinkHtml(file: string, cls = "") {
	return '<span class="num-link' + (cls ? " " + cls : "") + '" data-task="' + esc(file) + '">#' + parseInt(file, 10) + "</span>";
}

// the bezier between two rendered cards, running blocked -> blocker so the dash animation flows
// towards the blocker: a loop out of the right sides within one column, otherwise the side pair
// that minimizes the line (blocker left of blocked: blocked's left edge to the blocker's right
// edge, reversed when the blocker sits to the right)
export function curve(from, to, same) {
	const mid = (r) => r.y + r.h / 2;
	const bow = 40;
	let x1, y1, x2, y2, c1x, c2x;
	if (same) {
		x1 = from.x + from.w;
		y1 = mid(from);
		x2 = to.x + to.w;
		y2 = mid(to);
		c1x = x1 + bow;
		c2x = x2 + bow;
	} else if (to.x < from.x) {
		x1 = from.x;
		y1 = mid(from);
		x2 = to.x + to.w;
		y2 = mid(to);
		c1x = x1 - bow;
		c2x = x2 + bow;
	} else {
		x1 = from.x + from.w;
		y1 = mid(from);
		x2 = to.x;
		y2 = mid(to);
		c1x = x1 + bow;
		c2x = x2 - bow;
	}
	return "M " + x1 + " " + y1 + " C " + c1x + " " + y1 + ", " + c2x + " " + y2 + ", " + x2 + " " + y2;
}

// one curve per stored relation the board can draw: the blocked task's card to each blocking
// task's card, both currently rendered. A "#<num>" ref maps to its task via parseInt(file); a ref
// without a rendered card is skipped, and a done blocker draws nothing. Stacked pair columns
// share one x, which counts as the same column (the right-side loop, never a line through the cards).
export function relationPaths(tasks, rectOf) {
	const out = [];
	for (const t of tasks) {
		const from = rectOf(t.file);
		if (!from) continue;
		for (const raw of String(t.blockedBy || "").split(",")) {
			const ref = raw.trim();
			if (!ref) continue;
			const blocker = tasks.find((x) => parseInt(x.file, 10) === parseInt(ref.replace(/^#/, ""), 10));
			if (!blocker || blocker.state === "done") continue;
			const to = rectOf(blocker.file);
			if (!to) continue;
			out.push(curve(from, to, t.state === blocker.state || Math.abs(to.x - from.x) < 1));
		}
	}
	return out;
}

// the board shell, built once: a single column per layout string, one .pair wrapper per stacked
// pair; returns each column's parts, keyed by state
export function buildShell(parent, doc) {
	const cols = {};
	const column = (st: string) => {
		const col = doc.createElement("section");
		col.className = "col c-" + st;
		const h2 = doc.createElement("h2");
		h2.textContent = st + " ";
		const count = doc.createElement("span");
		count.className = "count";
		h2.appendChild(count);
		const cards = doc.createElement("div");
		cards.className = "cards";
		const empty = doc.createElement("div");
		empty.className = "empty";
		empty.textContent = "\u2014";
		cards.appendChild(empty);
		const toggle = doc.createElement("button");
		toggle.className = "toggle";
		toggle.style.display = "none";
		col.appendChild(h2);
		col.appendChild(cards);
		col.appendChild(toggle);
		cols[st] = { col, count, cards, empty, toggle };
		return col;
	};
	for (const part of LAYOUT) {
		if (typeof part === "string") {
			parent.appendChild(column(part));
			continue;
		}
		const pair = doc.createElement("div");
		pair.className = "pair";
		for (const st of part) pair.appendChild(column(st));
		parent.appendChild(pair);
	}
	return cols;
}

// one refresh pass: place every task's card in its column and update counts and the fold toggle. A
// card is rewritten only when its markup changed, so an unchanged card keeps its DOM node and with
// it its running spinner animation and in-flight FLIP transform; orders are fixed by moving nodes,
// so a card entering a column never rebuilds the cards already in it. The caller measures card
// positions before and after this pass to animate the moves
export function syncBoard(cols, tasks, expanded, els, make, visible) {
	// backlog is priority-first (critical above high above medium above low), every other column is
	// newest-first only; the sort is stable and the payload arrives in task-number order, so equal
	// keys keep that order
	const live = new Set();
	for (const st of Object.keys(cols)) {
		const inState = tasks
			.filter((t) => t.state === st)
			.sort((a, b) => (st === "backlog" ? (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4) : 0) || b.updated - a.updated);
		const shown = expanded.has(st) ? inState : inState.slice(0, visible);
		const part = cols[st];
		part.count.textContent = inState.length;
		part.empty.style.display = shown.length ? "none" : "";
		part.toggle.style.display = inState.length > visible ? "" : "none";
		part.toggle.textContent = expanded.has(st) ? "show less" : "show all (" + inState.length + ")";
		let prev = null;
		for (const t of shown) {
			live.add(t.file);
			let el = els.get(t.file);
			if (!el) {
				el = make(t.file);
				els.set(t.file, el);
			}
			const html = cardHtml(t, st);
			if (el.__html !== html) {
				el.innerHTML = html;
				el.__html = html;
			}
			const next = prev ? prev.nextSibling : part.cards.firstChild;
			if (next !== el) part.cards.insertBefore(el, next);
			prev = el;
		}
	}
	for (const [file, el] of els) {
		if (live.has(file)) continue;
		el.remove();
		els.delete(file);
	}
}

// served by the single-project server and by the hub for every registered project; the tab bar
// comes from the hub's /api/projects and each tab polls /api/tasks?project=<root id>
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
#relations path { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 6 4; animation: dashflow 1s linear infinite; }
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
.p-low { background: var(--low-bg); color: var(--low-fg); }
.p-medium { background: var(--medium-bg); color: var(--medium-fg); }
.p-high { background: var(--high-bg); color: var(--high-fg); }
.p-critical { background: var(--critical-bg); color: var(--critical-fg); }
.empty { font-size: 12px; color: var(--faint); }
.toggle { display: block; width: 100%; margin-top: 2px; border: 1px solid var(--border); background: var(--panel); color: var(--link); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.toggle:hover { background: var(--hover); }
.agent-btn { display: inline-flex; align-items: center; border: 1px solid var(--border); background: var(--panel); color: var(--link); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.agent-btn:hover { background: var(--hover); }
.agent-btn-active { border-color: var(--link); }
.agent-btn.agent-btn-active { background: var(--medium-bg); }
#m-sub-btns { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 6px; }
#m-sub-btns:empty { display: none; }
#m-agent-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.check { color: var(--low-fg); margin-right: 5px; }
#m-agent { margin-bottom: 12px; }
#m-agent:empty { display: none; }
#m-log { margin-top: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--code-bg); max-height: 300px; overflow: auto; }
#m-log.hidden { display: none; }
#m-log pre { margin: 0; padding: 8px 10px; font-size: 10px; line-height: 1.45; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: break-word; }
#modal { position: fixed; inset: 0; z-index: 3; background: var(--overlay); display: flex; align-items: center; justify-content: center; }
#modal.hidden { display: none; }
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
#m-body a { color: var(--link); }
/* one accent color per column, in pipeline order */
.c-backlog { --ac: #94a3b8; }
.c-to-do { --ac: #60a5fa; }
.c-doing { --ac: #818cf8; }
.c-to-review { --ac: #f59e0b; }
.c-reviewing { --ac: #d97706; }
.c-to-live-test { --ac: #14b8a6; }
.c-live-testing { --ac: #0d9488; }
.c-to-merge { --ac: #d946ef; }
.c-merging { --ac: #c026d3; }
.c-done { --ac: #22c55e; }
</style>
</head>
<body>
<header><h1>Software Engineering LLM Team</h1><span id="updated"></span><button id="theme" onclick="toggleTheme()">Dark</button></header>
<nav id="tabs"></nav>
<main id="board"></main>
<div id="modal" class="hidden"><div id="m-box">
<div id="m-head"><h2 id="m-title"></h2><button id="m-close" onclick="closeModal()">Close</button></div>
<div id="m-attrs"></div>
<div id="m-agent"></div>
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
${cardHtml}
${buildShell}
${syncBoard}
${tabNames}
${tabsHtml}
${boardOf}
${mergeBoards}
${agentLabel}
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
	const html = paths.map(d => '<path d="' + d + '"/>').join("");
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
	syncBoard(cols, tab.tasks, tab.expanded, cardEls, makeCard, VISIBLE);
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
function openTask(file) {
	const t = activeBoard().tasks.find(x => x.file === file);
	if (!t) return;
	closeLog();
	modalFile = file;
	document.getElementById("m-title").textContent = t.name;
	document.getElementById("m-attrs").innerHTML =
		"<div><span>number</span>" + numLinkHtml(t.file) + "</div>" +
		"<div><span>file</span>" + esc(t.file) + "</div>" +
		"<div><span>priority</span><span class='chip p-" + esc(t.priority) + "'>" + esc(t.priority) + "</span></div>" +
		"<div><span>complexity</span><span class='chip cx'>" + esc(t.complexity || "moderate") + "</span></div>" +
		"<div><span>state</span>" + esc(t.state) + "</div>" +
		"<div><span>worktree</span>" + (esc(t.worktree) || "&mdash;") + "</div>" +
		"<div><span>issuer</span>" + esc(t.issuer || "user") + "</div>" +
		blockedRow(t);
	for (const a of document.querySelectorAll("#m-attrs .num-link")) a.onclick = () => openTask(a.dataset.task);
	renderAgent(t);
	document.getElementById("m-body").innerHTML = md(t.body || "");
	document.getElementById("modal").classList.remove("hidden");
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
// live agent log pane: each run button carries only its handle, the server resolves the real
// path; a run's subagent transcripts load through the same endpoint with sub=list / sub=n
let modalFile = null;
let logTimer = null;
let logState = null;
const logPane = () => document.getElementById("m-log");
const projectParam = () => (active ? "&project=" + encodeURIComponent(active) : "");
const logUrl = extra => "?file=" + encodeURIComponent(logState.handle) + (logState.sub == null ? "" : "&sub=" + logState.sub) + extra + projectParam();
function markActiveAgent() {
	const p = logPane();
	const st = logState && p && !p.classList.contains("hidden") ? logState : null;
	for (const b of document.querySelectorAll("#m-agent .agent-btn")) {
		const active = !!st && b.dataset.handle === st.handle && (b.dataset.sub || null) === (st.sub == null ? null : String(st.sub));
		b.classList.toggle("agent-btn-active", active);
	}
}
const atBottom = () => { const p = logPane(); return p.scrollTop + p.clientHeight >= p.scrollHeight - 4; };
// every run as one button, oldest leftmost (payload order is log mtime order), the live run
// rightmost; a role with several runs labels them 1-based, so two reviewer runs never read alike
function renderAgent(t) {
	const el = document.getElementById("m-agent");
	el.innerHTML = "";
	const runs = (t.agents || []).slice();
	const live = runs.find(a => a.alive);
	if (live) { runs.splice(runs.indexOf(live), 1); runs.push(live); }
	if (!runs.length) return;
	const count = {};
	for (const a of runs) count[a.role] = (count[a.role] || 0) + 1;
	const label = a => agentLabel(a, count);
	const btns = runs.map(a => !a.alive
		? '<button class="agent-btn agent-past" data-handle="' + esc(a.handle) + '"><span class="check">\u2713</span>' + esc(label(a)) + "</button>"
		: '<button class="agent-btn agent-live" data-handle="' + esc(a.handle) + '"><span class="spin"></span>' + esc(label(a)) + "</button>");
	el.innerHTML = '<div id="m-agent-btns">' + btns.join("") + '</div><div id="m-sub-btns"></div><div id="m-log" class="hidden"><pre id="m-log-text"></pre></div>';
	// bind by dataset: a hand-written task file name can hold quotes or backslashes, which no
	// amount of HTML escaping makes safe inside inline JS
	for (const b of el.querySelectorAll("#m-agent-btns .agent-btn")) b.onclick = () => openAgentLog(b.dataset.handle);
	markActiveAgent();
	const p = logPane();
	p.onscroll = () => {
		if (!logState || logState.busy || logState.atStart || p.scrollTop > 0) return;
		pullLog(logUrl("&offset=" + logState.head + "&before=1"), "history");
	};
}
// the selected run's subagents: one button per background Agent call, stacked vertically below
// the run row in log order
function renderSubs(list) {
	const el = document.getElementById("m-sub-btns");
	if (!el || !logState) return;
	el.innerHTML = list.map(s => '<button class="agent-btn agent-sub" data-handle="' + esc(logState.handle) + '" data-sub="' + s.index + '">' + esc(s.id) + "</button>").join("");
	for (const b of el.querySelectorAll(".agent-btn")) b.onclick = () => openSubLog(Number(b.dataset.sub));
	markActiveAgent();
}
function fetchSubs() {
	const handle = logState && logState.handle;
	if (!handle) return;
	fetch("/api/agent-log?file=" + encodeURIComponent(handle) + "&sub=list" + projectParam()).then(r => r.ok ? r.json() : []).then(list => {
		// a superseded open must not write into the new view
		if (!logState || logState.handle !== handle) return;
		renderSubs(Array.isArray(list) ? list : []);
	}).catch(() => {});
}
function openAgentLog(handle) {
	if (logState && logState.handle === handle && logState.sub == null && !logPane().classList.contains("hidden")) { closeLog(); return; }
	openLog(handle, null);
}
function openSubLog(n) {
	if (logState && logState.sub === n && !logPane().classList.contains("hidden")) { closeLog(); return; }
	const handle = logState && logState.handle;
	if (handle) openLog(handle, n);
}
function openLog(handle, sub) {
	const t = activeBoard().tasks.find(x => x.file === modalFile);
	const p = logPane();
	if (!t || !p) return;
	p.classList.remove("hidden");
	logState = { handle, sub: sub == null ? null : sub, head: 0, tail: 0, atStart: false, busy: false, idle: false };
	if (sub == null) fetchSubs(); // the sub list belongs to the run, a sub click keeps it
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
	const subs = document.getElementById("m-sub-btns");
	if (subs) subs.innerHTML = "";
	markActiveAgent();
}
function pollLog() {
	if (!logState || logState.busy) return;
	const t = activeBoard().tasks.find(x => x.file === modalFile);
	const liveRun = t && (t.agents || []).find(a => a.alive);
	// only the live run's own log keeps writing; a subagent transcript is written once
	const live = logState.sub == null && !!liveRun && liveRun.handle === logState.handle;
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
		// stamp only a served board: during a hub outage the old stamp stays visible
		const current = rows.find(([id]) => id === active);
		if (current && current[1]) document.getElementById("updated").textContent = "updated " + new Date().toLocaleTimeString();
	}).catch(() => {});
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
`;
