---
name: "fix: rescan spawns reviewer and live tester without creating the task worktree"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
The rescan spawns reviewers and live testers with cwd set to a worktree path it never checks or creates. When the worktree dir is missing (task moved straight to to-review, worktree removed while the task re-enters the flow, or worktree force-removed during crash recovery), the spawn fails with ENOENT, the agent never runs, and to-live-test tasks silently reach done untested.

# Specs
# Need

The rescan in src/orchestrator.ts spawns the reviewer and live tester with cwd = join(root, ".worktrees", task.worktree || slugWorktree(task.name)) but never checks that the dir exists. Only the to-do path (startTodo) creates the worktree. When it is missing:

- spawn fails with ENOENT (logged by the child error handler), the agent never starts, and writePid records pid 0.
- The task still advances: to-review -> reviewing, or to-live-test -> live-testing.
- The poll then sees a dead agent: a reviewing task bounces reviewing -> to-review until the 5-attempt respawn cap gives up, stranded and never reviewed; a live-testing task goes straight to done, so work is merged and committed without ever being live-tested.

Seen in practice: after crash recovery force-removed the worktrees, a task sat in reviewing with worktree set and its dir gone; the next rescan hit exactly this path.

# Facts

- startTodo (src/orchestrator.ts) already has the correct pattern: if (!existsSync(wtDir)) git worktree add (with the -b fallback when the branch is taken), then syncBoard(wtDir), setWorktree(task, wt), spawn, setState(doing).
- The to-review and to-live-test branches in rescan compute wtDir and spawn with no existence check, no syncBoard, no setWorktree.
- agents/reviewer.md and agents/live-tester.md tell the agent to work in {{WORKTREE}}; a nonexistent dir breaks them.
- The library (src/kanban.ts) writes files only; the daemon is the sole .kanban committer.

# Required behavior

1. Extract the worktree-ensure logic from startTodo into a small helper (three call sites: startTodo, the to-review branch, the to-live-test branch): when the worktree dir is missing, git worktree add with the -b fallback, syncBoard, setWorktree. Return the wtDir, or null when creation fails.
2. In the rescan to-review and to-live-test branches: call the helper first. On null: log a clear line and skip the spawn, leaving the state unchanged so the next rescan retries. Never advance to reviewing or live-testing with an agent that failed to start.
3. Nothing else changes.

# Constraints

- Minimal diff; reuse the existing pattern, no new config or pid files.
- Keep the kanban_* tool contracts unchanged.

# Acceptance criteria

- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass, plus a small node-runnable test addition: a task placed directly in to-review with no worktree dir gets its worktree created (dir exists, .kanban symlink present), the reviewer spawn log shows an existing cwd, and a to-live-test task whose worktree cannot be created stays in to-live-test instead of reaching done.

# Notes

- [2026-10-10 20:46] Extracted the worktree-ensure logic from startTodo into ensureWorktree (git worktree add with the -b fallback, syncBoard, setWorktree). It returns the worktree dir, or null when creation fails. startTodo now returns early on null, so a failed creation no longer spawns into a missing dir.
- [2026-10-10 20:46] The rescan to-review and to-live-test branches call ensureWorktree first. On null they log a clear line and skip the spawn, and the state stays unchanged, so the next rescan retries. The unused wtDir line in rescan was removed. Nothing else changed.
- [2026-10-10 20:46] Added test part E to src/orchestrator.test.ts: a task placed directly in to-review with no worktree dir gets its worktree created (dir exists, .kanban symlink present, spawn log shows the worktree cwd, worktree recorded on the task); a to-live-test task whose worktree cannot be created (.worktrees blocked by a regular file) stays in to-live-test, with no live-tester spawn. node src/kanban.test.ts and node src/orchestrator.test.ts pass. Committed as 5df0483.
- [2026-10-10 20:53] Live test passed. Ran both daemons from this worktree checkout against two scratch git repos with stub agents. (1) A to-review task with no worktree dir: worktree auto-created, .kanban symlink in place, reviewer and live-tester spawned with cwdExists=true and real pids, full cycle to done with the branch merged and the worktree cleaned. (2) A to-live-test task with .worktrees blocked by a regular file: git error logged, "worktree could not be created, live-tester not spawned (state unchanged)", no spawn, state stayed to-live-test, and the rescan retried every cycle. (3) Removing the block recovered on the next rescan: worktree created, live-tester spawned, cycle completed. (4) The exact crash-recovery scenario from the Summary (reviewing task, worktree dir force-removed, dead agent pid=0): the poll bounced reviewing -> to-review and the rescan re-created the worktree before respawning, real pids and existing cwd, no ENOENT; the 5-attempt cap still gives up cleanly. (5) The -b fallback with a pre-existing branch created the worktree and completed the cycle. node src/kanban.test.ts and node src/orchestrator.test.ts re-run from this worktree, both pass. Create and done commits landed per test task. No issues found. Minor observation, no task: a blocked worktree logs one git error plus the skip line per rescan (intended retry design per the Specs), slightly noisy under a persistent abnormal condition.
- [2026-10-10 20:48] Review passed. Verified against the Specs: ensureWorktree extracted with the -b fallback, syncBoard and setWorktree, returns {wt, wtDir} or null; all three call sites (startTodo, to-review branch, to-live-test branch) use it; the rescan branches log a clear line and skip the spawn with the state unchanged on null; no other callers of the old inline logic were missed; src/kanban.ts and the kanban_* contracts untouched. Re-ran node src/kanban.test.ts and node src/orchestrator.test.ts, both pass. A startTodo creation failure now returns early instead of spawning into a missing dir, a strict improvement consistent with the refactor. No fixes needed.
