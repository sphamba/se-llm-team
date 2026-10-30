import { statSync } from "node:fs";
import { join } from "node:path";
import { getTask, hasHold, isSelfWrite, kanbanDir, listAll, PRIORITY_RANK, ROLE_NOTES_RE, setState, taskFiles, taskSlug, updateAttrs, type Task } from "../../kanban.ts";
import { agentPid, pidAlive, pidEntry } from "../../pid.ts";
import { RESPAWN_CAP, type Config } from "../config.ts";
import { log, readCounter } from "../log.ts";
import { spawnAgent } from "../spawn.ts";
import { clearContextSymlinks } from "../context.ts";
import { ensureWorktree } from "../board.ts";

// moderate and complex to-do tasks meet the Splitter first: the task stays in to-do while the
// Splitter decomposes it (or declines), and the dead splitter pid file routes the fallback to
// the Developer below with no second splitter pass
const SPLITTER_COMPLEXITIES = new Set(["moderate", "complex"]);

// the states the maxParallel cap counts: state-based, so a task whose agent died still holds
// its slot until the poll requeues it; liveness.ts owns the same set but imports this module,
// so the literals are repeated here
const WORKING_CAP_STATES = new Set(["doing", "reviewing", "merging", "live-testing"]);

export function runningCount(root: string): number {
	return listAll(root).filter((task) => WORKING_CAP_STATES.has(task.state)).length;
}

// the later pipeline stage first, so a task closer to done never waits behind one that has not
// started. Every other state shares one fallback rank: none of them spawns from the board order
// loop, so their relative order does not matter, and a missing rank never yields NaN
const STAGE_RANK: Record<string, number> = { "to-live-test": 0, "to-merge": 1, "to-review": 2, "to-do": 3 };

// one global board order: priority, then stage, then creation order (the name sort from
// taskFiles, kept by the stable sort because a full tie returns 0)
export const boardOrder = (a: Task, b: Task) =>
	(PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4) || (STAGE_RANK[a.state] ?? 5) - (STAGE_RANK[b.state] ?? 5);

export function startTodo(root: string, cfg: Config, task: Task, tasks: Task[]): void {
	const slug = taskSlug(task.file);
	// a manual to-do rewrite can land while the spawned agent still runs: the live pid is the
	// guard, the state alone is not, or a second sweep spawns a twin that overwrites the pid file
	if (pidAlive(agentPid(root, slug))) return;
	// the Splitter rewrites and moves the parent mid-sweep, so the loop's snapshot can be stale:
	// act on the file on disk, not on the snapshot, or a stale to-do call undoes the split
	const fresh = getTask(root, task.file);
	if (!fresh || fresh.state !== "to-do") return;
	// the same gate as the promotion loop: a held token or a blocker that still blocks keeps the
	// task in to-do, and removing the hold restarts the path with the Splitter first because no
	// splitter marker was written
	if (blockedByUndone(tasks, fresh)) return;
	if (SPLITTER_COMPLEXITIES.has(fresh.complexity ?? "")) {
		// splitting off: the task skips the decomposition and starts its Developer directly
		if (!cfg.splitting) log(root, `${fresh.file}: splitting is off, moving to the developer`);
		else {
			const entry = pidEntry(root, `${slug}.splitter`);
			if (pidAlive(entry.pid, entry.disc)) return;
			// no splitter pid file yet: the Splitter runs detached at the project root (it works the
			// board through the kanban tools and needs no worktree), the task stays to-do
			if (entry.pid === 0) {
				spawnAgent(root, cfg, "splitter", fresh, root, `${slug}.splitter`);
				return;
			}
			// a dead splitter pid file means the Splitter ran and left the task in to-do (a decline
			// or a crash): clear its root run link, then fall through to the Developer, no second
			// splitter pass. liveness never sees the pid, so the cleanup happens here instead
			clearContextSymlinks(root, fresh, { rootCwd: true });
		}
	}
	const ensured = ensureWorktree(root, fresh);
	if (!ensured) return;
	// at the maxParallel cap the start waits: the task stays to-do for the next rescan
	if (cfg.maxParallel > 0 && runningCount(root) >= cfg.maxParallel) return;
	// state before spawn: the next sweep reads doing and defers, with the pid check as the belt
	setState(root, fresh, "doing");
	spawnAgent(root, cfg, "developer", { ...fresh, worktree: ensured.wt }, ensured.wtDir);
}

// past RESPAWN_CAP the fresh agent waits for the idle cooldown: the unconditional bounce
// still moves the task back one step, only the respawn backs off. The task file's update
// time is the idle clock (the bounce's setState wrote it). Read before any write:
// ensureWorktree/setWorktree bump the mtime and would restart the clock mid-check
export function deadCooldownActive(root: string, cfg: Config, task: Task): boolean {
	if (readCounter(root, `${taskSlug(task.file)}.dead`) <= RESPAWN_CAP) return false;
	return Date.now() - statSync(join(kanbanDir(root), task.file)).mtimeMs < cfg.retryIdleMinutes * 60_000;
}

// unprefixed files sort last (MAX_SAFE_INTEGER), distinct from kanban.ts taskNum (0)
const sortNum = (file: string) => {
	const n = parseInt(file.slice(0, 6), 10);
	return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

// a blockedBy entry ("#<num>") holds the task while its blocker exists and still blocks;
// done and the live test count as satisfied (the live test runs on the merged commit, so a
// blocker that reached it no longer gates the dependent's start), and a ref resolving to no
// existing task is ignored
const BLOCKER_SATISFIED = new Set(["done", "to-live-test", "live-testing"]);

export function blockedByUndone(tasks: Task[], task: Task): boolean {
	// the hold tokens are blockers no state satisfies: only the PM removes them
	if (hasHold(task.blockedBy)) return true;
	if (!task.blockedBy) return false;
	const states = new Map(tasks.map((t) => [sortNum(t.file), t.state]));
	return task.blockedBy.split(",").some((ref) => {
		const num = parseInt(ref.trim().replace(/^#/, ""), 10);
		return num > 0 && states.get(num) !== undefined && !BLOCKER_SATISFIED.has(states.get(num));
	});
}

// blockedBy always means blockers that still block: once a blocker reaches done or enters
// the live test, the daemon drops its ref from every task that listed it, in the same sweep
// (the PM used to maintain the list by hand). Attribute-only rewrite through updateAttrs:
// nothing else is touched, and a task with nothing to drop stays byte-for-byte. Ghost or
// malformed refs stay: their blocker never satisfied. The kept list is recomputed from a
// fresh read just before the write: the snapshot predates this pass, so a ref the PM added
// or removed mid-sweep must win over the snapshot's
export function dropDoneBlockers(root: string, tasks: Task[]): void {
	// a conflicted file parses bogus state values: never proof that a blocker satisfied
	const satisfied = new Set(tasks.filter((t) => BLOCKER_SATISFIED.has(t.state) && !t.conflicted).map((t) => sortNum(t.file)));
	for (const task of tasks) {
		// snapshot blockedBy as a cheap pre-filter: a task the snapshot shows without a satisfied
		// ref gets its drop, if any, on the next sweep that sees it (a mid-sweep edit only defers)
		if (!task.blockedBy || task.conflicted) continue;
		const hasDoneRef = task.blockedBy.split(",").some((ref) => {
			const num = parseInt(ref.trim().replace(/^#/, ""), 10);
			return num > 0 && satisfied.has(num);
		});
		if (!hasDoneRef) continue;
		// a vanished task is gone; a conflicted file parses bogus values: never rewrite it
		const current = getTask(root, task.file);
		if (!current || current.conflicted || !current.blockedBy) continue;
		const dropped: string[] = [];
		const kept = current.blockedBy.split(",").map((ref) => ref.trim()).filter((ref) => {
			if (!ref) return false;
			const num = parseInt(ref.replace(/^#/, ""), 10);
			if (num > 0 && satisfied.has(num)) {
				dropped.push(ref);
				return false;
			}
			return true;
		});
		if (!dropped.length) continue;
		try {
			updateAttrs(root, current, { blockedBy: kept.join(", ") });
			log(root, `${task.file}: dropped satisfied blocker ref(s) ${dropped.join(", ")}`);
		} catch (err) {
			log(root, `blockedBy update of ${task.file} failed: ${err instanceof Error ? err.message : err}`);
		}
	}
}

// the deferral episode is per root and logs once on the open -> deferred flip: sweeps run every
// few seconds, so per-sweep logging would flood the log
const deferredRoots = new Set<string>();

// promotion is event-driven: every sweep and every poll promotes EVERY schedulable backlog
// task, not one per idle window. A board-wide PM quiet window (backlogIdleMinutes) gates it:
// the PM may still be creating or chaining a batch of tasks, so any fresh task-file mtime
// defers all promotion until the board sits idle, except the daemon's own writes (isSelfWrite):
// counting those re-armed the gate on every state transition and blocker drop, defeating the
// same-sweep unblock (#211). Unchained tasks promote and run as parallel lanes the moment a
// lane frees; the blockedBy chain (the PM encodes it at creation) serializes what must
// serialize. Returns the promoted tasks (state to-do), the report's Scheduled section; exported
// for the tests. force skips the quiet window: a poke is the PM's explicit "I am done editing,
// schedule now"
export function promoteBacklog(root: string, tasks: Task[], backlogIdleMinutes = 0, force = false): Task[] {
	// board-wide on purpose: one quiet gate for the whole board, so a fresh task file created
	// or chained mid-batch defers everything. 0 disables the wait
	if (backlogIdleMinutes > 0 && !force) {
		let newest = 0;
		let newestFile = "";
		for (const file of taskFiles(root)) {
			// role notes (AGENTS.<role>.md) are daemon-written board mirror files, not tasks:
			// ensureRoleNotes writes a fresh one at the first agent spawn, and that write must
			// not read as PM activity and defer promotion for another whole window
			if (ROLE_NOTES_RE.test(file)) continue;
			try {
				const path = join(kanbanDir(root), file);
				const mtimeMs = statSync(path).mtimeMs;
				// a future mtime (clock skew) never ages: it would hold the gate shut for the whole skew
				if (mtimeMs > Date.now()) continue;
				// the daemon's own writes are not board activity: a blocker reaching done must
				// still promote its dependents in the same sweep
				if (isSelfWrite(path, mtimeMs)) continue;
				if (mtimeMs > newest) {
					newest = mtimeMs;
					newestFile = file;
				}
			} catch {
				/* vanished between readdir and stat: not the newest */
			}
		}
		if (Date.now() - newest < backlogIdleMinutes * 60_000) {
			if (!deferredRoots.has(root)) {
				deferredRoots.add(root);
				log(root, `promotion deferred, newest task write ${Math.round((Date.now() - newest) / 1000)}s ago (${newestFile})`);
			}
			return [];
		}
	}
	// the gate opened (or a forced sweep skipped it): the episode is over, the next deferral logs
	deferredRoots.delete(root);
	const promoted: Task[] = [];
	// the same global order as the state pass, so the higher priority promotes first. A task
	// promoted here seats in the next sweep, because this pass runs after the state loop
	for (const task of [...tasks].sort(boardOrder)) {
		// conflicted files parse bogus state values: never promotable
		if (task.conflicted || task.state !== "backlog") continue;
		// unanswered open questions mean the task waits for the user: never promote it, even when
		// a hand edit cleared the question token on the task
		if (task.openQuestions) continue;
		// unfinished blockers hold the task
		if (blockedByUndone(tasks, task)) continue;
		// the snapshot predates this pass (dropDoneBlockers and earlier promotions already
		// wrote): an edit that landed in between (a done rewrite, a blockedBy ref, open
		// questions) must win, so the three gates re-check on a fresh board read just before
		// the promotion. A vanished task is gone: skip
		const board = listAll(root);
		const fresh = board.find((t) => t.file === task.file);
		if (!fresh || fresh.conflicted || fresh.state !== "backlog" || fresh.openQuestions || blockedByUndone(board, fresh)) continue;
		log(root, `promoting ${task.file} to to-do (blockers done)`);
		try {
			setState(root, fresh, "to-do");
			promoted.push({ ...fresh, state: "to-do" });
		} catch (err) {
			log(root, `promotion of ${task.file} failed: ${err instanceof Error ? err.message : err}`);
		}
	}
	return promoted;
}
