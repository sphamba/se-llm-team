import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { kanbanDir } from "../kanban.ts";
import { agentAlive } from "../pid.ts";
import { evictLogCaches } from "../webui/payload.ts";

export const logPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.log`);
export const counterPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.count`);
// one-shot marker that the last spawn from the to-review path was a reviewer; the value is
// that spawn's pid, so a later developer spawn (pidfile overwrite) or a poll-cleared pidfile
// (died run) reads as a mismatch and never counts as a reviewer success
export const armedPath = (root: string, slug: string) => join(kanbanDir(root), ".logs", `${slug}.reviewer-armed`);

// the slug's newest run log's role: a self-advanced run (the reviewer sets to-merge itself)
// names its own role in the log name (.logs/<slug>.<role>.<n>.log). Only the slug-named roles
// count: the merger's exits ride the global merger pid/exit pair, so the stale pair the
// self-advanced path keys on never belongs to a merger run, and a merger log (a crashed
// merger's, newest by mtime) must not shadow the exited run. The .gz replacement counts too:
// every sweep gzips finished logs (compactFinishedLogs), so the log is usually already
// compacted when the poll's next pass detects the self-advanced exit
export function newestRunRole(root: string, slug: string): string | null {
	let best: { role: string; mtime: number } | null = null;
	try {
		const logs = join(kanbanDir(root), ".logs");
		for (const f of readdirSync(logs)) {
			const m = f.match(/^(.+)\.(developer|reviewer|live-tester|integration-tester)\.\d+\.log(?:\.gz)?$/);
			if (!m || m[1] !== slug) continue;
			const mtime = statSync(join(logs, f)).mtimeMs;
			if (!best || mtime > best.mtime) best = { role: m[2], mtime };
		}
	} catch {
		/* no logs dir yet */
	}
	return best ? best.role : null;
}

// stdout and the log file can be the same open file: orchestrator_start spawns the daemon
// with stdio ["ignore", log, log], so an unconditional stdout echo would write every line
// twice. Echo only when stdout is a different file (a terminal, a pipe, a test harness) ---
function stdoutIsLog(logFile: string): boolean {
	try {
		const out = fstatSync(1);
		const file = statSync(logFile);
		return out.dev === file.dev && out.ino === file.ino;
	} catch {
		return false; // unresolvable: keep the echo, the file append already carries the line
	}
}

export function log(root: string, message: string): void {
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	const line = `[${new Date().toISOString()}] ${message}`;
	const file = logPath(root, "orchestrator");
	appendFileSync(file, line + "\n");
	if (!stdoutIsLog(file)) process.stdout.write(line + "\n");
}

export function readCounter(root: string, name: string): number {
	try {
		return parseInt(readFileSync(counterPath(root, name), "utf8").trim(), 10) || 0;
	} catch {
		return 0;
	}
}

export function bumpCounter(root: string, name: string): number {
	const n = readCounter(root, name) + 1;
	writeFileSync(counterPath(root, name), String(n));
	return n;
}
// next per-run index for a task+role log: 1 + the max existing `<slug>.<role>.<n>.log` index;
// a legacy unsuffixed `<slug>.<role>.log` never counts, so the first indexed run is 0. The
// sweep's .log.gz replacements count too: a gzipped run keeps its index, so a fresh spawn
// never re-creates a used index and overwrites the gzipped history
export function nextRunIndex(root: string, slug: string, role: string): number {
	const prefix = `${slug}.${role}.`;
	let max = -1;
	try {
		for (const f of readdirSync(join(kanbanDir(root), ".logs"))) {
			if (!f.startsWith(prefix)) continue;
			const m = f.slice(prefix.length).match(/^(\d+)\.log(?:\.gz)?$/);
			if (m) max = Math.max(max, parseInt(m[1], 10));
		}
	} catch {
		/* no .logs dir yet: first run is 0 */
	}
	return max + 1;
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

// raw agent logs are compacted retro-actively, in every sweep, at run end (poll) and via
// --compact-logs: the log fd belongs to the child, so the write-time pipe (whose read end
// lived in the daemon and died with it, EPIPE-killing the agent) cannot come back
// retro-compact pass, wired into every sweep, at detected run ends (poll) and one-time via
// --compact-logs: rewrite finished agent logs through the compactor into <name>.log.gz and
// drop the plain file, so a finished run's raw JSONL stops growing the disk. A log whose
// writer may still be alive is skipped: the liveness of the pid each guard file names, so a
// finished run's stale pidfile no longer blocks the pass. Non role-log names
// (orchestrator.log, counters, armed markers) and already-gzipped logs never match the
// pattern, so the pass is idempotent. A doctor log (000250) joins the role logs once its
// analysis is no longer alive: the guard is its <slug>.<role>.<n>.analysis pid file. The .gz
// is renamed into place before the plain file is
// removed: a crash between the two leaves both, and the next pass re-gzips the plain file
// over the old .gz
export function compactFinishedLogs(root: string): { files: number; before: number; after: number } {
	const result = { files: 0, before: 0, after: 0 };
	let names: string[];
	try {
		names = readdirSync(join(kanbanDir(root), ".logs"));
	} catch {
		return result;
	}
	for (const name of names) {
		// role-log name pattern: <slug>.<role>[.<n>].log, plus the analysis pass logs
		// <slug>.<analysed role>[.<n>].doctor.log (000250: doctor logs gzip like role logs)
		const m = name.match(/^(.+)\.(developer|reviewer|live-tester|merger|integration-tester)(\.\d+)?\.log$/) ?? name.match(/^(.+)\.([a-z-]+)\.(\d+)\.doctor\.log$/);
		if (!m) continue;
		// the project-wide lane roles write one pid for the whole lane, never a <slug>.pid: their
		// run log is live while that lane pid is, so it must stay plain and appendable
		const guards = m[0].endsWith(".doctor.log")
			? [`${m[1]}.${m[2]}.${m[3]}.analysis`]
			: m[2] === "merger"
				? ["merger", `${m[1]}.merger`]
				: m[2] === "integration-tester"
					? ["integration-tester"]
					: [m[1]];
		if (guards.some((g) => agentAlive(root, g))) continue;
		const path = join(kanbanDir(root), ".logs", name);
		let before: string;
		try {
			before = readFileSync(path, "utf8");
		} catch {
			continue; // raced away or an unresolvable entry (a broken symlink): the next pass retries
		}
		const after = before.split("\n").map(compactLogLine).filter((l) => l !== null).join("\n");
		const tmp = `${path}.gz.compact-tmp`;
		try {
			const gz = gzipSync(Buffer.from(after, "utf8"));
			writeFileSync(tmp, gz);
			renameSync(tmp, `${path}.gz`);
			rmSync(path);
			evictLogCaches([path]);
			result.files++;
			result.before += Buffer.byteLength(before);
			result.after += gz.length;
		} catch {
			try {
				rmSync(tmp, { force: true });
			} catch {
				/* keep the original */
			}
		}
	}
	return result;
}
