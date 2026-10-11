---
name: "fix: daemon restart reverts in-flight task state and notes to the mirror tip"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
A daemon restart mid-pipeline reverts in-flight task state and notes to the mirror tip: mirror commits only happen at create and done, and reconcileBoard on daemon start materializes refs/heads/meta/kanban over the working tree, wiping in-flight agent writes to mirrored task files. Observed a reviewer's to-live-test state and notes reverted to to-do with empty notes; the task re-ran from scratch (self-healed, but in-flight progress is lost).

# Specs
Side finding from the 000054 live test; belongs to the merged reconcile-working-tree feature, not 000054.

Evidence:
- Mirror commits only happen at task create and done, so an in-flight task's state attribute and notes changes are working-tree writes that were never committed to refs/heads/meta/kanban.
- reconcileBoard (src/orchestrator.ts, definition ~line 377 in the current root checkout; called from bootstrapBoard at every daemon start, ~line 492) materializes refs/heads/meta/kanban over the working tree. The task file IS tracked in the mirror branch at its older content, so the checkout overwrites the in-flight edits - only files never tracked in the branch survive, so the "unmirrored writes survive" comment in bootstrapBoard does not hold for tracked files with newer working-tree content.
- Observed: a reviewer's to-live-test state and notes reverted to to-do with empty notes after a daemon restart; the task re-ran from scratch (self-healed, but in-flight progress is lost).

Fix direction: preserve newer working-tree content for mirrored task files across reconcileBoard (e.g. commit in-flight working-tree state before materializing, stash/restore, or a diff-aware merge), or route agent kanban writes through the mirror. Keep reconcile idempotent and never re-trigger on our own mirror commits.

# Notes
