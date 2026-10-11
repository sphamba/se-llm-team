---
name: "feat: kanban task removal path (delete file + mirror snapshot in one operation)"
priority: "low"
state: "reviewing"
worktree: "feat/64-kanban-task-removal"
---

# Summary
There is no supported way to remove a mistaken task from the kanban board: the kanban tools have no delete action, and manually deleting a task file self-heals back (reconcileBoard restores mirror files). Add a kanban delete/removal path that deletes the file and commits a whole-board mirror snapshot in one operation, or document a removal procedure.

# Specs
Found during the live test of task 000050 (orchestrator auto-push of meta/kanban). Evidence:

- The kanban tools expose no delete action; a mistaken task cannot be removed by the agent.
- Manually deleting a task file self-heals back: the daemon's reconcileBoard (src/orchestrator.ts, called at the top of rescan before boardStatus reads and before any commitKanban) treats the meta/kanban mirror as the source of truth and restores files that exist on the mirror but not in the working tree.
- A daemon restart before the next mirror commit also restores tree-deleted files.
- During the 000050 live test, four scratch tasks could only be removed by rewriting the mirror ref with manual git plumbing (git commit-tree + update-ref on refs/heads/meta/kanban).

Suggested fix (either):
1. A kanban delete/removal path: a kanban_delete tool or equivalent that deletes the task file and commits a whole-board mirror snapshot in one operation, so the removal reaches the mirror and cannot be reconciled back.
2. A documented removal procedure in the project docs/SKILL.md for removing mistaken tasks safely.

Priority low, type feat.

# Notes

- [2026-10-11 17:03] Implemented the removal path (worktree feat/64-kanban-task-removal, commit 1299c21): removeTask in src/orchestrator.ts deletes the task file and commits a whole-board mirror snapshot in one operation, so reconcileBoard cannot restore the file. commitKanban gained allowEmpty so removing the last task commits an empty-board snapshot. While a daemon runs, the mirror tip is checked after a 1s settle delay and the removal retries (3 attempts) when a racing sweep re-added the file with a stale pre-removal snapshot. Non-git boards: deleting the file is the whole removal. New kanban_delete tool in index.ts exposes it to the PM session (worktree/branch of a started task are left in place). README.md and skills/se-llm-team/SKILL.md document the tool and the never-delete-by-hand rule. New orchestrator.test.ts part AB covers removal with the daemon running, non-restore across sweeps and a restart, last-task removal and unknown-file reporting. node src/kanban.test.ts and node src/orchestrator.test.ts pass.
