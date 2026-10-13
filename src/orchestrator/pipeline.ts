import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kanbanDir, getTask, listAll, setState, setWorktree, taskFiles, taskSlug, updateAttrs, type Task } from "../kanban.ts";
import { agentAlive, agentPid, clearPid, pidAlive, pidEntry } from "../pid.ts";
import { RESPAWN_CAP, REVIEWER_RUN_CAP, type Config } from "./config.ts";
import { armedPath, bumpCounter, compactFinishedLogs, counterPath, log, readCounter } from "./log.ts";
import { clearMergerSlug, spawnAgent, writeMergerSlug } from "./spawn.ts";
import { boardStatus, commitKanban, ensureWorktree, git, reconcileBoard } from "./board.ts";
import { reportDone } from "./report.ts";

// consumes the armed marker at the state the armed reviewer wrote itself (back to to-review,
// or forward to to-merge on approval): a pid match counts one successful reviewer run; a
// mismatch (died run: the poll clears the pidfile first, or a later developer spawn overwrote
// it) only drops the marker
function consumeReviewerRun(root: string, slug: string): void {
	const path = armedPath(root, slug);
	let armed = 0;
	try {
		armed = parseInt(readFileSync(path, "utf8").trim(), 10) || 0;
	} catch {
		return; // no reviewer armed: the arrival came from the developer or the board
	}
	rmSync(path);
	const pid = agentPid(root, slug);
	if (armed > 0 && armed === pid) bumpCounter(root, `${slug}.reviewer-runs`);
}
function startTodo(root: string, cfg: Config, task: Task): void {
	const slug = taskSlug(task.file);
	// a manual to-do rewrite can land while the spawned agent still runs: the live pid is the
	// guard, the state alone is not, or a second sweep spawns a twin that overwrites the pid file
	if (pidAlive(agentPid(root, slug))) return;
	const ensured = ensureWorktree(root, task);
	if (!ensured) return;
	// state before spawn: the next sweep reads doing and defers, with the pid check as the belt
	setState(root, task, "doing");
	spawnAgent(root, cfg, "developer", { ...task, worktree: ensured.wt }, ensured.wtDir);
}

// one failed-merge marker per task: written when the sweep spawns a merger, it survives the
// merger requeueing the task and daemon restarts. A to-merge task whose marker exists re-runs
// only after it sat idle in to-merge for the idle interval, and the per-task file keeps the
// cooldown of a failed task intact while another task's merger spawns
const mergerAttemptPath = (root: string, slug: string) => join(kanbanDir(root), ".pids", `${slug}.merge-attempted`);

function clearMergerAttempt(root: string, slug: string): void {
	try {
		rmSync(mergerAttemptPath(root, slug));
	} catch {
		/* already gone */
	}
}
// the to-merge sweep: a task the reviewer passed sits in to-merge until the orchestrator
// merges main into the branch worktree, then the branch into main, then syncs the branch with
// --ff-only and sets to-live-test. No merger agent runs on this clean path. On conflicts the
// merge stays in progress in the worktree and a Merger (cwd = the worktree, pidName merger)
// resolves only the conflicts and commits; its successful exit requeues the task to to-merge
// through the poll, and the retry waits for the idle cooldown
function sweepToMerge(root: string, cfg: Config, task: Task): void {
	const slug = taskSlug(task.file);
	// a reviewer approval is a successful run too: consume the armed marker here, since the
	// approval now lands the task straight in to-merge
	consumeReviewerRun(root, slug);
	// the reviewer may still be committing and writing its report after setting to-merge
	if (agentAlive(root, slug)) return;
	// at most one merger at a time, project-wide
	if (agentAlive(root, "merger")) return;
	// a task bounced here past the respawn cap (dead merger) also waits for the idle
	// cooldown before its merge runs
	if (deadCooldownActive(root, cfg, task)) return;
	// an earlier attempt on this task failed and requeued it: retry only after it sat idle in
	// to-merge for the idle interval. Read before any write: ensureWorktree/setWorktree bump the
	// task file's mtime, which is the idle clock, so this check must come first
	if (existsSync(mergerAttemptPath(root, slug)) && Date.now() - statSync(join(kanbanDir(root), task.file)).mtimeMs < cfg.autoScheduleMinutes * 60_000) return;
	const wt = task.worktree;
	if (!wt || (git(root, ["branch", "--list", wt], true) === "" && !existsSync(join(root, ".worktrees", wt)))) {
		// nothing to merge: no worktree and no branch
		setWorktree(root, task, "");
		setState(root, task, "done");
		log(root, `${task.file}: nothing to merge, set done`);
		return;
	}
	// a detached root checkout has no branch to merge into: git merge there would land the
	// change on a dangling commit that the done cleanup then deletes. The old merger guarded
	// this; leave the task in to-merge for the PM, retries wait out the idle cooldown
	if (git(root, ["branch", "--show-current"], true) === "") {
		writeFileSync(mergerAttemptPath(root, slug), "");
		log(root, `${task.file}: root checkout is detached, left in to-merge (PM resolves manually)`);
		return;
	}
	const ensured = ensureWorktree(root, task);
	// a failed worktree creation would strand the task; leave the state for the next rescan to retry
	if (!ensured) {
		log(root, `${task.file}: worktree could not be created, merge not started (state unchanged)`);
		return;
	}
	// step 1: merge main into the branch, in the worktree
	if (git(ensured.wtDir, ["merge", "--no-edit", "main"]) === null) {
		// a failed merge that left MERGE_HEAD is a conflict: leave the merge in progress (no
		// abort) and let the merger resolve only the conflicts; any other failure (dirty
		// worktree, missing ref) requeues for a later sweep with no merger
		mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
		writeFileSync(mergerAttemptPath(root, slug), "");
		if (git(ensured.wtDir, ["rev-parse", "--verify", "-q", "MERGE_HEAD"], true) !== null) {
			log(root, `${task.file}: merge conflicts, merger spawned to resolve them`);
			writeMergerSlug(root, slug);
			spawnAgent(root, cfg, "merger", { ...task, worktree: ensured.wt }, ensured.wtDir, "merger");
			setState(root, task, "merging");
		} else {
			log(root, `${task.file}: merge into the worktree failed, left in to-merge for the retry`);
		}
		return;
	}
	// step 2: merge the branch into main, at the project root
	if (git(root, ["merge", "--no-edit", ensured.wt]) === null) {
		// rare (main moved between the two steps, or a dirty root checkout): abort and requeue
		// for the retry after the idle cooldown
		git(root, ["merge", "--abort"], true);
		writeFileSync(mergerAttemptPath(root, slug), "");
		log(root, `${task.file}: merge into main failed, left in to-merge for the retry`);
		return;
	}
	// step 3: sync the branch to the merged commit so the live test runs the merged code; a
	// no-op when the root merge was a fast-forward. The worktree stays: only doneCleanup deletes it
	if (git(ensured.wtDir, ["merge", "--ff-only", "main"], true) === null) {
		log(root, `${task.file}: branch sync to main failed; the live test runs the branch tip`);
	}
	setState(root, task, "to-live-test");
	log(root, `${task.file}: merged into main, set to-live-test`);
}

// a done task's worktree and branch: the orchestrator merged the branch into main before
// setting to-live-test and the live test passed, so cleanup is all that is left here. -d
// refuses an unmerged branch, so a manual done with unfinished work keeps both branch and
// worktree for a manual merge.
function doneCleanup(root: string, task: Task): void {
	const wt = task.worktree;
	if (!wt) return;
	const wtDir = join(root, ".worktrees", wt);
	const hasBranch = git(root, ["branch", "--list", wt], true) !== "";
	if (!hasBranch && !existsSync(wtDir)) {
		// stale attribute: nothing left to clean
		setWorktree(root, task, "");
		return;
	}
	if (!hasBranch) {
		// worktree dir without a branch: nothing mergeable, drop the dir and the attribute
		git(root, ["worktree", "remove", wtDir, "--force"], true);
		setWorktree(root, task, "");
		return;
	}
	if (git(root, ["merge-base", "--is-ancestor", wt, "HEAD"], true) === null) return;
	// --force only drops uncommitted worktree debris; the merged branch content is already in main
	if (existsSync(wtDir)) git(root, ["worktree", "remove", wtDir, "--force"], true);
	git(root, ["branch", "-d", wt], true);
	setWorktree(root, task, "");
	log(root, `merged ${wt} for ${task.file}`);
}

// past RESPAWN_CAP the fresh agent waits for the idle cooldown: the unconditional bounce
// still moves the task back one step, only the respawn backs off. The task file's update
// time is the idle clock (the bounce's setState wrote it). Read before any write:
// ensureWorktree/setWorktree bump the mtime and would restart the clock mid-check
function deadCooldownActive(root: string, cfg: Config, task: Task): boolean {
	if (readCounter(root, `${taskSlug(task.file)}.dead`) <= RESPAWN_CAP) return false;
	return Date.now() - statSync(join(kanbanDir(root), task.file)).mtimeMs < cfg.autoScheduleMinutes * 60_000;
}

// stale per-task merger pid leftovers (the old per-task merger scheme, e.g. 000038.merger.pid):
// current code reads only the global merger pid, so a leftover is dead weight. Drop each one
// whose process is dead; a live pid keeps its file, and a task still in merging is skipped.
// Exit-code files the poll never consumed (the task vanished mid-run) drop with their name:
// the next spawn clears its own exit file, so only orphaned names are swept here
function janitorPids(root: string, tasks: Task[]): void {
	const merging = new Set(tasks.filter((t) => t.state === "merging").map((t) => taskSlug(t.file)));
	const slugs = new Set(tasks.map((t) => taskSlug(t.file)));
	let files: string[] = [];
	try {
		files = readdirSync(join(kanbanDir(root), ".pids"));
	} catch {
		return; // no .pids dir yet
	}
	for (const f of files) {
		if (f.endsWith(".exit")) {
			const name = f.slice(0, -".exit".length);
			// "merger.exit" clears itself at the next merger spawn; a task slug with no board
			// task is an orphan
			if (name === "merger" || slugs.has(name)) continue;
			try {
				rmSync(join(kanbanDir(root), ".pids", f));
			} catch {
				/* already gone */
			}
			continue;
		}
		if (!f.endsWith(".merger.pid")) continue;
		const name = f.slice(0, -".pid".length); // "<slug>.merger"
		if (merging.has(name.slice(0, -".merger".length))) continue;
		const { pid, disc } = pidEntry(root, name);
		if (pidAlive(pid, disc)) continue; // never remove a running process's pid file
		try {
			rmSync(join(kanbanDir(root), ".pids", f));
		} catch {
			/* already gone */
		}
	}
}


export function rescan(root: string, cfg: Config): void {
	// root-cause fix ordering: a snapshot commit must never be built from a tree that lacks
	// branch-only files, so an external mirror-head move is materialized before boardStatus
	// reads and before any commitKanban
	reconcileBoard(root);
	// one board snapshot per sweep: a file created after this read must not fold into an
	// in-flight commit's label (whole-board tree) or its own create event never surfaces
	const files = taskFiles(root);
	const status = boardStatus(root, files);
	const tasks = listAll(root);
	// sole commit points: board files not on the mirror yet are new, finished tasks fold in
	// their whole life; everything else stays unmirrored until done. Creates run first:
	// commitKanban rebuilds the tree from the whole board, so a done commit later in the
	// sweep would fold pending creates under its label and the create events would never
	// surface on the mirror
	for (const task of tasks) {
		try {
			if (task.conflicted) continue;
			if (status.get(join(".kanban", task.file)) === "??") commitKanban(root, `kanban: create ${task.file}`, files);
		} catch (err) {
			log(root, `error handling ${task.file} (create): ${err instanceof Error ? err.message : err}`);
		}
	}
	for (const task of tasks) {
		try {
			// a conflicted file parses bogus values (duplicate keys resolve last-wins, the merged-in
			// side wins); rewriting or acting on it would resolve the merge with stale state, so
			// leave it untouched until the merger or the user resolves it
			if (task.conflicted) {
				log(root, `${task.file}: unresolved merge conflict markers, skipping (merger or user resolves)`);
				continue;
			}
			// "??" here means the pass-one create commit failed (git error): retry it; the
			// identical-tree guard keeps an already-mirrored file a no-op
			const code = status.get(join(".kanban", task.file));
			if (code === "??") commitKanban(root, `kanban: create ${task.file}`, files);
			// past the respawn cap the fresh developer waits for the idle cooldown (state unchanged)
			if (task.state === "to-do" && !deadCooldownActive(root, cfg, task)) startTodo(root, cfg, task);
			else if (task.state === "to-review" && !deadCooldownActive(root, cfg, task)) {
				const ensured = ensureWorktree(root, task);
				// a failed spawn would bounce or strand the task; leave the state for the next rescan to retry
				if (!ensured) log(root, `${task.file}: worktree could not be created, reviewer not spawned (state unchanged)`);
				else {
					const slug = taskSlug(task.file);
					consumeReviewerRun(root, slug);
					const cap = cfg.reviewerCap[task.complexity] ?? REVIEWER_RUN_CAP;
					if (readCounter(root, `${slug}.reviewer-runs`) >= cap) {
						// re-read before the forced advance: a state changed underneath (PM or user) wins
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
						setState(root, task, "reviewing");
						spawnAgent(root, cfg, "reviewer", task, ensured.wtDir);
						const pid = agentPid(root, slug);
						if (pid) writeFileSync(armedPath(root, slug), String(pid));
					}
				}
			} else if (task.state === "to-live-test" && !deadCooldownActive(root, cfg, task)) {
				const slug = taskSlug(task.file);
				consumeReviewerRun(root, slug);
				// the live test runs on the merged commit, which the orchestrator synced into the
				// branch: an unmerged branch (in-flight task from a daemon still on the old order, or
				// a manual placement) or a task with no worktree at all goes back to to-merge first,
				// so main never gets tested without this task's merged change
				if (!task.worktree || git(root, ["merge-base", "--is-ancestor", task.worktree, "HEAD"], true) === null) {
					setState(root, task, "to-merge");
					log(root, task.worktree ? `${task.file}: branch not merged yet, moving to to-merge for the orchestrator merge` : `${task.file}: no worktree, moving to to-merge for the orchestrator merge`);
				} else if (!agentAlive(root, "merger") && !pidAlive(agentPid(root, slug))) {
					// a live merger would change main under the test (and may still be writing its
					// report), and a stale agent for this task may still write the task file: defer
					// the spawn to a later sweep
					const ensured = ensureWorktree(root, task);
					if (!ensured) log(root, `${task.file}: worktree could not be created, live-tester not spawned (state unchanged)`);
					else {
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
	janitorPids(root, tasks);
	// the sweep promotes: re-read the board first, because the state loop itself lands done
	// moves (a to-merge with nothing to merge, a hand-set done fold-in); blocker decisions from
	// the pre-loop snapshot would defer the drop and the promotion one sweep, and the promotion
	// would ride no report (a sweep without a done transition queues none). dropDoneBlockers
	// drops satisfied refs first (board hygiene), then promoteBacklog promotes every schedulable
	// backlog task; a blocker in done or the live test does not hold promotion, and
	// promoteBacklog re-checks its gates on a fresh board read before setState
	const current = listAll(root);
	dropDoneBlockers(root, current);
	const promoted = promoteBacklog(root, current);
	// the PM report: the sweep schedules first, then one report covers the tasks that moved to
	// done in this sweep (detected against the pre-loop snapshot, so a done move this sweep made
	// is this sweep's transition) plus what it scheduled
	reportDone(root, tasks, promoted);
	// every sweep: finished agents' logs compact into .log.gz (idempotent; live pids are skipped)
	compactFinishedLogs(root);
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

function blockedByUndone(tasks: Task[], task: Task): boolean {
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

// promotion is event-driven, the replacement for the old idle failsafe: every sweep and every
// poll promotes EVERY schedulable backlog task, not one per idle window. Unchained tasks
// promote and run as parallel lanes the moment a lane frees; the blockedBy chain (the PM
// encodes it at creation) serializes what must serialize. Returns the promoted tasks (state
// to-do), the report's Scheduled section; exported for the tests
export function promoteBacklog(root: string, tasks: Task[]): Task[] {
	const promoted: Task[] = [];
	for (const task of tasks) {
		// conflicted files parse bogus state values: never promotable
		if (task.conflicted || task.state !== "backlog") continue;
		// unanswered open questions mean the task waits for the user: never promote it
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
