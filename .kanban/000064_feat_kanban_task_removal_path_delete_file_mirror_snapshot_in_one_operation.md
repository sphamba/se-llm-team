---
name: "feat: kanban task removal path (delete file + mirror snapshot in one operation)"
priority: "low"
state: "to-merge"
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
- [2026-10-11 17:17] Review of commit 1299c21 passed. The change meets both spec options: the kanban_delete tool (removeTask deletes the file and commits the whole-board snapshot in one operation) and the documented never-delete-by-hand rule (README.md, SKILL.md). Checked the race logic: a daemon commit with a stale pre-removal snapshot fails at git hash-object when the file is gone from the tree, and the retry loop covers the remaining interleaving. The identical-tree early return in commitKanban is safe here, because the tip check after it confirms the removal. Non-git, last-task (empty board), unknown-file and daemon-restart cases are all covered by test part AB. No new dependencies; the code reuses commitKanban, git, taskFiles and pidAlive. node src/kanban.test.ts and node src/orchestrator.test.ts pass in the worktree. No fixes needed.
- [2026-10-11 17:17] Live test of commit 1299c21 passed (worktree feat/64-kanban-task-removal). Ran the project from the worktree like a user: `node src/kanban.test.ts` passed, `node src/orchestrator.test.ts` passed twice of three runs (the first run flaked in part G, see the finding below), including the new "task removal smoke passed" part AB. Independent end-to-end fixture run against a real git project and the real daemon (node src/orchestrator.ts --root ...): removing one of two tasks left the file out of the tree and out of the meta/kanban mirror tip, recorded `kanban: delete <file>`, left the other task untouched, and survived daemon sweeps plus a daemon restart; removing the last task produced an empty-board snapshot that survived a sweep; a non-git board deleted the file only; an unknown file returned "No task" and deleted nothing; a git board with no daemon mirrored the removal; a bare name without `.md` was accepted. All 23 checks passed. Code inspection confirms index.ts registers kanban_delete and README.md and SKILL.md document the tool and the never-delete-by-hand rule.
- [2026-10-11 17:17] Finding (unrelated to this change, pre-existing flake): on one of three `node src/orchestrator.test.ts` runs, part G failed at src/orchestrator.test.ts:473 with `AssertionError: worktree kept while the live-tester pid is alive`. The two later runs passed, so this is a timing flake in the part G merger-defer logic, not a regression of commit 1299c21. Reported to the PM for a separate low-priority task. Note that this abort also skipped part AB on that run, because the test file runs parts sequentially and exits on the first assertion failure.
