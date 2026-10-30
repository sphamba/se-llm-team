import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTask, hasHold, listAll, questionOpen, setState, taskFiles, taskSlug } from "../../kanban.ts";
import { agentAlive, agentPid, clearPid, pidAlive } from "../../pid.ts";
import { REVIEWER_RUN_CAP, type Config } from "../config.ts";
import { compactFinishedLogs, counterPath, log, readCounter } from "../log.ts";
import { spawnAgent } from "../spawn.ts";
import { boardStatus, commitKanban, ensureWorktree, git, reconcileBoard } from "../board.ts";
import { reportDone } from "../report.ts";
import { boardOrder, deadCooldownActive, dropDoneBlockers, promoteBacklog, runningCount, startTodo } from "./schedule.ts";
import { clearMergerAttempt, doneCleanup, reconcileMergeAsks, releaseStuckMerge, sweepToMerge } from "./merge.ts";
import { clearMergerSlug } from "../spawn.ts";
import { clearStaleReviewBases, recordReviewBase } from "./review.ts";
import { janitorPids, reconcileQuestions } from "./reconcile.ts";

export { boardOrder, dropDoneBlockers, promoteBacklog } from "./schedule.ts";
export { finishMerge, mergeAskPath, mergeStuck, stuckPath } from "./merge.ts";
export { decideReview, reviewBasePath } from "./review.ts";

export function rescan(root: string, cfg: Config, force = false): void {
	// root-cause fix ordering: a snapshot commit must never be built from a tree that lacks
	// branch-only files, so an external mirror-head move is materialized before boardStatus
	// reads and before any commitKanban
	reconcileBoard(root);
	// one board snapshot per sweep: a file created after this read must not fold into an
	// in-flight commit's label (whole-board tree) or its own create event never surfaces
	const files = taskFiles(root);
	const status = boardStatus(root, files);
	const tasks = listAll(root);
	// a stuck merge waits for the PM, and the repair shows up as a base that contains the branch.
	// The release runs before the lanes, so a repaired merge frees the Merge column in this sweep
	for (const task of tasks) releaseStuckMerge(root, task);
	const created = new Set<string>();
	// sole commit points: board files not on the mirror yet are new, finished tasks fold in
	// their whole life; everything else stays unmirrored until done. Creates run first:
	// commitKanban rebuilds the tree from the whole board, so a done commit later in the
	// sweep would fold pending creates under its label and the create events would never
	// surface on the mirror
	for (const task of tasks) {
		try {
			if (task.conflicted) continue;
			if (status.get(join(".kanban", task.file)) === "??" && commitKanban(root, `kanban: create ${task.file}`, files)) created.add(task.file);
		} catch (err) {
			log(root, `error handling ${task.file} (create): ${err instanceof Error ? err.message : err}`);
		}
	}
	// the PM merge gate runs before the state loop, so the pass that holds a task never merges it
	reconcileMergeAsks(root, cfg, tasks);
	// priority-first state pass: priority, then the later pipeline stage, then creation order
	const ordered = [...tasks].sort(boardOrder);
	for (const task of ordered) {
		try {
			// a conflicted file parses bogus values (duplicate keys resolve last-wins, the merged-in
			// side wins); rewriting or acting on it would resolve the merge with stale state, so
			// leave it untouched until the merger or the user resolves it
			if (task.conflicted) {
				log(root, `${task.file}: unresolved merge conflict markers, skipping (merger or user resolves)`);
				continue;
			}
			// "??" here means the pass-one create commit failed (git error): retry it. The map is
			// the sweep-start snapshot, so a create that already landed still reads "??" and is
			// skipped: a retry after mid-sweep state writes would fold another task's state change
			// into a second "kanban: create" commit
			const code = status.get(join(".kanban", task.file));
			if (code === "??" && !created.has(task.file)) commitKanban(root, `kanban: create ${task.file}`, files);
			if (task.state === "to-do") {
				// a to-do arrival breaks the review streak: a stale count would shorten the next
				// review cycle without a review
				const slug = taskSlug(task.file);
				if (readCounter(root, `${slug}.reviewer-runs`) > 0) {
					writeFileSync(counterPath(root, `${slug}.reviewer-runs`), "0");
					log(root, `${task.file}: back in to-do, review counter reset`);
				}
				// past the respawn cap the fresh developer waits for the idle cooldown (state unchanged)
				if (!deadCooldownActive(root, cfg, task)) startTodo(root, cfg, task, tasks);
			} else if (task.state === "to-review" && !deadCooldownActive(root, cfg, task)) {
				// reviews off: the task skips the reviewer lane and goes straight to the merge
				if (!cfg.reviews) {
					if (hasHold(task.blockedBy) || questionOpen(task)) continue;
					setState(root, task, "to-merge");
					log(root, `${task.file}: reviews are off, moving to to-merge`);
					continue;
				}
				const ensured = ensureWorktree(root, task);
				// a failed spawn would bounce or strand the task; leave the state for the next rescan to retry
				if (!ensured) log(root, `${task.file}: worktree could not be created, reviewer not spawned (state unchanged)`);
				else {
					// a held task keeps to-review and starts no reviewer run; a question the developer just
					// wrote stops it here too, before the reconcile can move it
					if (hasHold(task.blockedBy) || questionOpen(task)) continue;
					const slug = taskSlug(task.file);
					const cap = cfg.reviewerCap[task.complexity] ?? REVIEWER_RUN_CAP;
					if (readCounter(root, `${slug}.reviewer-runs`) >= cap) {
						// re-read before the advance: a state changed underneath (PM or user) wins
						const fresh = getTask(root, task.file);
						if (fresh && fresh.state === "to-review") {
							setState(root, fresh, "to-merge");
							// clears the count, so a future rework cycle starts fresh
							writeFileSync(counterPath(root, `${slug}.reviewer-runs`), "0");
							log(root, `${task.file}: reviewer succeeded ${cap}+ times, moving to to-merge`);
						}
					} else if (!pidAlive(agentPid(root, slug))) {
						// the previous agent for this task (usually the developer writing its report) may
						// still be alive: defer the spawn to a later sweep instead of double-spawning
						// at the maxParallel cap the reviewer spawn waits too: the task stays to-review
						if (cfg.maxParallel > 0 && runningCount(root) >= cfg.maxParallel) continue;
						// the base commit is recorded before the spawn: the reviewer may commit at once
						setState(root, task, "reviewing");
						recordReviewBase(root, slug, ensured.wtDir);
						spawnAgent(root, cfg, "reviewer", task, ensured.wtDir);
					}
				}
			} else if (task.state === "to-live-test" && !deadCooldownActive(root, cfg, task)) {
				// a held task keeps to-live-test and starts no run: the check sits before the
				// merged-branch test, so a hold never requeues the task either
				if (hasHold(task.blockedBy) || questionOpen(task)) continue;
				const slug = taskSlug(task.file);
				// the live test runs on the merged commit: after the rebase + fast-forward the
				// worktree branch head IS the base branch, so an unmerged branch (an in-flight task
				// from a daemon still on the old order, or a manual placement) or a task with no
				// worktree at all goes back to to-merge first, so main never gets tested without
				// this task's merged change
				if (!task.worktree || git(root, ["merge-base", "--is-ancestor", task.worktree, "HEAD"], true) === null) {
					setState(root, task, "to-merge");
					log(root, task.worktree ? `${task.file}: branch not merged yet, moving to to-merge for the orchestrator merge` : `${task.file}: no worktree, moving to to-merge for the orchestrator merge`);
				} else if (!cfg.liveTesting) {
					setState(root, task, "done");
					log(root, `${task.file}: live testing is off, set done`);
				} else if (!agentAlive(root, "merger") && !pidAlive(agentPid(root, slug))) {
					// a live merger would change main under the test (and may still be writing its
					// report), and a stale agent for this task may still write the task file: defer
					// the spawn to a later sweep
					const ensured = ensureWorktree(root, task);
					if (!ensured) log(root, `${task.file}: worktree could not be created, live-tester not spawned (state unchanged)`);
					else {
						// at the maxParallel cap the live-tester spawn waits: the task stays to-live-test
						if (cfg.maxParallel > 0 && runningCount(root) >= cfg.maxParallel) continue;
						setState(root, task, "live-testing");
						spawnAgent(root, cfg, "live-tester", { ...task, worktree: ensured.wt }, ensured.wtDir);
					}
				}
			} else if (task.state === "to-merge") {
				sweepToMerge(root, cfg, task);
			} else if (task.state === "merging") {
				// its merger runs: the liveness poll requeues the task when the merger dies
			} else if (task.state === "done") {
				// cleanup always runs for a done worktree task (the orchestrator merged before setting
				// to-live-test and the live test passed, so only the worktree/branch removal is left);
				// the commit is gated on the file actually differing from the mirror, since
				// an unchanged done task would otherwise issue a whole-board commit every sweep and
				// fold other tasks' pending changes under its label
				doneCleanup(root, task);
				if (code) commitKanban(root, `kanban: done ${task.file}`, files);
			}
		} catch (err) {
			log(root, `error handling ${task.file} (${task.state}): ${err instanceof Error ? err.message : err}`);
		}
	}
	// merger spawn bookkeeping: clear the global merger pid and its slug file once no task is
	// merging and the merger is gone; the failed-merge markers stay while their task waits, and
	// are dropped once the task moved on (a successful merge ends in to-live-test)
	if (!tasks.some((t) => t.state === "merging") && !agentAlive(root, "merger")) {
		clearPid(root, "merger");
		clearMergerSlug(root);
	}
	for (const task of tasks) {
		if (task.state !== "to-merge" && task.state !== "merging") clearMergerAttempt(root, taskSlug(task.file));
	}
	// a task that left the review lane drops its recorded base commit with it
	clearStaleReviewBases(root, tasks);
	janitorPids(root, tasks);
	// the sweep promotes: re-read the board first, because the state loop itself lands done
	// moves (a to-merge with nothing to merge, a hand-set done fold-in); blocker decisions from
	// the pre-loop snapshot would defer the drop and the promotion one sweep, and the promotion
	// would ride no report (a sweep without a done transition queues none). dropDoneBlockers
	// drops satisfied refs first (board hygiene), then promoteBacklog promotes every schedulable
	// backlog task; a blocker in done or the live test does not hold promotion, and
	// promoteBacklog re-checks its gates on a fresh board read before setState
	// the question reconcile runs before the promotion, so a task that just gained the token never
	// promotes in the same sweep
	reconcileQuestions(root);
	const current = listAll(root);
	dropDoneBlockers(root, current);
	const promoted = promoteBacklog(root, current, cfg.backlogIdleMinutes, force);
	// the PM report: the sweep schedules first, then one report covers the tasks that moved to
	// done in this sweep (detected against the pre-loop snapshot, so a done move this sweep made
	// is this sweep's transition) plus what it scheduled
	reportDone(root, tasks, promoted);
	// every sweep: finished agents' logs compact into .log.gz (idempotent; live pids are skipped)
	compactFinishedLogs(root);
}
