import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
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

// one agent run: run is the index in `<slug>.<role>.<n>.log`, null for a legacy unsuffixed file;
// tokens sums the run's turn_end totals, duration is the last record timestamp minus the first,
// both null when the log carries none; status is live for the newest run of the live role, dead
// when the bounce left a sibling .dead marker, ok when the run advanced the state itself
interface AgentEntry {
	role: string;
	run: number | null;
	alive: boolean;
	status: "live" | "dead" | "ok";
	handle: string;
	tokens: number | null;
	duration: number | null;
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

// the physical file of a run log base ("<slug>.<role>" or "<slug>.<role>.<n>"): the plain .log
// while it exists (a live run's, or a finished one the sweep has not gzipped yet), else the
// sweep's .log.gz replacement
function runLogPath(dir: string, base: string): string {
	const plain = join(dir, `${base}.log`);
	return existsSync(plain) ? plain : `${plain}.gz`;
}

// the full text of a log path: a .gz log is a finished, immutable run, decompressed whole per
// read; plain logs read as utf8 (the chunked payload streams a live tail by byte range)
function logText(path: string): string | null {
	try {
		return path.endsWith(".gz") ? gunzipSync(readFileSync(path)).toString("utf8") : readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

// the indexed run numbers of one role log, ascending: `<slug>.<role>.<n>.log` and the sweep's
// .log.gz replacement; a legacy unsuffixed file yields "log" here and the digit check drops it
function indexRuns(files: string[], base: string): number[] {
	return files
		.filter((f) => f.startsWith(`${base}.`))
		.map((f) => f.slice(base.length + 1).match(/^(\d+)\.log(?:\.gz)?$/))
		.filter((m): m is RegExpMatchArray => !!m)
		.map((m) => Number(m[1]))
		.sort((a, b) => a - b);
}

// one entry per existing run log `.logs/<slug>.<role>[.<n>].log`: roles in pipeline order then
// merger, a legacy unsuffixed file before that role's indexed runs, the list then ordered by the
// first in-log record timestamp so the detail card shows the runs oldest-first across roles; the
// gzip sweep rewrites finished logs' mtimes in readdir order (compactFinishedLogs), so mtime no
// longer reflects chronology once a run is swept; a log with no parseable timestamp (a legacy
// unsuffixed log carries none) falls back to its mtime, equal keys keep the enumeration order
// (role order, legacy first, index ascending). Only the newest run of the state-mapped role is the
// live agent
function agentHistory(root: string, t: Task, files: string[]): AgentEntry[] {
	const slug = taskSlug(t.file);
	const dir = join(kanbanDir(root), ".logs");
	const liveRole = AGENT_ROLE[t.state];
	const live = !!liveRole && agentAlive(root, slug);
	const entries: (AgentEntry & { mtime: number; start: number | null })[] = [];
	for (const role of LOG_ROLES) {
		const base = `${slug}.${role}`;
		const runs: { run: number | null; handle: string }[] = [];
		if (files.includes(`${base}.log`) || files.includes(`${base}.log.gz`)) runs.push({ run: null, handle: base });
		for (const n of indexRuns(files, base)) runs.push({ run: n, handle: `${base}.${n}` });
		if (!runs.length) continue;
		const newest = runs[runs.length - 1].handle;
		for (const r of runs) {
			const path = runLogPath(dir, r.handle);
			let mtime = 0;
			try {
				mtime = statSync(path).mtimeMs;
			} catch {
				/* raced away between readdir and stat */
			}
			const stats = logStats(path);
			const alive = live && role === liveRole && r.handle === newest;
			// no marker means the run advanced the state itself, the same signal the poll's
			// completed-run counter clear reads; a marker can never name the live run, indexes
			// are never reused
			const status: AgentEntry["status"] = alive ? "live" : existsSync(join(dir, `${r.handle}.dead`)) ? "dead" : "ok";
			entries.push({ role, run: r.run, alive, status, handle: r.handle, tokens: stats.tokens, duration: stats.duration, mtime, start: stats.first });
		}
	}
	// stable sort: the enumeration order (role order, legacy first, index ascending) breaks the ties
	return entries
		.sort((a, b) => (a.start ?? a.mtime) - (b.start ?? b.mtime) || a.mtime - b.mtime)
		.map(({ role, run, alive, status, handle, tokens, duration }) => ({ role, run, alive, status, handle, tokens, duration }));
}

// rebuild the log path from the handle: the task must exist on the board and the handle must be
// `<slug>.<role>` or `<slug>.<role>.<n>` for a role the orchestrator actually writes, so a raw
// client-supplied path can never reach the fs
function agentLogPath(root: string, handle: string): string | null {
	const m = handle.match(/^(.+)\.(developer|reviewer|live-tester|merger)(?:\.(\d+))?$/);
	if (!m || !taskFiles(root).includes(`${m[1]}.md`)) return null;
	return runLogPath(join(kanbanDir(root), ".logs"), m[3] === undefined ? `${m[1]}.${m[2]}` : `${m[1]}.${m[2]}.${m[3]}`);
}

// the Agent tool's tool result names the background agent and its .output transcript; ids are in
// log order, so a subagent's number is its index here. Paths come from the log, never the client:
// resolve first, then only pi's own subagent dir and .output transcripts pass
// parsing a parent log is not free (a live-tester log can pass 50 MB), and every panel open asks
// for the list: memoize per path until the file size changes. A plain log only ever grows; a .gz
// log is the sweep's finished-run output and never changes, so its compressed size keys the cache
const subsCache = new Map<string, { size: number; subs: { id: string; path: string }[] }>();
function subagentLogs(log: string): { id: string; path: string }[] {
	let size = 0;
	try {
		size = statSync(log).size;
		const hit = subsCache.get(log);
		if (hit && hit.size === size) return hit.subs;
	} catch {
		return []; // parent log gone or not written yet
	}
	const text = logText(log);
	if (text === null) return []; // unreadable: a corrupt .gz parses as no subs
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

// record timestamps arrive as ISO strings (session, subagent user/assistant) or epoch-ms numbers
// (turn_end and the message records carry it at message level)
function tsMs(v: unknown): number | null {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string") {
		const t = Date.parse(v);
		return Number.isNaN(t) ? null : t;
	}
	return null;
}

// per-file usage stats, memoized by size like subsCache: tokens sums the provider-reported
// message.usage.totalTokens over the usage-bearing records (turn_end in a run log, assistant in a
// subagent transcript, cache reads included), duration is the last record timestamp minus the
// first, first is that first record timestamp in epoch ms (000139: the agent history sort's
// primary key), model and thinkingLevel come off the latest usage-bearing record (000146: the log
// pane's meta line; null when no such record exists or the latest one lacks them (000151)). A plain log only ever grows, so a size match
// means the parse is current; a live log re-parses per poll. A .gz log is immutable, so its
// compressed size keys the same cache.
// Ceiling: a full re-read per growth, split-line the incremental scan when a live log passes
// tens of MB
const statsCache = new Map<string, { size: number; tokens: number | null; duration: number | null; first: number | null; model: string | null; thinkingLevel: string | null }>();
function logStats(path: string): { tokens: number | null; duration: number | null; first: number | null; model: string | null; thinkingLevel: string | null } {
	let size = 0;
	try {
		size = statSync(path).size;
		const hit = statsCache.get(path);
		if (hit && hit.size === size) return hit;
	} catch {
		return { tokens: null, duration: null, first: null, model: null, thinkingLevel: null }; // log gone or not written yet
	}
	const text = logText(path);
	if (text === null) return { tokens: null, duration: null, first: null, model: null, thinkingLevel: null }; // unreadable: a corrupt .gz
	let tokens: number | null = null;
	let first: number | null = null;
	let last: number | null = null;
	let model: string | null = null;
	let thinkingLevel: string | null = null;
	for (const line of text.split("\n")) {
		if (!line.includes('"timestamp"') && !line.includes('"totalTokens"')) continue; // cheap filter before JSON.parse
		let rec: any;
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		if ((rec?.type === "turn_end" || rec?.type === "assistant") && typeof rec?.message?.usage?.totalTokens === "number" && Number.isFinite(rec.message.usage.totalTokens)) {
			tokens = (tokens ?? 0) + rec.message.usage.totalTokens;
			// the loop reads top to bottom, so the latest usage-bearing record wins; a record without the
			// fields clears them rather than carrying an older record's value forward (000151)
			model = typeof rec.message.model === "string" && rec.message.model ? rec.message.model : null;
			thinkingLevel = typeof rec.message.thinkingLevel === "string" && rec.message.thinkingLevel ? rec.message.thinkingLevel : null;
		}
		const ts = tsMs(rec?.timestamp) ?? tsMs(rec?.message?.timestamp);
		if (ts != null) {
			first ??= ts;
			last = ts;
		}
	}
	const stats = { tokens, duration: first != null && last != null ? Math.max(0, last - first) : null, first, model, thinkingLevel };
	statsCache.set(path, { size, ...stats });
	return stats;
}

// pi --mode json writes JSONL event records (docs/json.md); everything else in the log file is
// non-JSON: stderr diagnostics and legacy print-mode final text, passed through escaped. The
// chunk renders to the HTML fragments the detail card ingests (ingest, the PAGE script): text and
// prompts as escaped lines, thinking blocks and tool calls as collapsed <details> elements. One
// tool block per call: the streamed toolcall_end and the execution start both carry name + args,
// so dedupe by id within the chunk; a block stays open for its result across chunks (data-tc),
// and a result whose block lives in an earlier chunk renders the joinable span. An assistant
// message_end repeats its streamed text deltas, so only the user prompt (the run's opening
// message) renders from message_end. A subagent .output transcript is sidechain session records
// (user/assistant/toolResult): prompt and text render as lines, thinking and tool calls join the
// same blocks and dedupe.
const ARG_KEYS = ["command", "path", "file_path", "pattern", "url", "query"];
const cap = (s: string, max = 160) => (s.length > max ? s.slice(0, max - 3) + "..." : s);

// the string argument a tool summary keys on: an ARG_KEYS match first, else the first string value
function argValue(args: unknown): string {
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
	return typeof value === "string" ? value : "";
}

// the one-liner under the tool name in the collapsed summary: the first line of the command/input
// or the file path, capped at 80 chars
function oneLiner(args: unknown): string {
	const value = argValue(args);
	return value ? cap(value.split("\n")[0].replace(/\s+/g, " ").trim(), 80) : "";
}

function textOf(result: unknown, max = 200): string {
	const content = (result as { content?: { type?: string; text?: string }[] } | undefined)?.content;
	const text = Array.isArray(content) ? content.find((c) => c?.type === "text")?.text : undefined;
	return typeof text === "string" ? cap(text.replace(/\s+/g, " ").trim(), max) : "";
}

interface ToolBlock {
	idx: number;
	id: string;
	name: string;
	args: string;
	one: string;
	result: string;
	fail: string | null;
}

// minimal Markdown renderer for the board subset (headings, lists, code fences, inline code, bold,
// links, paragraphs), shared by task-card bodies and the agent log text; esc() runs before markup
// applies, so rendered text can never inject tags; ceiling: swap for a full renderer when the
// subset grows
const inline = (s) => s
	.replace(/`([^`]+)`/g, "<code>$1</code>")
	.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
	.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
export function md(src) {
	let html = "", list = false, fence = false;
	const closeList = () => { if (list) { html += "</ul>"; list = false; } };
	for (const line of esc(src).split("\n")) {
		if (line.trim().slice(0, 3) === "```") { closeList(); fence = !fence; html += fence ? "<pre><code>" : "</code></pre>"; continue; }
		if (fence) { html += line + "\n"; continue; }
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

export function renderLogChunk(text: string): string {
	const out: string[] = [];
	let pending = "";
	// each chunk renders standalone, so a construct split across a chunk boundary renders as two
	// pieces: md auto-closes an open fence at the end of its input and the continuation chunk
	// re-opens its own; upgrade path: carry per-slug render state across polls
	const flush = () => {
		if (pending) {
			out.push(md(pending));
			pending = "";
		}
	};
	const lines = text.split("\n");
	lines.pop(); // split's last element is the trailing-newline sentinel or a byte-split partial record, not content
	const seenTools = new Set<string>();
	// tool blocks opened in this chunk, keyed by toolCallId: a tool_execution_end for an id here
	// fills the block, an id from an earlier chunk renders the joinable span the client resolves
	const tools = new Map<string, ToolBlock>();
	const toolHtml = (t: ToolBlock) =>
		'<details class="lg-tool" data-tc="' +
		esc(t.id) +
		'"><summary>' +
		esc(t.fail !== null ? t.name + " failed" + (t.fail ? ": " + t.fail : "") : t.name + (t.one ? ": " + t.one : "")) +
		'</summary><pre class="lg-args">' +
		esc(t.args) +
		"</pre>" +
		(t.result ? '<pre class="lg-out">' + esc(t.result) + "</pre>" : "") +
		"</details>";
	let think: string | null = null; // the open thinking block's deltas, filled at thinking_end or chunk end
	let thinkIdx = -1;
	const thinkHtml = (open: boolean) =>
		'<details class="lg-think"' + (open ? ' data-open="think"' : "") + "><summary>Thinking</summary><pre>" + md(think ?? "") + "</pre></details>";
	let cont: string | null = null; // thinking deltas continuing the previous chunk's block, one span per chunk
	let contIdx = -1;
	const openTool = (id: unknown, name: unknown, args: unknown) => {
		if (typeof id !== "string" || !id || seenTools.has(id)) return;
		seenTools.add(id);
		flush();
		out.push("");
		tools.set(id, {
			idx: out.length - 1,
			id,
			name: typeof name === "string" && name ? name : "?",
			args: JSON.stringify(args ?? {}, null, 2),
			one: oneLiner(args),
			result: "",
			fail: null,
		});
	};
	const joinTool = (id: unknown, name: unknown, isError: boolean, result: unknown) => {
		const t = typeof id === "string" ? tools.get(id) : undefined;
		if (t) {
			t.result = textOf(result, 2000);
			if (isError) t.fail = textOf(result);
			return;
		}
		// the block lives in an earlier chunk: the span joins it client-side, or shows the text as a
		// line (errors as their failed summary) when the walk-back left the block unloaded
		if (typeof id !== "string" || !id) return;
		const err = isError ? textOf(result) : null;
		const text = textOf(result, 2000);
		if (!text && err === null) return;
		flush();
		out.push(
			'<span class="lg-tres" data-tc="' +
				esc(id) +
				'"' +
				(err !== null ? ' data-sum="' + esc((typeof name === "string" && name ? name : "?") + " failed" + (err ? ": " + err : "")) + '"' : "") +
				">" +
				esc(text) +
				"</span>",
		);
	};
	for (const line of lines) {
		let rec: Record<string, any>;
		try {
			rec = JSON.parse(line);
		} catch {
			flush();
			out.push(esc(line) + "\n");
			continue;
		}
		if (!rec || typeof rec !== "object") {
			flush();
			out.push(esc(line) + "\n");
			continue;
		}
		if (rec.type === "message_update") {
			const ev = rec.assistantMessageEvent;
			if (!ev || typeof ev !== "object") continue;
			if (ev.type === "thinking_start") {
				if (think === null) {
					flush();
					out.push("");
					thinkIdx = out.length - 1;
					think = "";
				}
			} else if (ev.type === "thinking_delta") {
				if (think !== null) {
					think += ev.delta ?? "";
				} else {
					// deltas with no thinking_start in this chunk continue the previous chunk's block
					if (cont === null) {
						flush();
						out.push("");
						contIdx = out.length - 1;
						cont = "";
					}
					cont += ev.delta ?? "";
				}
			} else if (ev.type === "thinking_end") {
				// the authoritative content replaces the reconstructed deltas (docs/json.md)
				if (think !== null) {
					if (typeof ev.content === "string") think = ev.content;
					out[thinkIdx] = thinkHtml(false);
					think = null;
					thinkIdx = -1;
				} else if (typeof ev.content === "string") {
					// the start lived in an earlier chunk: the final span closes the client's open
					// block and replaces its reconstructed deltas with the authoritative text
					flush();
					out.push('<span class="lg-cont" data-final="1">' + esc(ev.content) + "</span>");
				}
			} else if (ev.type === "text_delta") {
				pending += ev.delta ?? "";
			} else if (ev.type === "text_start") {
				flush();
			} else if (ev.type === "toolcall_end") {
				openTool(ev.toolCall?.id, ev.toolCall?.name, ev.toolCall?.arguments);
			}
		} else if (rec.type === "tool_execution_start") {
			openTool(rec.toolCallId, rec.toolName, rec.args);
		} else if (rec.type === "tool_execution_end") {
			joinTool(rec.toolCallId, rec.toolName, rec.isError === true, rec.result);
		} else if (rec.type === "message_end") {
			const msg = rec.message;
			if (msg?.role === "user" && typeof msg.content === "string" && msg.content.trim()) {
				flush();
				out.push("[prompt] " + esc(cap(msg.content.replace(/\s+/g, " ").trim())) + "\n");
			}
		} else if (rec.isSidechain === true && rec.message && typeof rec.message === "object") {
			const msg = rec.message;
			if (msg.role === "user") {
				const text = typeof msg.content === "string" ? msg.content : "";
				if (text.trim()) {
					flush();
					out.push("[prompt] " + esc(cap(text.replace(/\s+/g, " ").trim())) + "\n");
				}
			} else if (msg.role === "assistant") {
				const blocks = Array.isArray(msg.content) ? msg.content : [];
				for (const block of blocks) {
					if (block?.type === "toolCall") {
						openTool(block.id, block.name, block.arguments);
					} else if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
						flush();
						out.push('<details class="lg-think"><summary>Thinking</summary><pre>' + md(block.thinking) + "</pre></details>");
					} else if (block?.type === "text" && typeof block.text === "string" && block.text) {
						pending += block.text;
					}
				}
			} else if (msg.role === "toolResult") {
				joinTool(msg.toolCallId, msg.toolName, msg.isError === true, msg);
			}
		}
	}
	flush();
	if (cont) out[contIdx] = '<span class="lg-cont">' + esc(cont) + "</span>";
	if (think !== null) out[thinkIdx] = thinkHtml(true); // the block continues into the next chunk
	for (const t of tools.values()) out[t.idx] = toolHtml(t);
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
	if (sub === "list")
		return JSON.stringify(
			subagentLogs(log).map((s, index) => {
				const { tokens, duration } = logStats(s.path);
				return { id: s.id, index, tokens, duration }; // first stays internal to the history sort
			}),
		);
	let target = log;
	if (sub !== null) {
		const subIndex = /^\d+$/.test(sub) ? parseInt(sub, 10) : -1;
		const found = subIndex >= 0 ? subagentLogs(log)[subIndex] : undefined;
		if (!found) return null; // no such subagent in this run
		target = found.path;
	}
	const n = parseInt(q.get("offset") ?? "", 10);
	const off = Number.isInteger(n) && n >= 0 ? n : null;
	// 000146: the meta line's model and thinking level, computed per request so the 1 s poll
	// refreshes them live (logStats re-parses when the log grew); nulls keep the line hidden
	const { model, thinkingLevel } = logStats(target);
	// a .gz log is a finished, immutable run: decompressed whole and the walk slices the
	// decompressed bytes, so offsets stay byte-based like the plain path (byte offsets cannot
	// seek into a gzip stream, and a string index would misread a plain log's byte offset);
	// a plain log reads by byte range so a live tail streams without loading the file
	let full: Buffer | null = null;
	if (target.endsWith(".gz")) {
		try {
			full = gunzipSync(readFileSync(target));
		} catch {
			full = Buffer.alloc(0); // corrupt or vanished: empty windows, never the compressed bytes
		}
	}
	let text = "";
	let head: number, tail: number;
	if (q.get("before") === "1") {
		tail = off ?? 0;
		head = Math.max(0, tail - LOG_CHUNK);
	} else {
		let size = 0;
		try {
			size = full !== null ? full.length : statSync(target).size;
		} catch {
			// agent spawned but no output yet
		}
		head = off ? Math.min(off, size) : Math.max(0, size - LOG_CHUNK);
		tail = size;
	}
	let next = tail;
	try {
		const window = (start: number, end: number): [string, number] => {
			if (full === null) return readRange(target, start, end);
			if (end <= start) return ["", start];
			const buf = full.subarray(start, end);
			const nl = buf.lastIndexOf(0x0a);
			return [buf.toString("utf8"), nl === -1 ? start : start + nl + 1];
		};
		// a finished log's tail is terminal records that render to nothing (assistant
		// message_end, turn_end, agent_end, agent_settled): walk the window back until a
		// chunk renders, so a fresh open or history page never lands on an empty pane; an
		// offset poll keeps its window, the client already consumed the region below its
		// offset and walking back would re-serve it (live watching stays delta-streamed)
		const walk = off == null || q.get("before") === "1";
		for (;;) {
			const [raw, boundary] = window(head, tail);
			// a forward poll reports a tail on a record boundary: the client's next offset then
			// starts at a whole record, so a record split across two windows is re-read from its
			// start and renders once when its newline arrives, never just as a stripped head line
			if (q.get("before") !== "1") next = boundary;
			text = raw;
			if (head > 0 && window(head - 1, head)[0] !== "\n") {
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
	return JSON.stringify({ text, head, tail, atStart: head === 0, model, thinkingLevel });
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

// tokens on an agent card: raw below 1000, kilo (42k), mega with one decimal from a million (2.3M);
// empty when the log carries no usage
export function fmtTokens(total) {
	if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return "";
	if (total < 1000) return String(total);
	if (total >= 999500) return (total / 1e6).toFixed(1) + "M";
	return Math.round(total / 1000) + "k";
}

// duration on an agent card: one decimal below 10s, then whole seconds, then minutes
export function fmtDur(ms) {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
	const s = ms / 1000;
	if (s < 10) return s.toFixed(1) + "s";
	const sec = Math.round(s);
	if (sec < 60) return sec + "s";
	return Math.floor(sec / 60) + "m" + (sec % 60 ? " " + (sec % 60) + "s" : "");
}

// the stats line under an agent card's label (42k · 3.5s): tokens then duration, empty when both
// are missing; agentCardHtml and the in-place stats pass share it, so both render the same string
export function agentStatsText(tokens, duration) {
	return [fmtTokens(tokens), fmtDur(duration)].filter(Boolean).join(" · ");
}

// the open detail card's poll cadence (000142): a live agent's tokens and duration advance with
// the run log, so while the open task has one the poll ticks at 1 s; otherwise the 5 s board poll
export function refreshMs(t) {
	return t && (t.agents || []).some((a) => a.alive) ? 1000 : 5000;
}

// the agent row's structure: role, run, aliveness, status and handle per run. A changed set
// rebuilds the row (sub boxes carry over by handle), an unchanged one moves only the stats lines
export function agentRowSig(runs) {
	return runs.map((a) => [a.role, a.run, a.alive ? "live" : a.status, a.handle].join("/")).join("|");
}

// 000142: an unchanged agent row updates its cards' stats lines in place, so the live run's
// spinner animation survives the poll; a structure change (a run added or gone, live -> dead)
// returns false and the caller rebuilds, re-seeding the signature. The stats span joins the card
// html only when the stats are non-empty, matching agentCardHtml's markup; doc is injected so
// tests run this without a DOM.
export function syncAgentStats(el, runs, doc) {
	if (el.__sig !== agentRowSig(runs) || el.children.length !== runs.length) return false;
	for (let i = 0; i < runs.length; i++) {
		const stats = agentStatsText(runs[i].tokens, runs[i].duration);
		const card = el.children[i].children[0];
		if (card.__stats === stats) continue;
		card.__stats = stats;
		const span = [...card.children].find((c) => c.className === "agent-stats");
		if (span) {
			if (stats) span.textContent = stats;
			else span.remove();
		} else if (stats) {
			const s = doc.createElement("span");
			s.className = "agent-stats";
			s.textContent = stats;
			card.appendChild(s);
		}
	}
	return true;
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
		'</span><span class="chip cx cx-' +
		esc(t.complexity || "moderate") +
		'">' +
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
	// 000127: a fixed bow flattens into a near-straight diagonal over a long cross-column span, so
	// scale the offset with the span (capped so extreme widths stay sane) and the curve bends into
	// an S that hugs the cards at both ends and crosses in the middle; near spans keep the bow
	const sBend = (a, b) => Math.max(bow, Math.min(Math.abs(b - a) * 0.35, 480));
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
		const d = sBend(x1, x2);
		c1x = x1 - d;
		c2x = x2 + d;
	} else {
		x1 = from.x + from.w;
		y1 = mid(from);
		x2 = to.x;
		y2 = mid(to);
		const d = sBend(x1, x2);
		c1x = x1 + d;
		c2x = x2 - d;
	}
	return "M " + x1 + " " + y1 + " C " + c1x + " " + y1 + ", " + c2x + " " + y2 + ", " + x2 + " " + y2;
}

// one curve per stored relation the board can draw: the blocked task's card to each blocking
// task's card, both currently rendered, carrying both endpoint files for the hover highlight
// (000127, 000144). A "#<num>" ref maps to its task via parseInt(file); a ref
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
			out.push({ file: t.file, blocker: blocker.file, d: curve(from, to, t.state === blocker.state || Math.abs(to.x - from.x) < 1) });
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

// the cross-chunk fixups over the whole pane, run after every chunk insert: duplicate tool blocks
// (a record split across poll windows re-serves the start) drop keeping the first; a later tool
// result joins its block by toolCallId, an orphan one promotes to a collapsible details (the
// data-sum one-liner as the summary, a generic "result" without one, the result text as the body);
// thinking deltas continuing the previous chunk's block append into the marked open block, an
// unjoined one promotes to a collapsible details too (marked open so later delta polls join it);
// a final close span (data-final, a cross-window thinking_end) replaces the marked block's body
// with the authoritative text and unmarks it, or promotes to a closed block of its own; doc is
// injected so tests run this without a DOM
export function logFixups(el, doc) {
	const seen = new Set();
	for (const d of el.querySelectorAll("details.lg-tool[data-tc]")) {
		if (seen.has(d.dataset.tc)) d.remove(); else seen.add(d.dataset.tc);
	}
	for (const s of el.querySelectorAll(".lg-tres")) {
		const b = el.querySelector('details.lg-tool[data-tc="' + CSS.escape(s.dataset.tc) + '"]');
		if (b) {
			if (s.dataset.sum) b.querySelector("summary").textContent = s.dataset.sum;
			const out = doc.createElement("pre");
			out.className = "lg-out";
			out.textContent = s.textContent;
			b.appendChild(out);
			s.remove();
			continue;
		}
		const d = doc.createElement("details");
		d.className = "lg-tool";
		const sum = doc.createElement("summary");
		sum.textContent = s.dataset.sum || "result";
		const out = doc.createElement("pre");
		out.className = "lg-out";
		out.textContent = s.textContent;
		d.append(sum, out);
		s.replaceWith(d);
	}
	for (const s of el.querySelectorAll(".lg-cont")) {
		const final = !!s.dataset.final;
		let b = s.previousElementSibling;
		while (b && !(b.classList.contains("lg-think") && b.dataset.open === "think")) b = b.previousElementSibling;
		if (b) {
			if (final) {
				b.querySelector("pre").textContent = s.textContent;
				delete b.dataset.open;
			} else {
				b.querySelector("pre").append(s.textContent);
			}
			s.remove();
			continue;
		}
		const d = doc.createElement("details");
		d.className = "lg-think";
		if (!final) d.dataset.open = "think"; // later delta polls walk back to this block and join it
		const sum = doc.createElement("summary");
		sum.textContent = "Thinking";
		const pre = doc.createElement("pre");
		pre.textContent = s.textContent;
		d.append(sum, pre);
		s.replaceWith(d);
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; }
/* Ayu Light palette (ayu-theme/ayu-colors); 000129: medium moved to a deeper yellow so the priority chips read apart */
:root { --bg: #fcfcfc; --fg: #5c6166; --panel: #ffffff; --border: rgba(107, 125, 143, .12); --heading: #5c6166; --muted: #adaeb1; --faint: #adaeb1; --soft: #5c6166; --hover: rgba(130, 142, 159, .1); --overlay: rgba(15, 23, 42, .45); --code-bg: #ebeef0; --link: #f29718;
--low-bg: rgba(134, 179, 0, .15); --low-fg: #86b300; --medium-bg: rgba(201, 151, 0, .15); --medium-fg: #c99700; --high-bg: rgba(250, 133, 50, .15); --high-fg: #fa8532; --critical-bg: rgba(230, 80, 80, .15); --critical-fg: #e65050; }
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
#m-log-meta { padding: 6px 10px 0; font-size: 10px; line-height: 1.45; color: var(--muted); }
#m-log-meta.hidden { display: none; }
/* the log text renders in the page's Inter stack; 000152: the size matches the card body text, only the line-height stays tuned for logs; blocks are collapsed <details> the client fills in */
#m-log-text { margin: 0; padding: 8px 10px; font-size: 13px; line-height: 1.45; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; white-space: pre-wrap; overflow-wrap: break-word; }
#m-log-text pre { font: inherit; margin: 0; padding: 0; }
#m-log-text details { margin: 2px 0; }
#m-log-text summary { cursor: pointer; }
#m-log-text details.lg-think, #m-log-text details.lg-tool { color: var(--muted); }
#m-log-text details > pre { padding-left: 12px; }
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
${agentRowSig}
${syncAgentStats}
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
	// amount of HTML escaping makes safe inside inline JS
	for (const b of el.querySelectorAll(".agent-col > .agent-card")) b.onclick = () => openAgentLog(b.dataset.handle);
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
		box.innerHTML = (Array.isArray(list) ? list : []).map(s =>
			agentCardHtml("agent-sub", 'data-handle="' + esc(a.handle) + '" data-sub="' + s.index + '"', "Sub-" + a.role, s.tokens, s.duration, "")).join("");
		for (const b of box.querySelectorAll(".agent-card")) b.onclick = () => openSubLog(b.dataset.handle, Number(b.dataset.sub));
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
	}).catch(() => {}).finally(() => { if (logState === st) st.busy = false; });
}
document.getElementById("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
// the log pane is static markup: the scroll handler binds once and reads the live logState
const pane = logPane();
pane.onscroll = () => {
	if (!logState || logState.busy || logState.atStart || pane.scrollTop > 0) return;
	pullLog(logUrl("&offset=" + logState.head + "&before=1"), "history");
};
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
