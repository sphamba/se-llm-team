import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isSelfWrite, kanbanDir, createTask, getTask, hasUserHold, listAll, PRIORITY_RANK, setState, setWorktree, taskFiles, taskNum, taskSlug, updateAttrs, updateTask, ROLE_NOTES_RE, type Task } from "../kanban.ts";
import { agentAlive, agentPid, clearPid, pidAlive, pidEntry } from "../pid.ts";
import { RESPAWN_CAP, REVIEWER_RUN_CAP, type Config } from "./config.ts";
import { armedPath, bumpCounter, compactFinishedLogs, counterPath, log, newestRunRole, readCounter } from "./log.ts";
import { clearContextSymlinks, clearMergerSlug, readExitCode, spawnAgent, spawnRunAnalysis, writeMergerSlug } from "./spawn.ts";
import { boardStatus, commitKanban, ensureWorktree, git, reconcileBoard } from "./board.ts";
import { reportDone } from "./report.ts";

// consumes the armed marker at the state the armed reviewer wrote itself (back to to-review,
// or forward to to-merge on approval): a pid match counts one landed reviewer run, and a
// mismatch (died run: the poll clears the pidfile first, or a later developer spawn overwrote
// it) only drops the marker. The pid match is the count rule: the poll's own armed handling
// consumes the marker of a run that never moved, so a no-move run never reaches this count
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
// moderate and complex to-do tasks meet the Splitter first: the task stays in to-do while the
// Splitter decomposes it (or declines), and the dead splitter pid file routes the fallback to
// the Developer below with no second splitter pass
const SPLITTER_COMPLEXITIES = new Set(["moderate", "complex"]);

// the states the maxParallel cap counts: state-based, so a task whose agent died still holds
// its slot until the poll requeues it; liveness.ts owns the same set but imports this module,
// so the literals are repeated here
const WORKING_CAP_STATES = new Set(["doing", "reviewing", "merging", "live-testing", "integration-testing"]);

function runningCount(root: string): number {
	return listAll(root).filter((task) => WORKING_CAP_STATES.has(task.state)).length;
}

// the later pipeline stage first, so a task closer to done never waits behind one that has not
// started. Every other state shares one fallback rank: none of them spawns from the board order
// loop, so their relative order does not matter, and a missing rank never yields NaN
const STAGE_RANK: Record<string, number> = { "to-integration-test": 0, "to-live-test": 1, "to-merge": 2, "to-review": 3, "to-do": 4 };

// one global board order: priority, then stage, then creation order (the name sort from
// taskFiles, kept by the stable sort because a full tie returns 0)
export const boardOrder = (a: Task, b: Task) =>
	(PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4) || (STAGE_RANK[a.state] ?? 5) - (STAGE_RANK[b.state] ?? 5);

// the integration-test task's Specs hold only the covered refs and their summaries. The procedure
// lives in agents/integration-tester.md, so it is not copied into every generated task.

// one covered entry: its ref and name as a level-3 heading, its summary as a blockquote (a blank
// summary line becomes a lone ">", so the quote never breaks)
function integrationEntry(task: Task): string {
	const quote = task.summary
		.split("\n")
		.map((line) => (line.trim() ? `> ${line}` : ">"))
		.join("\n");
	return `### #${taskNum(task.file)} ${task.name}\n\n${quote}`;
}

function integrationSpecs(covered: Task[]): string {
	const entries = covered.map(integrationEntry).join("\n\n");
	return ["## Covered tasks", "", entries].join("\n");
}

// a ref whose task left the board has no name or summary to quote: drop it rather than emit an
// empty entry, so the head sentence and the headings still name the same set
function coveredOnBoard(root: string, refs: number[], board: Task[]): Task[] {
	const covered: Task[] = [];
	for (const ref of refs) {
		const task = board.find((candidate) => taskNum(candidate.file) === ref);
		if (task) covered.push(task);
		else log(root, `integration specs: dropped #${ref}, no such task on the board`);
	}
	return covered;
}

// the refs an integration task covers, from its name ("test: integration of #42, #43")
function integrationRefs(task: Task): number[] {
	return [...task.name.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1], 10));
}

const integrationName = (refs: number[]) => `test: integration of ${refs.map((ref) => `#${ref}`).join(", ")}`;
const integrationSummary = (refs: number[]) => `Integration test of the merged base branch after ${refs.map((ref) => `#${ref}`).join(", ")}.`;

// the integration task's priority follows the covered refs' complexity, highest wins: a complex
// covered ref makes the run critical, a trivial one low
const PRIORITY_BY_COMPLEXITY: Record<string, string> = { trivial: "low", simple: "medium", moderate: "high", complex: "critical" };
function integrationPriority(covered: Task[]): string {
	return covered
		.map((task) => PRIORITY_BY_COMPLEXITY[task.complexity] ?? "medium")
		.reduce((highest, priority) => ((PRIORITY_RANK[priority] ?? 4) < (PRIORITY_RANK[highest] ?? 4) ? priority : highest), "low");
}

// a waiting task's queue position only improves: a ref that leaves the board, or a
// lower-complexity append, must not lower a priority an earlier append already raised
function higherPriority(stored: string, next: string): string {
	return (PRIORITY_RANK[stored] ?? 4) <= (PRIORITY_RANK[next] ?? 4) ? stored : next;
}

function createIntegrationTask(root: string, covered: Task): Task {
	const num = taskNum(covered.file);
	const task = createTask(root, {
		name: integrationName([num]),
		shortName: `integration-of-${num}`,
		priority: integrationPriority([covered]),
		complexity: "simple",
		summary: integrationSummary([num]),
		specs: integrationSpecs([covered]),
		notes: `Generated by the orchestrator when #${num} was merged to the base branch.`,
		issuer: "auto",
	});
	setState(root, task, "to-integration-test");
	return task;
}

// the merge hook: open or extend the ONE integration-test task that waits in to-integration-test,
// called right after the base fast-forward so the run overlaps the covered task's live test. Reads
// the board at hook time (never an earlier snapshot); a ref a waiting or running integration task
// already names is skipped, because a ref can merge again while its entry still waits or runs
export function ensureIntegrationTask(root: string, covered: Task): void {
	const num = taskNum(covered.file);
	const board = listAll(root);
	const lane = board.filter((task) => task.state === "to-integration-test" || task.state === "integration-testing");
	if (lane.some((task) => integrationRefs(task).includes(num))) {
		log(root, `integration test of #${num} already queued or running, nothing to append`);
		return;
	}
	const waiting = lane.filter((task) => task.state === "to-integration-test").sort((a, b) => taskNum(a.file) - taskNum(b.file));
	if (waiting.length > 1) log(root, `${waiting.length} tasks wait in to-integration-test (${waiting.map((task) => `#${taskNum(task.file)}`).join(", ")}), appending to #${taskNum(waiting[0].file)}`);
	const target = waiting[0];
	// a target that left to-integration-test between the read and the write (a rescan spawned it)
	// must never gain a ref mid-run: create a fresh waiting task instead
	const fresh = target ? getTask(root, target.file) : undefined;
	if (!fresh || fresh.state !== "to-integration-test") {
		log(root, `${createIntegrationTask(root, covered).file}: created for ${covered.file} (to-integration-test)`);
		return;
	}
	const refs = [...new Set([...integrationRefs(fresh), num])].sort((a, b) => a - b);
	// the whole body is rebuilt from the board: the old body is never parsed for names or summaries
	const kept = coveredOnBoard(root, refs, board);
	const survivors = kept.map((task) => taskNum(task.file));
	updateTask(root, fresh, {
		name: integrationName(survivors),
		priority: higherPriority(fresh.priority, integrationPriority(kept)),
		summary: integrationSummary(survivors),
		specs: integrationSpecs(kept),
	});
	log(root, `${fresh.file}: appended #${num}, now ${survivors.map((ref) => `#${ref}`).join(", ")}`);
}

function startTodo(root: string, cfg: Config, task: Task): void {
	const slug = taskSlug(task.file);
	// a manual to-do rewrite can land while the spawned agent still runs: the live pid is the
	// guard, the state alone is not, or a second sweep spawns a twin that overwrites the pid file
	if (pidAlive(agentPid(root, slug))) return;
	// the Splitter rewrites and moves the parent mid-sweep, so the loop's snapshot can be stale:
	// act on the file on disk, not on the snapshot, or a stale to-do call undoes the split
	const fresh = getTask(root, task.file);
	if (!fresh || fresh.state !== "to-do") return;
	// a held task starts no stage: it keeps to-do, and removing the token restarts the path with
	// the Splitter first because no splitter marker was written
	if (hasUserHold(fresh.blockedBy)) return;
	if (SPLITTER_COMPLEXITIES.has(fresh.complexity ?? "")) {
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
	const ensured = ensureWorktree(root, fresh);
	if (!ensured) return;
	// at the maxParallel cap the start waits: the task stays to-do for the next rescan
	if (cfg.maxParallel > 0 && runningCount(root) >= cfg.maxParallel) return;
	// state before spawn: the next sweep reads doing and defers, with the pid check as the belt
	setState(root, fresh, "doing");
	spawnAgent(root, cfg, "developer", { ...fresh, worktree: ensured.wt }, ensured.wtDir);
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
// merge-lane hygiene before every rebase attempt (each retry after a Merger conflict round
// included): the two context paths must never block the rebase with unstaged noise. A context
// symlink committed by a developer sits as an unstaged deletion once clearContextSymlinks
// removed it (#234), and a rebase refuses on unstaged changes. Unset any skip-worktree bit
// first (a restore refuses a skip-worktree path), then restore each path to HEAD. Untracked
// paths fail both steps and are ignored
function cleanContextPaths(wtDir: string): void {
	for (const name of ["AGENTS.md", "SPECS.md"]) {
		git(wtDir, ["update-index", "--no-skip-worktree", name], true);
		git(wtDir, ["restore", "--staged", "--worktree", "--", name], true);
	}
}

// after the fast-forward: a context path tracked as a symlink (git mode 120000) came from a
// worktree commit and never belongs on the merged branch. Remove the symlink-mode entries only
// (a project's own tracked real file is mode 100644 and untouched) with one follow-up commit
function stripContextSymlinks(root: string): void {
	const removed: string[] = [];
	for (const name of ["AGENTS.md", "SPECS.md"]) {
		if (git(root, ["ls-tree", "HEAD", "--", name], true)?.startsWith("120000 ")) removed.push(name);
	}
	if (!removed.length) return;
	for (const name of removed) git(root, ["rm", "--quiet", name], true);
	// housekeeping commit: never require signing (the merge lane must not wedge on a signing setup)
	if (git(root, ["-c", "commit.gpgsign=false", "commit", "-m", "chore: remove task context symlinks committed by mistake"]) === null) {
		log(root, `strip commit for ${removed.join(", ")} failed, left staged at the project root`);
	} else {
		log(root, `removed committed context symlink(s) ${removed.join(", ")} from the merged branch`);
	}
}

// the to-merge sweep: a task the reviewer passed sits in to-merge until the orchestrator
// rebases the branch onto the base in the worktree, then fast-forwards the base to the
// branch at the project root and sets to-live-test; main history stays linear with no merge
// commits. No merger agent runs on this clean path. On a rebase conflict the rebase stays in
// progress in the worktree and a Merger (cwd = the worktree, pidName merger) resolves only
// the conflicts and concludes the replayed commit with git rebase --continue; its successful
// exit requeues the task to to-merge through the poll, and the retry waits for the idle
// cooldown. A rebase can stop once per replayed commit, so the Merger is spawned per conflict
// round until the rebase completes
function sweepToMerge(root: string, cfg: Config, task: Task): void {
	const slug = taskSlug(task.file);
	// a reviewer approval is a successful run too: consume the armed marker here, since the
	// approval now lands the task straight in to-merge
	consumeReviewerRun(root, slug);
	// the reviewer may still be committing and writing its report after setting to-merge
	if (agentAlive(root, slug)) return;
	// a self-advanced run's success is recognized here too: the poll's 60 s cadence usually
	// misses the ~10 s window before the next spawn of the slug overwrites its stale pid/exit
	// pair, so the sweep's to-merge pass fires the analysis first. Best-effort: the spawn
	// skips already-analysed and in-flight runs itself, and a crashed last run (non-zero
	// exit) never fires. newestRunRole names the exited run (never a merger log)
	const exitCode = readExitCode(root, slug);
	if (exitCode === 0) {
		const role = newestRunRole(root, slug);
		if (role) spawnRunAnalysis(root, slug, role);
	}
	// at most one merger at a time, project-wide
	if (agentAlive(root, "merger")) return;
	// at the maxParallel cap the merge waits: the task stays to-merge for the next rescan, and
	// this return writes nothing, so the idle-clock checks below keep their reads first
	if (cfg.maxParallel > 0 && runningCount(root) >= cfg.maxParallel) return;
	// a task bounced here past the respawn cap (dead merger) also waits for the idle
	// cooldown before its merge runs
	if (deadCooldownActive(root, cfg, task)) return;
	// an earlier attempt on this task failed and requeued it: retry only after it sat idle in
	// to-merge for the idle interval. Read before any write: ensureWorktree/setWorktree bump the
	// task file's mtime, which is the idle clock, so this check must come first
	if (existsSync(mergerAttemptPath(root, slug)) && Date.now() - statSync(join(kanbanDir(root), task.file)).mtimeMs < cfg.retryIdleMinutes * 60_000) return;
	// a held task returns before the worktree, the rebase and the merger slug, so it never leaves
	// a stopped rebase or a fast-forwarded base behind
	if (hasUserHold(task.blockedBy)) return;
	const wt = task.worktree;
	if (!wt || (git(root, ["branch", "--list", wt], true) === "" && !existsSync(join(root, ".worktrees", wt)))) {
		// nothing to merge: no worktree and no branch
		setWorktree(root, task, "");
		setState(root, task, "done");
		log(root, `${task.file}: nothing to merge, set done`);
		return;
	}
	// the base branch: the root checkout's current branch, resolved live per merge operation
	// (#102: never a hardcoded main). A detached root has no branch to rebase onto or into:
	// git merge there would land the change on a dangling commit that the done cleanup then
	// deletes. Leave the task in to-merge for the PM, retries wait out the idle cooldown
	const base = git(root, ["branch", "--show-current"], true);
	if (base === "") {
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
	// step 1: rebase the branch onto the base, in the worktree. The rebase and the fast-forward
	// below run back-to-back in this serialized lane, so a branch rebased here is merged before
	// the next merger operation rebases another branch onto a moved base. A rebase already in
	// progress (a conflict round from an earlier run) makes a fresh rebase fail without
	// touching state, which lands in the conflict path below and respawns the Merger
	cleanContextPaths(ensured.wtDir);
	if (git(ensured.wtDir, ["rebase", base]) === null) {
		mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
		writeFileSync(mergerAttemptPath(root, slug), "");
		// a stopped rebase leaves the rebase-merge directory in the worktree's git dir: that is
		// a conflict, so leave the rebase in progress (no abort) and let the merger resolve only
		// the conflicts and continue the replay. REBASE_HEAD is not the check: it lingers after a
		// completed rebase (git 2.43). Any other failure (dirty worktree, missing ref) requeues
		// for a later sweep with no merger
		const rebaseDir = git(ensured.wtDir, ["rev-parse", "--git-path", "rebase-merge"], true);
		const stopped = typeof rebaseDir === "string"
			&& existsSync(isAbsolute(rebaseDir) ? rebaseDir : join(ensured.wtDir, rebaseDir));
		if (stopped) {
			log(root, `${task.file}: rebase conflicts, merger spawned to resolve them`);
			writeMergerSlug(root, slug);
			spawnAgent(root, cfg, "merger", { ...task, worktree: ensured.wt }, ensured.wtDir, "merger");
			setState(root, task, "merging");
		} else {
			log(root, `${task.file}: rebase failed, left in to-merge for the retry`);
		}
		return;
	}
	// step 2: fast-forward the base to the branch, at the project root, so no merge commit is
	// created and main history stays linear. After the rebase the worktree branch head already
	// is the merged commit, so no worktree sync step follows. Nothing is in progress on a
	// failure (the rebase completed before this ran): no abort, just requeue for the retry,
	// which re-runs a fresh rebase onto the moved base followed by the fast-forward
	if (git(root, ["merge", "--ff-only", ensured.wt]) === null) {
		writeFileSync(mergerAttemptPath(root, slug), "");
		log(root, `${task.file}: fast-forward to ${base} failed, left in to-merge for the retry`);
		return;
	}
	stripContextSymlinks(root);
	setState(root, task, "to-live-test");
	log(root, `${task.file}: fast-forwarded ${base} to ${ensured.wt}, set to-live-test`);
	// the base is already fast-forwarded, so the integration run starts here and overlaps the
	// covered task's live test. Never fatal: a hook failure must not fail the merge, undo the state
	// move, or send the task back to to-merge
	if (!cfg.integrationTesting) {
		log(root, `${task.file}: integration testing is off, no integration task queued`);
		return;
	}
	const fresh = getTask(root, task.file) ?? task;
	try {
		ensureIntegrationTask(root, fresh);
	} catch (err) {
		log(root, `integration task for ${slug} failed: ${err instanceof Error ? err.message : err}`);
	}
}

// the integration-test sweep: one project-wide run at a time, on the merged base branch, in the
// root checkout (the tree the merger merges into) and with no worktree. The global
// integration-tester pid is the single slot; the poll requeues a lane task whose run was
// superseded. The loop snapshot is already in board order (priority, then stage), so the highest
// priority waiting task takes the free slot
function sweepToIntegrationTest(root: string, cfg: Config, task: Task): void {
	// a held task keeps to-integration-test and leaves the single slot to the next waiting task
	if (hasUserHold(task.blockedBy)) return;
	// a task already running when the flag turns off finishes its run, so the gate acts at
	// stage start only: the waiting task holds here, silently, on every rescan
	if (!cfg.integrationTesting) return;
	// at most one integration-tester at a time, project-wide
	if (agentAlive(root, "integration-tester")) return;
	// at the maxParallel cap the start waits: the task stays to-integration-test
	if (cfg.maxParallel > 0 && runningCount(root) >= cfg.maxParallel) return;
	// a task bounced here past the respawn cap waits for the idle cooldown first
	if (deadCooldownActive(root, cfg, task)) return;
	// state before spawn, like the live-tester spawn: the poll owns the lane from here
	setState(root, task, "integration-testing");
	writeMergerSlug(root, taskSlug(task.file), "integration-tester");
	spawnAgent(root, cfg, "integration-tester", task, root, "integration-tester");
}

// a done task's worktree and branch: the orchestrator fast-forwarded the base to the
// branch before setting to-live-test and the live test passed, so cleanup is all that is
// left here. -d
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
	return Date.now() - statSync(join(kanbanDir(root), task.file)).mtimeMs < cfg.retryIdleMinutes * 60_000;
}

// .pids janitor, one sweep per rescan. Exit-code files the poll never consumed (the task
// vanished mid-run) drop with their name: the next spawn clears its own exit file, so only
// orphaned names are swept here. Stale per-task merger pid leftovers (the old per-task merger
// scheme, e.g. 000038.merger.pid) drop once dead while their task is not merging. The generic
// pid files drop once their reader is done with them (see the branch below). The project-wide
// lane pids (merger, integration-tester) are live state for the poll: never swept
function janitorPids(root: string, tasks: Task[]): void {
	const merging = new Set(tasks.filter((t) => t.state === "merging").map((t) => taskSlug(t.file)));
	const slugs = new Set(tasks.map((t) => taskSlug(t.file)));
	const todo = new Set(tasks.filter((t) => t.state === "to-do").map((t) => taskSlug(t.file)));
	let files: string[] = [];
	try {
		files = readdirSync(join(kanbanDir(root), ".pids"));
	} catch {
		return; // no .pids dir yet
	}
	for (const f of files) {
		if (f.endsWith(".exit")) {
			const name = f.slice(0, -".exit".length);
			// "merger.exit" and "integration-tester.exit" are lane state the poll consumes; a task
			// slug with no board task is an orphan. Per-run analysis exit files
			// (<slug>.<role>.<n>.analysis) key the one-failed-attempt guard (#229): keep them while
			// their task exists, sweep with the task
			if (name === "merger" || name === "integration-tester" || slugs.has(name) || slugs.has(name.split(".")[0])) continue;
			try {
				rmSync(join(kanbanDir(root), ".pids", f));
			} catch {
				/* already gone */
			}
			continue;
		}
		// the project-wide lane pids are live state for the poll's merging and integration lanes:
		// never swept
		if (f === "merger.pid" || f === "integration-tester.pid") continue;
		if (f.endsWith(".merger.pid")) {
			const name = f.slice(0, -".pid".length); // "<slug>.merger"
			if (merging.has(name.slice(0, -".merger".length))) continue;
			const { pid, disc } = pidEntry(root, name);
			if (pidAlive(pid, disc)) continue; // never remove a running process's pid file
		} else if (f.endsWith(".pid")) {
			// generic pid files: per-task agents (<slug>.pid), splitters (<slug>.splitter.pid)
			// and per-run analyses (<slug>.<role>.<n>.analysis.pid). Every live process keeps its
			// file. A dead one goes once its reader is done with it: the poll consumes a board
			// task's per-task pid in every state (exit code, armed reviewer marker, dead-streak
			// clear) and clears the file itself; startTodo reads a to-do task's splitter pid as
			// the splitter-ran marker that routes the fallback to the Developer; spawnRunAnalysis
			// reads an analysis pid only while it is alive (the wrapper self-removes its file at
			// exit, a killed analysis leaves it behind)
			const name = f.slice(0, -".pid".length);
			const { pid, disc } = pidEntry(root, name);
			if (pidAlive(pid, disc)) continue; // never remove a running process's pid file
			if (!name.endsWith(".analysis")) {
				const slug = name.endsWith(".splitter") ? name.slice(0, -".splitter".length) : name;
				if (name.endsWith(".splitter") ? todo.has(slug) : slugs.has(slug)) continue;
			}
		} else {
			continue; // not a pid file
		}
		try {
			rmSync(join(kanbanDir(root), ".pids", f));
		} catch {
			/* already gone */
		}
	}
}


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
				// a to-do arrival breaks the review streak: a stale count would force-merge the next
				// to-review arrival without a review
				const slug = taskSlug(task.file);
				if (readCounter(root, `${slug}.reviewer-runs`) > 0) {
					writeFileSync(counterPath(root, `${slug}.reviewer-runs`), "0");
					log(root, `${task.file}: back in to-do, review counter reset`);
				}
				// past the respawn cap the fresh developer waits for the idle cooldown (state unchanged)
				if (!deadCooldownActive(root, cfg, task)) startTodo(root, cfg, task);
			} else if (task.state === "to-review" && !deadCooldownActive(root, cfg, task)) {
				// reviews off: the task skips the reviewer lane and goes straight to the merge
				if (!cfg.reviews) {
					if (hasUserHold(task.blockedBy)) continue;
					setState(root, task, "to-merge");
					log(root, `${task.file}: reviews are off, moving to to-merge`);
					continue;
				}
				const ensured = ensureWorktree(root, task);
				// a failed spawn would bounce or strand the task; leave the state for the next rescan to retry
				if (!ensured) log(root, `${task.file}: worktree could not be created, reviewer not spawned (state unchanged)`);
				else {
					// a held task keeps to-review and arms no reviewer run
					if (hasUserHold(task.blockedBy)) continue;
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
						// at the maxParallel cap the reviewer spawn waits too: the task stays to-review
						if (cfg.maxParallel > 0 && runningCount(root) >= cfg.maxParallel) continue;
						setState(root, task, "reviewing");
						spawnAgent(root, cfg, "reviewer", task, ensured.wtDir);
						const pid = agentPid(root, slug);
						if (pid) writeFileSync(armedPath(root, slug), String(pid));
					}
				}
			} else if (task.state === "to-live-test" && !deadCooldownActive(root, cfg, task)) {
				// a held task keeps to-live-test and starts no run: the check sits before the
				// merged-branch test, so a hold never requeues the task either
				if (hasUserHold(task.blockedBy)) continue;
				const slug = taskSlug(task.file);
				consumeReviewerRun(root, slug);
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
			} else if (task.state === "to-integration-test") {
				sweepToIntegrationTest(root, cfg, task);
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
	// the same bookkeeping for the integration lane: the project-wide pid and slug drop once no
	// task waits in or runs the lane and the integration-tester is gone
	if (!tasks.some((t) => t.state === "to-integration-test" || t.state === "integration-testing") && !agentAlive(root, "integration-tester")) {
		clearPid(root, "integration-tester");
		clearMergerSlug(root, "integration-tester");
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
	const promoted = promoteBacklog(root, current, cfg.backlogIdleMinutes, force);
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
	// the user hold token is a blocker no state satisfies: only the PM removes it
	if (hasUserHold(task.blockedBy)) return true;
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
