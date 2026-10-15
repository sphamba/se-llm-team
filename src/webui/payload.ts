import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { kanbanDir, listAll, splitFrontmatter, taskFiles, taskSlug, type Task } from "../kanban.ts";
import { agentAlive } from "../pid.ts";
import { AGENT_ROLE, LOG_LINES, LOG_ROLES, renderLogChunk } from "./logpane.ts";

// the served payloads: per-task board rows (taskPayload) and the chunked agent-log reader
// (agentLogPayload) over run logs, subagent transcripts and per-file usage stats
// one agent run: run is the index in `<slug>.<role>.<n>.log`, null for a legacy unsuffixed file;
// tokens sums the run's turn_end input + output, cache excluded (000177); duration is the last
// record timestamp minus the first
// (000169: the live run ticks with now - first instead, so a quiet stretch does not freeze it),
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
	const now = Date.now();
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
			// a live run can go quiet for minutes mid-tool-call, so its duration ticks with
			// now - first per request; finished runs keep the parsed last - first (000169)
			const duration = alive && stats.first != null ? Math.max(0, now - stats.first) : stats.duration;
			entries.push({ role, run: r.run, alive, status, handle: r.handle, tokens: stats.tokens, duration, mtime, start: stats.first });
		}
	}
	// stable sort: the enumeration order (role order, legacy first, index ascending) breaks the ties
	return entries
		.sort((a, b) => (a.start ?? a.mtime) - (b.start ?? b.mtime) || a.mtime - b.mtime)
		.map(({ role, run, alive, status, handle, tokens, duration }) => ({ role, run, alive, status, handle, tokens, duration }));
}

// one entry per existing doctor log `.logs/<slug>.<analysed role>.<n>.doctor.log`: the doctor
// pass's stream output for the analysed run, ordered by the first in-log record timestamp like
// the run history; alive = the run's analysis pid is still alive (spawnRunAnalysis's pid file),
// so a running doctor's card spins and its log keeps polling; tokens and duration parse off the
// same JSONL stream the agent logs carry
function doctorHistory(root: string, t: Task, files: string[]): AgentEntry[] {
	const slug = taskSlug(t.file);
	const dir = join(kanbanDir(root), ".logs");
	const now = Date.now();
	const entries: (AgentEntry & { mtime: number; start: number | null })[] = [];
	for (const f of files) {
		const m = f.match(/^(.+)\.([a-z-]+)\.(\d+)\.doctor\.log$/);
		if (!m || m[1] !== slug) continue;
		const path = join(dir, f);
		let mtime = 0;
		try {
			mtime = statSync(path).mtimeMs;
		} catch {
			/* raced away between readdir and stat */
		}
		const stats = logStats(path);
		const alive = agentAlive(root, `${slug}.${m[2]}.${m[3]}.analysis`);
		const duration = alive && stats.first != null ? Math.max(0, now - stats.first) : stats.duration;
		entries.push({ role: "doctor", run: Number(m[3]), alive, status: alive ? "live" : "ok", handle: `${slug}.${m[2]}.${m[3]}.doctor`, tokens: stats.tokens, duration, mtime, start: stats.first });
	}
	// stable sort: the readdir order breaks the ties
	return entries
		.sort((a, b) => (a.start ?? a.mtime) - (b.start ?? b.mtime) || a.mtime - b.mtime)
		.map(({ role, run, alive, status, handle, tokens, duration }) => ({ role, run, alive, status, handle, tokens, duration }));
}

// rebuild the log path from the handle: the task must exist on the board and the handle must be
// `<slug>.<role>` or `<slug>.<role>.<n>` for a role the orchestrator actually writes, or a doctor
// log handle `<slug>.<role>.<n>.doctor` for the analysed run, so a raw client-supplied path can
// never reach the fs
function agentLogPath(root: string, handle: string): string | null {
	const m = handle.match(/^(.+)\.(developer|reviewer|live-tester|merger|doctor)(?:\.(\d+))?$/);
	if (!m) return null;
	let slug = m[1];
	if (m[2] === "doctor") {
		// a doctor log names the analysed run: its task file is the analysed run's task, so the
		// slug is the handle minus the trailing .<role>.<n>
		const dm = slug.match(/^(.+)\.(?:developer|reviewer|live-tester|merger)\.(\d+)$/);
		if (!dm) return null;
		slug = dm[1];
	}
	if (!taskFiles(root).includes(`${slug}.md`)) return null;
	return runLogPath(join(kanbanDir(root), ".logs"), handle);
}

// pi's background Agent tool writes each subagent transcript under this dir and names it in the
// tool result text; both are emergent pi behavior, the parser keys on the text (see subagentLogs)
const SUB_ROOT = "/tmp/pi-subagents-1000/";

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
// message.usage input + output over the usage-bearing records (turn_end in a run log, assistant
// in a subagent transcript; reasoning is a subset of output so it counts once, cacheRead/cacheWrite
// excluded) (000177); claude stream-json carries the same sum as input_tokens/output_tokens, one
// API turn can emit several assistant records sharing message.id with the same usage, so each
// message counts once. Duration is the last record timestamp minus the
// first, first is that first record timestamp in epoch ms (000139: the agent history sort's
// primary key); claude records carry an optional top-level timestamp (newer emitters only), so a
// finished claude run prefers its result record's wall-clock duration_ms over the timestamp span
// and a timestamp-less live one reads null. Model and thinkingLevel come off the latest usage-bearing record (000146: the log
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
	let resultMs: number | null = null; // the claude result record's wall-clock duration_ms
	const idTokens = new Map<string, number>(); // claude message.id -> the usage counted for it
	const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
	for (const line of text.split("\n")) {
		if (!line.includes('"timestamp"') && !line.includes('"usage"') && !line.includes('"duration_ms"')) continue; // cheap filter before JSON.parse
		let rec: any;
		try {
			rec = JSON.parse(line);
		} catch {
			continue;
		}
		const usage = rec?.message?.usage;
		// pi usage carries input/output; claude stream-json carries input_tokens/output_tokens
		const input = num(usage?.input) ?? num(usage?.input_tokens);
		const output = num(usage?.output) ?? num(usage?.output_tokens);
		const claude = usage != null && (usage.input_tokens !== undefined || usage.output_tokens !== undefined);
		if ((rec?.type === "turn_end" || rec?.type === "assistant") && input != null && output != null) {
			const add = input + output;
			const id = claude && typeof rec.message.id === "string" && rec.message.id ? rec.message.id : null;
			if (id) {
				// one claude API turn can emit several assistant records sharing message.id with the
				// same usage: a re-read record replaces the usage counted for its message
				tokens = (tokens ?? 0) + add - (idTokens.get(id) ?? 0);
				idTokens.set(id, add);
			} else {
				tokens = (tokens ?? 0) + add;
			}
			// the loop reads top to bottom, so the latest usage-bearing record wins; a record without the
			// fields clears them rather than carrying an older record's value forward (000151)
			model = typeof rec.message.model === "string" && rec.message.model ? rec.message.model : null;
			thinkingLevel = typeof rec.message.thinkingLevel === "string" && rec.message.thinkingLevel ? rec.message.thinkingLevel : null;
		}
		if (rec?.type === "result" && num(rec.duration_ms) != null) resultMs = rec.duration_ms;
		const ts = tsMs(rec?.timestamp) ?? tsMs(rec?.message?.timestamp);
		if (ts != null) {
			first ??= ts;
			last = ts;
		}
	}
	const stats = { tokens, duration: resultMs ?? (first != null && last != null ? Math.max(0, last - first) : null), first, model, thinkingLevel };
	statsCache.set(path, { size, ...stats });
	return stats;
}

const SCAN_WINDOW = 81920; // bytes per backward read in the collapsed-line scan

// [start, end) raw bytes of a plain log, fewer on a mid-read shrink; the decompressed .gz buffer
// arrives whole, so the scan slices it in memory
function readBytes(full: Buffer | null, target: string, start: number, end: number): Buffer {
	if (end <= start) return Buffer.alloc(0);
	if (full !== null) return full.subarray(start, end);
	const buf = Buffer.alloc(end - start);
	const fh = openSync(target, "r");
	try {
		const n = readSync(fh, buf, 0, buf.length, start);
		return buf.subarray(0, n);
	} finally {
		closeSync(fh);
	}
}

// [decoded text, byte offset just past the window's last newline-terminated record]
function readRange(path: string, start: number, end: number): [string, number] {
	if (end <= start) return ["", start];
	const buf = readBytes(null, path, start, end);
	const nl = buf.lastIndexOf(0x0a);
	// lenient decode: a multi-byte char split at the chunk edge becomes one replacement glyph
	return [buf.toString("utf8"), nl === -1 ? start : start + nl + 1];
}

// the last record boundary at or before size: an unterminated tail record is not a line yet, so
// init counts collapsed lines from the boundary below it and the next poll re-reads the record
// whole; 0 when no complete record exists
function lastBoundary(full: Buffer | null, target: string, size: number): number {
	let lo = Math.max(0, size - SCAN_WINDOW);
	for (;;) {
		const nl = readBytes(full, target, lo, size).lastIndexOf(0x0a);
		if (nl !== -1) return lo + nl + 1;
		if (lo === 0) return 0;
		lo = Math.max(0, lo - SCAN_WINDOW);
	}
}

// 000158: the byte offset that starts `count` collapsed lines before a record-boundary tail: a
// thinking block (thinking_start..thinking_end records) and a tool call block
// (tool_execution_start..tool_execution_end) each count as ONE line, every other record its own,
// so init and back-fill windows always start between blocks and no block is ever broken; 000166:
// a thinking block still open at the tail (no thinking_end below it) counts as ONE line
// too, head landing at its thinking_start, so a live phase loads as one unbroken open block and a
// back-fill from that head never re-serves it; a claude stream_event block
// (content_block_start..content_block_stop, deltas between) counts as ONE line by index pairing,
// an open one at the tail likewise from its content_block_start; returns 0 when the file starts
// first. Ceiling: a record outgrowing the scan window doubles it per step
function linesBack(full: Buffer | null, target: string, tail: number, count: number): number {
	let pos = tail; // walks record boundaries backward
	let head = tail;
	let inThink = false; // consuming a thinking block backward, back to its thinking_start
	let openThink = false; // consuming a still-open thinking block backward (000166): its thinking_end lies below the tail
	let openTool: string | null = null; // consuming a tool block backward, back to its matching start
	let clBlock: number | null = null; // consuming a claude stream_event block backward, back to its content_block_start
	let wlo = Math.max(0, tail - SCAN_WINDOW); // the scan window held in memory, grows backward
	let win = readBytes(full, target, wlo, tail);
	while (pos > 0 && count > 0) {
		// the record ending at pos spans [rstart, pos); find the newline before its terminator
		let rel = Math.min(pos - 2 - wlo, win.length - 1);
		let nl = rel >= 0 ? win.lastIndexOf(0x0a, rel) : -1;
		while (nl === -1 && wlo > 0) {
			const grow = Math.min(wlo, Math.max(SCAN_WINDOW, win.length));
			wlo -= grow;
			win = Buffer.concat([readBytes(full, target, wlo, wlo + grow), win]);
			rel = Math.min(pos - 2 - wlo, win.length - 1);
			nl = rel >= 0 ? win.lastIndexOf(0x0a, rel) : -1;
		}
		const rstart = nl === -1 ? 0 : wlo + nl + 1;
		// only records carrying block markers can move the state; the rest are their own line
		const raw = win.subarray(rstart - wlo, pos - wlo).toString("utf8");
		let rec: any = null;
		if (raw.includes('"thinking_') || raw.includes('"tool_execution_') || raw.includes('"toolcall_end"') || raw.includes('"stream_event"')) {
			try {
				rec = JSON.parse(raw);
			} catch {
				rec = null; // junk or a truncated record: its own line
			}
		}
		pos = rstart;
		const ev = rec?.type === "message_update" ? rec.assistantMessageEvent : rec?.type === "stream_event" ? rec.event : null;
		if (inThink) {
			if (ev?.type === "thinking_start") {
				inThink = false;
				count--;
				head = pos;
			}
		} else if (openTool !== null) {
			if ((rec?.type === "tool_execution_start" && rec.toolCallId === openTool) || (ev?.type === "toolcall_end" && ev.toolCall?.id === openTool)) {
				openTool = null;
				count--;
				head = pos;
			}
		} else if (clBlock !== null) {
			// claude stream block: the deltas between its stop and start records belong to it
			if (ev?.type === "content_block_start" && ev.index === clBlock) {
				clBlock = null;
				count--;
				head = pos;
			}
		} else if (ev?.type === "thinking_end") {
			inThink = true;
		} else if (openThink) {
			// 000166: inside the open block, skip up to its thinking_start; the block counts as ONE
			// line like a closed one and head lands at the start record, so the whole block stays in
			// one window and a back-fill from that head never re-serves any part of it
			if (ev?.type === "thinking_start") {
				openThink = false;
				count--;
				head = pos;
			}
		} else if (ev?.type === "thinking_delta") {
			openThink = true; // no thinking_end below the tail: the block is still open at the live tail
		} else if (ev?.type === "content_block_stop" && typeof ev.index === "number") {
			clBlock = ev.index;
		} else if (ev?.type === "content_block_delta" && typeof ev.index === "number") {
			clBlock = ev.index; // no content_block_stop below the tail: the block is still open
		} else if (rec?.type === "tool_execution_end" && typeof rec.toolCallId === "string" && rec.toolCallId) {
			openTool = rec.toolCallId;
		} else {
			count--;
			head = pos;
		}
	}
	return count > 0 ? 0 : head;
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
			doctors: doctorHistory(root, t, files),
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
		head = linesBack(full, target, tail, LOG_LINES);
	} else {
		let size = 0;
		try {
			size = full !== null ? full.length : statSync(target).size;
		} catch {
			// agent spawned but no output yet
		}
		if (off) {
			head = Math.min(off, size);
			tail = size;
		} else {
			// 000158: init serves the last LOG_LINES collapsed lines; an unterminated tail record
			// is not a line yet, so counting starts at the boundary below it
			tail = lastBoundary(full, target, size);
			head = linesBack(full, target, tail, LOG_LINES);
		}
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
			head = linesBack(full, target, head, LOG_LINES);
		}
		tail = next;
	} catch {
		// log vanished mid-request
	}
	return JSON.stringify({ text, head, tail, atStart: head === 0, model, thinkingLevel });
}
