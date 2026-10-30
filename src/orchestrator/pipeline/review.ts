import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTask, kanbanDir, setState, taskSlug, type Task } from "../../kanban.ts";
import { REVIEWER_RUN_CAP } from "../config.ts";
import { bumpCounter, log } from "../log.ts";
import { git } from "../board.ts";

// the recorded worktree HEAD of the reviewer pass, written at spawn and read at the pass's
// end: the diff between the two decides the reviewer's outcome, so the reviewer never moves
// the task itself (the Specs-violation to-do excepted). One file per task, in .logs next to
// the counters and the stuck markers; a crashed pass leaves it behind and the next spawn
// overwrites it
export const reviewBasePath = (root: string, slug: string) => join(kanbanDir(root), ".logs", `${slug}.review-base`);

// the base commit of the pass, recorded before the reviewer spawns: a failed rev-parse (a
// worktree gone mid-sweep) records nothing, and the decision then reads as no commits
export function recordReviewBase(root: string, slug: string, wtDir: string): void {
	const head = git(wtDir, ["rev-parse", "HEAD"], true);
	if (!head) {
		log(root, `${slug}: could not record the reviewer base commit, the pass decides as approved`);
		return;
	}
	writeFileSync(reviewBasePath(root, slug), `${head}\n`);
}

function readReviewBase(root: string, slug: string): string | null {
	try {
		return readFileSync(reviewBasePath(root, slug), "utf8").trim() || null;
	} catch {
		return null;
	}
}

function clearReviewBase(root: string, slug: string): void {
	try {
		rmSync(reviewBasePath(root, slug));
	} catch {
		/* already gone */
	}
}

// a task outside the review lane drops its stale base marker (a crash bounce, a PM rewrite)
export function clearStaleReviewBases(root: string, tasks: Task[]): void {
	for (const task of tasks) {
		if (task.state === "to-review" || task.state === "reviewing") continue;
		const path = reviewBasePath(root, taskSlug(task.file));
		if (existsSync(path)) clearReviewBase(root, taskSlug(task.file));
	}
}

// the reviewer outcome, decided by the daemon from the recorded commits: the reviewer fixed
// things and committed (the worktree HEAD moved off the recorded base) and the review cap is
// not reached -> another pass in to-review; otherwise -> to-merge. The pass counts once the
// run ended successfully, whatever the outcome. Re-read + state-match before each move: a task
// that moved on underneath (PM or user) wins
export function decideReview(root: string, reviewerCap: Record<string, number>, task: Task): void {
	const slug = taskSlug(task.file);
	const base = readReviewBase(root, slug);
	clearReviewBase(root, slug);
	const cap = reviewerCap[task.complexity] ?? REVIEWER_RUN_CAP;
	const passes = bumpCounter(root, `${slug}.reviewer-runs`);
	const wtDir = task.worktree ? join(root, ".worktrees", task.worktree) : "";
	const head = wtDir ? git(wtDir, ["rev-parse", "HEAD"], true) : null;
	const fixed = base !== null && head !== null && head !== base;
	if (fixed && passes < cap) {
		const fresh = getTask(root, task.file);
		if (fresh && fresh.state === task.state) {
			setState(root, fresh, "to-review");
			log(root, `${slug}: reviewer made fixes (pass ${passes} of ${cap}), reviewing -> to-review`);
		}
		return;
	}
	const fresh = getTask(root, task.file);
	if (fresh && fresh.state === task.state) {
		setState(root, fresh, "to-merge");
		log(root, fixed
			? `${slug}: review cap ${cap} reached with fixes, reviewing -> to-merge`
			: `${slug}: reviewer approved, reviewing -> to-merge`);
	}
}
