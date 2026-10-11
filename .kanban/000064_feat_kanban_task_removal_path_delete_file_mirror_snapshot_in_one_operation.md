---
name: "feat: kanban task removal path (delete file + mirror snapshot in one operation)"
priority: "low"
state: "doing"
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
