---
name: "fix: kanban_set_worktree always errors - setWorktree is never imported in index.ts"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
The kanban_set_worktree tool always errors at runtime with ReferenceError "setWorktree is not defined" whenever called. index.ts calls setWorktree but never imports it from ./src/kanban.ts, so every call throws before any work happens. One-line import fix in index.ts.

# Specs
## Finding (from live test of #57 / 000057, unrelated to that change)

Every kanban_set_worktree call returns isError: true with ReferenceError "setWorktree is not defined".

## Root cause

- index.ts line 126 calls `setWorktree(ctx.cwd, task, params.worktree)`.
- The import list on index.ts line 8 is: createTask, getTask, kanbanDir, listAll, listTasks, setState, updateTask, STATES, type TaskState — `setWorktree` is missing.
- `setWorktree` is exported from src/kanban.ts and covered by existing unit tests in src/kanban.test.ts (which imports it directly), so only the tool wiring in index.ts is broken.

## Verified

- Pre-existing bug: the main checkout's index.ts has the identical missing import, so the tool has been broken on main too; unrelated to the #NN change that was just live-tested.
- Verified live via `pi -p` with the worktree extension: every kanban_set_worktree call returned isError: true with "setWorktree is not defined".

## Fix

- Add `setWorktree` to the import list on index.ts line 8 (one-line fix).

## Acceptance

- kanban_set_worktree sets the task's worktree attribute successfully at runtime.
- Typecheck and the test suite stay green.

# Notes
