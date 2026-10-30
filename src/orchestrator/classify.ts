import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { kanbanDir } from "../kanban.ts";
import { logPath, nextRunIndex } from "./log.ts";

// the slug's newest run log's role: a run the liveness poll keys on is the newest one whose
// name carries the role (.logs/<slug>.<role>.<n>.log). Only the slug-named roles count: the
// merger's exits ride the global merger pid/exit pair, so a stale pair never belongs to a
// merger run, and a merger log (a crashed merger's, newest by mtime) must not shadow the
// exited run. The .gz replacement counts too: every sweep gzips finished logs
// (compactFinishedLogs), so the log is usually already compacted when the poll's next pass
// reads it
export function newestRunRole(root: string, slug: string): string | null {
	let best: { role: string; mtime: number } | null = null;
	try {
		const logs = join(kanbanDir(root), ".logs");
		for (const f of readdirSync(logs)) {
			const m = f.match(/^(.+)\.(developer|reviewer|live-tester)\.\d+\.log(?:\.gz)?$/);
			if (!m || m[1] !== slug) continue;
			const mtime = statSync(join(logs, f)).mtimeMs;
			if (!best || mtime > best.mtime) best = { role: m[2], mtime };
		}
	} catch {
		/* no logs dir yet */
	}
	return best ? best.role : null;
}

// the newest finished run's log for a role: the plain file while the run just ended, the .gz
// replacement once a sweep compacted it. A path comes back even when neither file exists, so a
// missing run reads as no terminal error
export function newestRunLogPath(root: string, slug: string, role: string): string {
	const n = nextRunIndex(root, slug, role) - 1;
	const plain = logPath(root, `${slug}.${role}.${n < 0 ? 0 : n}`);
	return existsSync(plain) || !existsSync(`${plain}.gz`) ? plain : `${plain}.gz`;
}

// the tail window the classifier reads: the marker records are terminal, so the end of the log
// is enough even for a multi-gigabyte run
const CLASSIFY_TAIL_BYTES = 256 * 1024;
// the three stop reasons pi's own text mode maps to a failed run
const FAILED_STOP_REASONS = new Set(["error", "aborted", "length"]);

// the log text the classifier scans: a plain log reads its last CLASSIFY_TAIL_BYTES bytes, a
// compacted .log.gz decompresses whole (zlib has no tail read) and then takes the same tail
function readLogTail(path: string): string {
	if (path.endsWith(".gz")) return gunzipSync(readFileSync(path)).toString("utf8").slice(-CLASSIFY_TAIL_BYTES);
	const fd = openSync(path, "r");
	try {
		const size = fstatSync(fd).size;
		const start = Math.max(0, size - CLASSIFY_TAIL_BYTES);
		const buf = Buffer.alloc(size - start);
		readSync(fd, buf, 0, buf.length, start);
		return buf.toString("utf8");
	} finally {
		closeSync(fd);
	}
}

// a run whose log ends in a terminal error, even though its exit code is 0. pi's JSON mode
// exits 0 when the final assistant response failed (an HTTP error, a billing or auth failure, a
// context overflow: the cause never matters), and claude's stream-json ends with a result record
// that carries is_error. Read-only and never throws: a missing, empty, unreadable or unparseable
// log is no terminal error, so the run keeps the exit-code-only behavior. agent_end
// {willRetry:false} and agent_settled {aborted:false} appear on success too, so neither marks a
// failure; only the last assistant stop and the last retry verdict count, because a transient
// error that recovered ends with a later, clean verdict
export function classifyRunLog(path: string): boolean {
	let text: string;
	try {
		text = readLogTail(path);
	} catch {
		return false;
	}
	let stopReason: string | undefined;
	let retryFailed = false;
	let resultFailed = false;
	for (const line of text.split("\n")) {
		if (!line.startsWith("{")) continue; // stderr or progress text in the same log
		let rec: any;
		try {
			rec = JSON.parse(line);
		} catch {
			continue; // the tail cut a record in half, or the agent printed JSON-like text
		}
		if ((rec?.type === "message_end" || rec?.type === "turn_end") && rec.message?.role === "assistant" && typeof rec.message.stopReason === "string") {
			stopReason = rec.message.stopReason;
		} else if (rec?.type === "auto_retry_end") retryFailed = rec.success === false;
		else if (rec?.type === "result") resultFailed = rec.is_error === true || (typeof rec.subtype === "string" && rec.subtype.startsWith("error_"));
	}
	return (stopReason !== undefined && FAILED_STOP_REASONS.has(stopReason)) || retryFailed || resultFailed;
}

// one JSONL log line -> the compacted line, or null to drop it. The moderate drop list: the
// run-opening system prompt echoes (message_start/end with role=system, the ~135 KB sections
// payload), agent_end's full message replay, and the toolResult message_start (the full tool
// result echoed a second time); message_update loses its per-record usage envelope. Everything
// the read path renders survives byte-for-byte: message_update deltas, tool calls, full tool
// results (the subagent-log matching needs them), turn replays, and non-system message_end
// records (the user prompt's qualifies).
// claude stream-json records follow the same policy: the stream_event wrappers (only written
// with --include-partial-messages) duplicate what the authoritative assistant/user records
// carry, so they drop; system init, assistant, user and result keep verbatim.
export function compactLogLine(line: string): string | null {
	if (!line.startsWith("{")) return line; // non-JSON stderr passes through unchanged
	let rec: any;
	try {
		rec = JSON.parse(line);
	} catch {
		return line; // not JSON either: pass through unchanged
	}
	if (!rec || typeof rec.type !== "string") return line;
	switch (rec.type) {
		case "message_start":
		case "message_end":
			if (rec.message?.role === "system") return null;
			if (rec.type === "message_start" && rec.message?.role === "toolResult") return null;
			return line; // kept verbatim
		case "agent_end":
			delete rec.messages; // the full message replay; the rest of the record stays
			return JSON.stringify(rec);
		case "message_update":
			if (rec.assistantMessageEvent === undefined) {
				delete rec.usage;
				return JSON.stringify(rec);
			}
			return JSON.stringify({ type: "message_update", assistantMessageEvent: rec.assistantMessageEvent });
		case "stream_event":
			return null; // claude deltas: the assistant/user records that follow repeat the content
		default:
			return line; // kept verbatim, byte-for-byte
	}
}
