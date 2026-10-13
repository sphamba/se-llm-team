import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTask, kanbanDir, listAll, setState, taskSlug, type Task, type TaskState } from "../kanban.ts";
import { clearPid, pidAlive, pidEntry } from "../pid.ts";
import { RESPAWN_CAP } from "./config.ts";
import { bumpCounter, compactFinishedLogs, counterPath, log, logPath, nextRunIndex, readCounter } from "./log.ts";
import { getMergerLogSlug } from "./spawn.ts";
import { dropDoneBlockers, promoteBacklog } from "./pipeline.ts";

// the working states with an agent out: next is the one-state-back bounce target when the
// agent dies, role is the agent role whose per-run log (.kanban/.logs/<slug>.<role>.<n>.log)
// the stall check samples
const WORKING_STATES: Partial<Record<TaskState, { next: TaskState; role: string }>> = {
	doing: { next: "to-do", role: "developer" },
	reviewing: { next: "to-review", role: "reviewer" },
	"live-testing": { next: "to-live-test", role: "live-tester" },
	merging: { next: "to-merge", role: "merger" },
};

// a live-but-hung agent passes pidAlive forever: the stall check kills it by its log instead
// (the window itself is the logStallMinutes config, default DEFAULT_LOG_STALL_MINUTES)
// per-daemon log-size samples for the stall check: "<slug>.<role>" -> the sampled log path,
// its size and the time that size was first seen; a daemon restart restarts the window
const logSamples = new Map<string, { path: string; size: number; since: number }>();
// every sample of one task's agent logs: dropped when the task leaves the working states or
// its pid dies (the dead-pid path owns it then)
function dropLogSamples(slug: string): void {
	for (const key of logSamples.keys()) {
		if (key.startsWith(`${slug}.`)) logSamples.delete(key);
	}
}

// the stall check for one working-state task with a live agent: sample the newest per-run
// log's size and report a stall when the size is unchanged for the whole window. No per-run
// log (nothing indexed yet, or vanished between readdir and stat) => no sample, no check
function logStalled(root: string, slug: string, role: string, stallMinutes: number, now: number): boolean {
	const key = `${slug}.${role}`;
	const n = nextRunIndex(root, slug, role) - 1;
	if (n < 0) {
		logSamples.delete(key);
		return false;
	}
	const path = logPath(root, `${slug}.${role}.${n}`);
	let size: number;
	try {
		size = statSync(path).size;
	} catch {
		logSamples.delete(key);
		return false;
	}
	const prev = logSamples.get(key);
	// a new run (new file) or any size change restarts the window
	if (!prev || prev.path !== path || prev.size !== size) {
		logSamples.set(key, { path, size, since: now });
		return false;
	}
	return now - prev.since >= stallMinutes * 60_000;
}

// one bounce for both death kinds (dead pid, stalled log): SIGTERM the agent on request,
// clear its pid files, re-read the task and move it one state back when the state has not
// moved on, then bump the death counter so the respawn machinery takes over (immediate under
// the cap, idle-cooldown past it). The bounce itself is unconditional past RESPAWN_CAP: a
// frozen mid-flight task is worse than a bounced one, only the respawn backs off
function bounceDead(root: string, task: Task, next: TaskState, pidName: string, pid: number, kill: boolean): void {
	const slug = taskSlug(task.file);
	dropLogSamples(slug);
	if (kill) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			/* already gone */
		}
	}
	clearPid(root, pidName);
	// re-read + state-match: a task that moved on underneath (agent, PM or user) wins
	const fresh = getTask(root, task.file);
	if (!fresh || fresh.state !== task.state) return;
	// per-run death marker for the webui's cross: the dying run is the newest run log of the
	// bounced role (the index known at spawn); a fresh respawn (new index) is unaffected and
	// a run that advanced the state itself (the early return above) leaves no marker. The
	// marker lingers after the task moves on - harmless, and never a counter or armed file
	const role = WORKING_STATES[task.state]?.role;
	const n = role ? nextRunIndex(root, slug, role) - 1 : -1;
	if (n >= 0) writeFileSync(join(kanbanDir(root), ".logs", `${slug}.${role}.${n}.dead`), `${pid}\n`);
	setState(root, fresh, next);
	// past the cap the fresh spawn waits for the idle cooldown (the sweep defers it);
	// logged once at cap+1, like the old give-up line
	if (bumpCounter(root, `${slug}.dead`) === RESPAWN_CAP + 1) {
		log(root, `${slug}: agent died ${RESPAWN_CAP}+ times; respawn waits for the idle cooldown (state ${next})`);
	}
}

// now is injectable so the stall window is testable without waiting out real minutes
export function poll(root: string, stallMinutes: number, now = Date.now()): void {
	// a run ended this pass (a bounced working agent, or the stale pidfile of a completed one):
	// the ended logs are raw, so the pass ends with their retro-compact
	let ended = false;
	// one snapshot serves the liveness loop and the promotion: tasks bounced mid-poll are no
	// longer backlog, so the stale snapshot cannot promote them again
	const tasks = listAll(root);
	for (const task of tasks) {
		try {
			// no state rewrite on a conflicted file: the parse is bogus and the merger owns resolution
			if (task.conflicted) continue;
			const working = WORKING_STATES[task.state];
			const slug = taskSlug(task.file);
			// a merging task's agent is the project-wide merger (the global pid file); every other
			// state maps to the task's own agent pid. Clear before the transition check: a pidfile
			// for a state with no transition (to-merge, done) would otherwise linger forever
			const pidName = task.state === "merging" ? "merger" : slug;
			const { pid, disc } = pidEntry(root, pidName);
			if (pidAlive(pid, disc)) {
				// a live pid is stalled when its per-run log size is unchanged for the whole window:
				// bounced and killed like a dead agent. A merging task only samples while the live
				// merger is its own (see mergerLogSlug); outside the working states there is no
				// check, and stale samples are dropped
				if (working && (task.state !== "merging" || getMergerLogSlug() === slug) && logStalled(root, slug, working.role, stallMinutes, now)) {
					log(root, `${task.file}: agent log unchanged for ${stallMinutes}+ min, assuming dead (state ${task.state})`);
					ended = true;
					bounceDead(root, task, working.next, pidName, pid, true);
				} else if (!working) {
					dropLogSamples(slug);
				}
				continue;
			}
			// a dead or missing pid: the dead-pid path owns the task, its stall samples are dropped
			dropLogSamples(slug);
			const hadPid = pid > 0;
			clearPid(root, pidName);
			if (!working) {
				// a completed run leaves its stale pidfile behind, a bounce clears it first, so a
				// stale pidfile here means the agent advanced the task out of the mapped state by
				// its own action: the death streak is over. Clearing on a missing pidfile too would
				// wipe the counter of a past-cap task still waiting out its respawn cooldown
				if (hadPid) {
					ended = true;
					if (readCounter(root, `${slug}.dead`) > 0) {
						writeFileSync(counterPath(root, `${slug}.dead`), "0");
						log(root, `${slug}: run completed, cleared the dead-agent counter`);
					}
				}
				continue;
			}
			// the bounce is unconditional: a frozen mid-flight task is worse than a bounced one
			log(root, `${slug}: agent pid=${pid} dead without state update, ${task.state} -> ${working.next}`);
			ended = true;
			bounceDead(root, task, working.next, pidName, pid, false);
		} catch (err) {
			log(root, `error polling ${task.file} (${task.state}): ${err instanceof Error ? err.message : err}`);
		}
	}
	// the poll promotes too: it is the second event source (rescan is fs.watch-debounced, the
	// poll covers boards without inotify), so promotion never waits for a timer. The done-ref
	// drop runs here too, from the same snapshot: a blocker can reach done between sweeps, and
	// a poll promotion must not leave the promoted task listing a done blocker
	dropDoneBlockers(root, tasks);
	promoteBacklog(root, tasks);
	// the compactor lives in the retro pass now: a run's raw log is rewritten at its end (the
	// write-time pipe is gone - the log fd must survive the daemon, so it cannot be a pipe).
	// compactFinishedLogs skips logs whose writer is still alive
	if (ended) compactFinishedLogs(root);
}
