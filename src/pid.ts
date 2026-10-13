import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { kanbanDir } from "./kanban.ts";

export const pidPath = (root: string, name: string) => join(kanbanDir(root), ".pids", `${name}.pid`);

// /proc/<pid>/stat field 22 (starttime, ticks since boot): a discriminator that survives pid
// reuse, since a recycled pid starts at a different tick. comm (field 2) can contain spaces
// and parens, so parse after the last ')'; fields[0] after it is state (field 3), which puts
// field 22 at index 19 and pgrp (field 5) at index 2. Null when /proc is unreadable (non-Linux)
function procStartTicks(pid: number): string | null {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
	} catch {
		return null;
	}
}

// process-group id (field 5): equal to the pid only when the process leads its own group,
// which every detached agent spawn does (the sh wrapper heads a fresh group)
function procPgrp(pid: number): string | null {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2] ?? null;
	} catch {
		return null;
	}
}

function procCmdline(pid: number): string | null {
	try {
		return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim() || null;
	} catch {
		return null;
	}
}

// the discriminator recorded next to a pid: the process start time, or the cmdline when the
// start time is unreadable; null when neither is available (non-Linux keeps today's behavior)
function pidDiscriminator(pid: number): string | null {
	return procStartTicks(pid) ?? procCmdline(pid);
}

export function pidAlive(pid: number, disc?: string | null): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	// /proc readable for this pid: compare the discriminator, so a recycled pid reads dead
	// even though kill(pid, 0) would pass. An unreadable /proc entry (dead pid, or non-Linux)
	// falls through to the signal check, which is correct in both cases (ESRCH: dead)
	if (disc != null && procStartTicks(pid) !== null) return pidDiscriminator(pid) === disc;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM"; // exists but not signalable: still alive
	}
}

export function writePid(root: string, name: string, pid: number): void {
	mkdirSync(dirname(pidPath(root, name)), { recursive: true });
	// the discriminator next to the pid makes the liveness check pid-reuse-proof: a recycled
	// pid re-reads dead because its start time (or cmdline) no longer matches
	const disc = pidDiscriminator(pid);
	writeFileSync(pidPath(root, name), disc === null ? String(pid) : `${pid} ${disc}`);
}

export function clearPid(root: string, name: string): void {
	try {
		rmSync(pidPath(root, name));
	} catch {
		/* already gone */
	}
}

// parseInt stops at the space, so a "<pid> <disc>" file still reads as the pid;
// a missing or garbage file reads 0
export function agentPid(root: string, slug: string): number {
	return pidEntry(root, slug).pid;
}

// a pid file's entry: the pid plus its discriminator, for the reuse-proof liveness check;
// a legacy pid-only file (or a missing one) reads a null discriminator
export function pidEntry(root: string, name: string): { pid: number; disc: string | null } {
	try {
		const raw = readFileSync(pidPath(root, name), "utf8").trim();
		const [pidStr, ...rest] = raw.split(/\s+/);
		return { pid: parseInt(pidStr, 10) || 0, disc: rest.length ? rest.join(" ") : null };
	} catch {
		return { pid: 0, disc: null };
	}
}

// liveness of the agent a pid file names: the discriminator decides, so a pid recycled by
// another process reads dead instead of wedging the gate and the state transitions
export function agentAlive(root: string, name: string): boolean {
	const { pid, disc } = pidEntry(root, name);
	return pidAlive(pid, disc);
}

// kill a spawned agent: the pid file names the sh wrapper (the exit-code recorder), so a bare
// pid kill would orphan the real agent running under it. When the pid leads its own process
// group (every detached agent spawn does), signal the whole group; a hand-written pid file
// can name a non-leader (a test's own child), so the pgrp read keeps the group kill precise.
// Falls back to the single pid when /proc is unreadable (non-Linux)
export function killTree(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
	if (procPgrp(pid) === String(pid)) {
		try {
			process.kill(-pid, signal);
			return true;
		} catch {
			/* group gone: fall through to the single-pid kill */
		}
	}
	try {
		process.kill(pid, signal);
		return true;
	} catch {
		return false; // already gone
	}
}
