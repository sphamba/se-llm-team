import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { getTask, hasHold, kanbanDir, listAll, questionOpen, setState, setWorktree, taskSlug, updateAttrs, type Task } from "../../kanban.ts";
import { agentAlive, clearPid } from "../../pid.ts";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import { clearMergerSlug, spawnAgent, writeMergerSlug } from "../spawn.ts";
import { ensureWorktree, git } from "../board.ts";
import { queueAlert } from "../report.ts";
import { deadCooldownActive, runningCount } from "./schedule.ts";

// one failed-merge marker per task: written when the sweep spawns a merger, it survives the
// merger requeueing the task and daemon restarts. A to-merge task whose marker exists re-runs
// only after it sat idle in to-merge for the idle interval, and the per-task file keeps the
// cooldown of a failed task intact while another task's merger spawns
function mergerAttemptPath(root: string, slug: string) {
	return join(kanbanDir(root), ".pids", `${slug}.merge-attempted`);
}

// the marker holds the retry behind retryIdleMinutes; a fresh board has no .pids dir yet
function markMergerAttempt(root: string, slug: string): void {
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	writeFileSync(mergerAttemptPath(root, slug), "");
}

export function clearMergerAttempt(root: string, slug: string): void {
	try {
		rmSync(mergerAttemptPath(root, slug));
	} catch {
		/* already gone */
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

// the to-merge sweep: a task the reviewer passed sits in to-merge until a Merger (cwd = the
// worktree, pidName merger) takes it. The merger owns the whole merge: the stale-rebase abort,
// the rebase onto the base, the conflict resolution, the full suite and the notes. The daemon
// only spawns it here and, on its clean exit, proves the result and fast-forwards the root
// checkout to the branch (finishMerge), so main history stays linear with no merge commits
function sweepToMerge(root: string, cfg: Config, task: Task): void {
	const slug = taskSlug(task.file);
	// the merger of the previous task may still be finishing its report
	if (agentAlive(root, "merger")) return;
	// at most one merger at a time, project-wide: a task still in merging means its merger
	// exited and the poll has not consumed the exit yet, so a second spawn would overwrite the
	// merged run's pid/exit pair and lose the finished merge
	if (listAll(root).some((t) => t.state === "merging")) return;
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
	if (hasHold(task.blockedBy) || questionOpen(task)) return;
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
		// the alert rides the first attempt only: the retry keeps the marker, so the PM is not
		// told the same thing every idle window
		const first = !existsSync(mergerAttemptPath(root, slug));
		markMergerAttempt(root, slug);
		if (first) queueAlert(root, { kind: "detached-root", task });
		log(root, `${task.file}: root checkout is detached, left in to-merge (PM resolves manually)`);
		return;
	}
	const ensured = ensureWorktree(root, task);
	// a failed worktree creation would strand the task; leave the state for the next rescan to retry
	if (!ensured) {
		log(root, `${task.file}: worktree could not be created, merge not started (state unchanged)`);
		return;
	}
	// the merger owns the whole merge: it aborts a stale rebase, rebases onto the base, resolves
	// the conflicts, runs the full suite and writes the notes. The sweep only hands it the
	// worktree and moves the state; the base fast-forward happens on the merger's exit 0
	// (finishMerge), so the to-live-test move waits for the real result
	writeMergerSlug(root, slug);
	spawnAgent(root, cfg, "merger", { ...task, worktree: ensured.wt }, ensured.wtDir, "merger");
	setState(root, task, "merging");
	log(root, `${task.file}: merger spawned in ${ensured.wt}, set merging`);
}

// the merger's success target: the merger rebased the branch and ran the full suite itself, so
// the daemon only proves that result, fast-forwards the root checkout to the branch and hands
// the worktree to the live tester
// an open question outranks the merge result: the answer comes before the root moves
// the question section alone stops the fast-forward, with or without the token, because a
// merger's drop-side question names work the user must settle before the base moves
export function finishMerge(root: string, task: Task): void {
	if (questionOpen(task)) {
		setState(root, task, "to-do");
		log(root, `${task.file}: open question, merging -> to-do`);
		return;
	}
	const wt = task.worktree;
	const wtDir = wt ? join(root, ".worktrees", wt) : "";
	const rebaseDir = wtDir ? git(wtDir, ["rev-parse", "--git-path", "rebase-merge"], true) : null;
	// REBASE_HEAD is not the check: it lingers after a completed rebase (git 2.43)
	const rebasing = typeof rebaseDir === "string" && existsSync(isAbsolute(rebaseDir) ? rebaseDir : join(wtDir, rebaseDir));
	// the base is resolved here, not at spawn time, because an earlier merge moved it
	const base = git(root, ["branch", "--show-current"], true);
	if (!wt || !wtDir || !existsSync(wtDir) || rebasing) {
		parkStuckMerge(root, task, "the merger exited without finishing the rebase", base ?? "");
		return;
	}
	if (!base || git(wtDir, ["merge-base", "--is-ancestor", base, "HEAD"], true) === null) {
		parkStuckMerge(root, task, "the branch does not sit on the base branch", base ?? "");
		return;
	}
	if (!fastForward(root, base, wt)) {
		parkStuckMerge(root, task, `the fast-forward to ${wt} failed`, base);
		return;
	}
	stripContextSymlinks(root);
	setState(root, task, "to-live-test");
	log(root, `${task.file}: fast-forwarded ${base} to ${wt}, set to-live-test`);
}

// the stuck marker: one file per task in the daemon's own log dir. The marker is the lane state,
// so a merger that gave up leaves the task in merging and the whole Merge column waits (the
// to-merge gate blocks while any task is merging) until the PM repairs the root by hand
export const stuckPath = (root: string, slug: string) => join(kanbanDir(root), ".logs", `${slug}.merge-stuck`);

// the marker of a task whose merge gave up: the poll must not bounce it back to to-merge
export function mergeStuck(root: string, slug: string): boolean {
	return existsSync(stuckPath(root, slug));
}

// the merge repair the PM runs by hand: an off-base branch is rebased onto the base in its
// worktree first, because the fast-forward cannot move a base that is not an ancestor; the
// root's own uncommitted work must then survive the fast-forward, and the board and the
// worktrees are daemon state, never stashed with it. The stash takes the same explicit dirty
// paths as the daemon, so the ignored board and worktree dirs never trip the gitignore
// advisory that makes a bare `.` push exit 1 after it already saved the stash
const mergeRepairRecipe = (root: string, branch: string, base: string) => [
	...(branch !== "(none)" && base ? [`git -C ${join(root, ".worktrees", branch)} rebase ${base}`] : []),
	`git -C ${root} status --porcelain -z --no-renames -- . ':(exclude).kanban' ':(exclude).worktrees' | cut -z -c4- | xargs -0 -r git -C ${root} stash push --include-untracked -m "orchestrator: merge repair" --`,
	`git -C ${root} merge --ff-only ${branch}`,
	`git -C ${root} stash pop`,
];

// the merger's three give-ups land here: the marker names the reason, the branch and the base,
// the alert carries the repair recipe, and the state stays merging
function parkStuckMerge(root: string, task: Task, reason: string, base: string): void {
	const branch = task.worktree || "(none)";
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	writeFileSync(stuckPath(root, taskSlug(task.file)), `${reason}\n${branch}\n${base}\n`);
	queueAlert(root, { kind: "merge-stuck", task, reason, branch, recipe: mergeRepairRecipe(root, branch, base) });
	log(root, `${task.file}: ${reason}, left in merging for the merge repair`);
}

// stash, fast-forward, pop: the root checkout's own uncommitted work must survive the merge, so a
// failed fast-forward puts the stash back. A bare `git stash` leaves untracked files that still
// block the merge, hence --include-untracked
// the board and the worktree dirs are the daemon's own state: excluded from the dirt check and
// from the stash, or the stash pulls the whole board and every worktree off disk for the length
// of the merge, and a log write into .kanban during that window breaks the stash pop for good
const MANAGED_PATHS = [".", ":(exclude).kanban", ":(exclude).worktrees"];

// the root's own dirty paths, one per status entry; the explicit list keeps the stash push off
// the ignored-dir walk, whose advisory prints and exits 1 after the stash was already saved.
// execFileSync, not git(): its trim would eat the leading space of the first " M path" entry
function dirtyPaths(root: string): string[] {
	let out: string;
	try {
		out = execFileSync("git", ["status", "--porcelain", "-z", "--no-renames", "--", ...MANAGED_PATHS], { cwd: root, encoding: "utf8" });
	} catch {
		return [];
	}
	return out.split("\0").filter(Boolean).map((entry) => entry.slice(3));
}

function fastForward(root: string, base: string, wt: string): boolean {
	const dirty = dirtyPaths(root);
	if (!dirty.length) return git(root, ["merge", "--ff-only", wt], true) !== null;
	if (git(root, ["stash", "push", "--include-untracked", "-m", `orchestrator: fast-forward to ${wt}`, "--", ...dirty], true) === null) return false;
	if (git(root, ["merge", "--ff-only", wt], true) === null) {
		git(root, ["stash", "pop"], true);
		return false;
	}
	if (git(root, ["stash", "pop"], true) === null) {
		// the merged commit wins the conflict, and the entry stays for the owner to recover by hand
		git(root, ["reset", "--hard", "HEAD"], true);
		log(root, `stash pop after the fast-forward to ${base} conflicted, reset to the merged commit, the entry is stash@{0} in git stash list`);
	}
	return true;
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

// the PM's merge gate: one marker per task the sweep already put to the PM, next to the stuck
// and attempt markers. It outlives a crash and a bounce back to to-merge, so an approved merge
// retries by itself while the file exists and the PM is asked once per task
// a fresh board has no .logs dir yet
export const mergeAskPath = (root: string, slug: string) => join(kanbanDir(root), ".logs", `${slug}.merge-asked`);

// the content is the base branch at the time of the ask, a dash when the root is detached
function markMergeAsk(root: string, slug: string): void {
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	writeFileSync(mergeAskPath(root, slug), `${git(root, ["branch", "--show-current"], true) || "-"}\n`);
}

// the states that still own a merge decision: anywhere else the marker drops, so a task moved
// back to to-do (or a task file that is gone) asks the PM again on its next to-merge arrival
const MERGE_ASK_KEEP = new Set(["to-merge", "merging", "to-live-test", "live-testing"]);

// the autoMerge: false gate, one pass, no memory beyond the marker file: a waiting to-merge task
// gains the `user` hold, then the marker, then one alert for the whole pass. The hold goes first:
// a crash between the two repeats the alert, which is harmless, while the other order leaves an
// unheld task with a marker and the daemon would merge a task the PM never approved
function reconcileMergeAsks(root: string, cfg: Config, tasks: Task[]): void {
	const asked: Task[] = [];
	const keep = new Set<string>();
	for (const task of tasks) {
		const slug = taskSlug(task.file);
		// the marker of a conflicted task stays put: the pass leaves a conflicted file alone
		if (MERGE_ASK_KEEP.has(task.state)) keep.add(slug);
		if (task.conflicted) continue;
		if (cfg.autoMerge || task.state !== "to-merge" || existsSync(mergeAskPath(root, slug))) continue;
		const parts = task.blockedBy.split(",").map((part) => part.trim()).filter(Boolean);
		const held = [...parts, "user"].join(", ");
		if (!parts.some((part) => part.toLowerCase() === "user")) updateAttrs(root, task, { blockedBy: held });
		// the state loop reads this same snapshot object, so the hold must land in memory too or
		// sweepToMerge would merge the task in the pass that holds it
		task.blockedBy = held;
		markMergeAsk(root, slug);
		asked.push(task);
	}
	// a marker with no task behind it, or a task outside the merge lane, is stale state
	let names: string[] = [];
	try {
		names = readdirSync(join(kanbanDir(root), ".logs"));
	} catch {
		/* no .logs dir yet */
	}
	for (const name of names) {
		if (name.endsWith(".merge-asked") && !keep.has(name.slice(0, -".merge-asked".length))) rmSync(join(kanbanDir(root), ".logs", name), { force: true });
	}
	// one alert for the pass, not one per task
	if (asked.length) queueAlert(root, { kind: "merge-waiting", tasks: asked });
}

// the stuck merge release: the PM repaired the root by hand, so once the branch sits on the base
// the task continues by itself; a task that left merging drops its marker
function releaseStuckMerge(root: string, task: Task): void {
	if (task.conflicted) return;
	const path = stuckPath(root, taskSlug(task.file));
	if (!existsSync(path)) return;
	if (task.state !== "merging") {
		rmSync(path, { force: true });
		log(root, `${task.file}: left merging, dropped the stuck marker`);
		return;
	}
	if (agentAlive(root, "merger")) return;
	const wtDir = task.worktree ? join(root, ".worktrees", task.worktree) : "";
	const base = git(root, ["branch", "--show-current"], true);
	if (!wtDir || !existsSync(wtDir) || !base || git(wtDir, ["merge-base", "--is-ancestor", base, "HEAD"], true) === null) return;
	// re-read + state-match: a task that moved on underneath (PM or user) wins
	const fresh = getTask(root, task.file);
	if (!fresh || fresh.state !== "merging") return;
	rmSync(path, { force: true });
	setState(root, fresh, "to-live-test");
	log(root, `${task.file}: merge repair landed, merging -> to-live-test`);
}

export { sweepToMerge, doneCleanup, reconcileMergeAsks, releaseStuckMerge };
