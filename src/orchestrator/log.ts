import { appendFileSync, fstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { kanbanDir } from "../kanban.ts";
import { agentAlive } from "../pid.ts";
import { evictLogCaches } from "../webui/payload.ts";
import { compactLogLine } from "./classify.ts";

export const logPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.log`);
export const counterPath = (root: string, name: string) => join(kanbanDir(root), ".logs", `${name}.count`);

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

// raw agent logs are compacted retro-actively, in every sweep, at run end (poll) and via
// --compact-logs: the log fd belongs to the child, so the write-time pipe (whose read end
// lived in the daemon and died with it, EPIPE-killing the agent) cannot come back
// retro-compact pass, wired into every sweep, at detected run ends (poll) and one-time via
// --compact-logs: rewrite finished agent logs through the compactor into <name>.log.gz and
// drop the plain file, so a finished run's raw JSONL stops growing the disk. A log whose
// writer may still be alive is skipped: the liveness of the pid each guard file names, so a
// finished run's stale pidfile no longer blocks the pass. Non role-log names
// (orchestrator.log, counters, review-base markers) and already-gzipped logs never match the
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
		const m = name.match(/^(.+)\.(developer|reviewer|live-tester|merger)(\.\d+)?\.log$/) ?? name.match(/^(.+)\.([a-z-]+)\.(\d+)\.doctor\.log$/);
		if (!m) continue;
		// the project-wide lane roles write one pid for the whole lane, never a <slug>.pid: their
		// run log is live while that lane pid is, so it must stay plain and appendable
		const guards = m[0].endsWith(".doctor.log")
			? [`${m[1]}.${m[2]}.${m[3]}.analysis`]
			: m[2] === "merger"
				? ["merger", `${m[1]}.merger`]
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
