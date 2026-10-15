import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTask, kanbanDir, listAll, setState, taskSlug, type Task, type TaskState } from "../kanban.ts";
import { clearPid, killTree, pidAlive, pidEntry } from "../pid.ts";
import { RESPAWN_CAP } from "./config.ts";
import { armedPath, bumpCounter, compactFinishedLogs, counterPath, log, logPath, newestRunRole, nextRunIndex, readCounter } from "./log.ts";
import { clearContextSymlinks, clearExitFile, readExitCode, readMergerSlug, spawnRunAnalysis } from "./spawn.ts";
import { dropDoneBlockers, promoteBacklog } from "./pipeline.ts";

// the working states with an agent out: next is the one-state-back bounce target when the
// agent dies, success is the state the orchestrator moves the task to on a successful finish
// (exit 0), role is the agent role whose per-run log (.kanban/.logs/<slug>.<role>.<n>.log)
// the stall check samples. The reviewer has no success move: it sets the state itself via
// kanban_set_state, so the orchestrator leaves the task for the PM on its exit-0 finish
const WORKING_STATES: Partial<Record<TaskState, { next: TaskState; success: TaskState | null; role: string }>> = {
	doing: { next: "to-do", success: "to-review", role: "developer" },
	reviewing: { next: "to-review", success: null, role: "reviewer" },
	"live-testing": { next: "to-live-test", success: "done", role: "live-tester" },
	merging: { next: "to-merge", success: "to-merge", role: "merger" },
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
		killTree(pid);
	}
	clearPid(root, pidName);
	// re-read + state-match: a task that moved on underneath (agent, PM or user) wins
	const fresh = getTask(root, task.file);
	// the agent terminated: remove its cwd context symlinks from the task's worktree (the next
	// spawn re-points them)
	clearContextSymlinks(root, fresh ?? task);
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

// a completed run re-arms the death streak: without the clear, a stale pidfile (or the
// poll's own exit-0 handling) would defer a later reviewer or merger spawn by a stale cooldown
function clearDeadStreak(root: string, slug: string): void {
	if (readCounter(root, `${slug}.dead`) > 0) {
		writeFileSync(counterPath(root, `${slug}.dead`), "0");
		log(root, `${slug}: run completed, cleared the dead-agent counter`);
	}
}

// now is injectable so the stall window is testable without waiting out real minutes
export function poll(root: string, stallMinutes: number, now = Date.now(), backlogIdleMinutes = 0): void {
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
			// a merging task the merger slug file does not name: the shared pid/exit pair belongs to
			// another task's merger (or no merger was ever recorded). Its own merger run is over
			// either way (a new spawn requires the old merger dead), so requeue it without a death
			// record and leave the shared pair for the task the slug file names
			if (task.state === "merging" && readMergerSlug(root) !== slug) {
				dropLogSamples(slug);
				// re-read + state-match: a task that moved on underneath (PM or user) wins
				const fresh = getTask(root, task.file);
				if (fresh && fresh.state === task.state) {
					ended = true;
					setState(root, fresh, "to-merge");
					log(root, `${slug}: its merger run is over (superseded or unrecorded), merging -> to-merge`);
				}
				continue;
			}
			// a merging task's agent is the project-wide merger (the global pid file); every other
			// state maps to the task's own agent pid. Clear before the transition check: a pidfile
			// for a state with no transition (to-merge, done) would otherwise linger forever
			const pidName = task.state === "merging" ? "merger" : slug;
			const { pid, disc } = pidEntry(root, pidName);
			if (pidAlive(pid, disc)) {
				// a live pid is stalled when its per-run log size is unchanged for the whole window:
				// bounced and killed like a dead agent. A merging task reaching here is the recorded
				// merger's own (mismatches requeue above), so the sampled per-run log is its merger
				// run; outside the working states there is no check, and stale samples are dropped
				if (working && logStalled(root, slug, working.role, stallMinutes, now)) {
					log(root, `${task.file}: agent log unchanged for ${stallMinutes}+ min, assuming dead (state ${task.state})`);
					ended = true;
					bounceDead(root, task, working.next, pidName, pid, true);
				} else if (!working) {
					dropLogSamples(slug);
				}
				continue;
			}
			// a dead or missing pid: the exit file decides between a successful finish and a crash
			dropLogSamples(slug);
			const hadPid = pid > 0;
			const code = readExitCode(root, pidName);
			// an armed reviewer's run just ended (this dead pid is the armed reviewer's): consume
			// the marker here, so the pid-file clear below cannot lose the count before a sweep's
			// consume runs (the approval lands the task in to-merge, where the poll is the first
			// to see the run end). Counted on a successful end (exit 0) only, like the sweeps
			try {
				if (pid > 0 && parseInt(readFileSync(armedPath(root, slug), "utf8").trim(), 10) === pid) {
					rmSync(armedPath(root, slug));
					if (code === 0) bumpCounter(root, `${slug}.reviewer-runs`);
				}
			} catch {
				/* no armed marker for this task */
			}
			// the reviewer exception (exit 0, no success move) keeps the exit file: the next
			// pass re-takes the exception path instead of crash-bouncing the now pid-less task
			if (!(code === 0 && working && !working.success)) clearExitFile(root, pidName);
			clearPid(root, pidName);
			// the agent terminated (or its pid file is stale): remove its cwd context symlinks
			clearContextSymlinks(root, task);
			if (!working) {
				// a completed run leaves its stale pidfile behind, a bounce clears it first, so a
				// stale pidfile here means the agent advanced the task out of the mapped state by
				// its own action: the death streak is over. Clearing on a missing pidfile too would
				// wipe the counter of a past-cap task still waiting out its respawn cooldown
				if (hadPid) {
					ended = true;
					clearDeadStreak(root, slug);
					// a self-advanced run (the reviewer sets to-merge itself) gets analysed too:
					// exit 0 only, a crashed run's log is not analysed, and the role is unknown
					// here, so the slug's newest run log names it
					if (code === 0) {
						const role = newestRunRole(root, slug);
						if (role) spawnRunAnalysis(root, slug, role);
					}
				}
				continue;
			}
			if (code === 0) {
				// successful finish: the pid files are cleared before the state move, so an
				// interleaving sweep cannot spawn the task's next agent and lose its pid file
				ended = true;
				if (working.success) {
					// the orchestrator owns the state move (developer -> to-review, merger ->
					// to-merge, live-tester -> done). Re-read + state-match: a task that moved on
					// underneath (PM or user) wins
					const fresh = getTask(root, task.file);
					if (fresh && fresh.state === task.state) {
						setState(root, fresh, working.success);
						log(root, `${slug}: agent exited 0, ${task.state} -> ${working.success}`);
					}
				} else {
					// the reviewer sets the state itself; exit 0 with the task still in reviewing
					// means its state move never landed: leave the task for the PM, no orchestrator
					// move. The kept exit file makes the exception sticky, so the task waits here
					// until the PM (or a fresh reviewer spawn, which clears the file) moves it
					log(root, `${slug}: reviewer exited 0 with the task still in reviewing; left for the PM`);
				}
				clearDeadStreak(root, slug);
				// every successful agent run gets its log analysed (analyst + doctor), detached so
				// the poll never blocks on it; the spawn skips already-analysed runs itself, so the
				// sticky reviewer exit file never re-fires it
				spawnRunAnalysis(root, slug, working.role);
				continue;
			}
			// non-zero or missing exit code: a crash, today's dead-pid bounce. The bounce is
			// unconditional: a frozen mid-flight task is worse than a bounced one
			log(root, code === null ? `${slug}: agent pid=${pid} dead without state update, ${task.state} -> ${working.next}` : `${slug}: agent pid=${pid} exited ${code} without success, ${task.state} -> ${working.next}`);
			ended = true;
			bounceDead(root, task, working.next, pidName, pid, false);
		} catch (err) {
			log(root, `error polling ${task.file} (${task.state}): ${err instanceof Error ? err.message : err}`);
		}
	}
	// the poll promotes too: it is the second event source (rescan is fs.watch-debounced, the
	// poll covers boards without inotify), gated by the same board-wide PM quiet window as the
	// sweep (backlogIdleMinutes). The done-ref drop runs here too, from the same snapshot: a
	// blocker can reach done between sweeps, and a poll promotion must not leave the promoted
	// task listing a done blocker
	dropDoneBlockers(root, tasks);
	promoteBacklog(root, tasks, backlogIdleMinutes);
	// the compactor lives in the retro pass now: a run's raw log is rewritten at its end (the
	// write-time pipe is gone - the log fd must survive the daemon, so it cannot be a pipe).
	// compactFinishedLogs skips logs whose writer is still alive
	if (ended) compactFinishedLogs(root);
}
