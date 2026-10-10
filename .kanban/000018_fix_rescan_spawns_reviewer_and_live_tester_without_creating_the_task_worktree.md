---
name: "fix: rescan spawns reviewer and live tester without creating the task worktree"
priority: "medium"
state: "backlog"
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
