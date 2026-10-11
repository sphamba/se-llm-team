---
name: "fix: daemon restart reverts in-flight task state and notes to the mirror tip"
priority: "medium"
state: "reviewing"
worktree: "fix/69-daemon-restart-reverts"
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
- [2026-10-11 12:16] Implemented in the worktree (commit e676225). reconcileBoard now keeps every local .kanban file that already exists, equal to the tip or not, and materializes only files the working tree lacks. A differing local file is an in-flight agent write because only creates and dones reach the mirror, so the next rescan mirrors it as before and done commits still fire. External additions still materialize and external deletions still propagate. The reconcile log now reports the kept count ("N in-flight kept" when N > 0).
- [2026-10-11 12:16] Test: orchestrator.test.ts part Z. A task is mirrored at create (state backlog), the daemon exits, the test writes state to-live-test plus a note in the working tree, and a second daemon starts. It asserts the kept log line, the live-tester spawn, the note in the file, and the later kanban: done mirror commit that carries the note.
- [2026-10-11 12:16] Verification: node src/kanban.test.ts passes, node src/orchestrator.test.ts passes all parts A to Z. Red check: the same part Z fails against the unpatched code with "reconciled .kanban ...: 1 file(s) updated, 0 deleted" (the clobber).
- [2026-10-11 12:16] Deliberate trade-off: on a restart the daemon cannot tell a newer in-flight write from a stale local copy, so the working tree wins for any file that exists locally. An external modification of a file the working tree already has does not propagate, and the next snapshot commit supersedes it. External additions and deletions are unaffected.