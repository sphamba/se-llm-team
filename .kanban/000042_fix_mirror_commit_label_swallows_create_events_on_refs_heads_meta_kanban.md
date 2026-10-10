---
name: "fix: mirror commit label swallows create events on refs/heads/meta/kanban"
priority: "medium"
state: "live-testing"
worktree: "fix/mirror-commit-label-swallows-create-events-on-refs-heads-meta-kanban"
---

# Summary
In rescan (src/orchestrator.ts), a done task without a worktree calls commitKanban("kanban: done <file>") unconditionally every sweep; since commitKanban builds the tree from the whole board, the first such call folds all pending board changes under that task's label, so later "kanban: create" calls find an identical tree and are skipped. New tasks never get their own create mirror commit and orchestrator_wait never surfaces create events.

# Specs
FILE/FUNCTION: src/orchestrator.ts, rescan() task loop (the done branch, lines ~411–415: `if (!task.worktree || mergeDone(root, cfg, task)) commitKanban(root, \`kanban: done ${task.file}\`)`) plus commitKanban() (line ~156, builds the tree from the whole board via taskFiles(root); the only no-op guard is the identical whole-board tree).

ROOT CAUSE: commitKanban builds the tree from the whole board, so the first "kanban: done <file>" call in a sweep folds ALL pending board changes under that done task's message. Later tasks' "??"/create branches then find an identical tree and are skipped by the no-op guard.

REPRODUCTION: Reproduced twice in a sandbox: a task created while a done-no-worktree task existed produced only "kanban: done 000001_..." / "kanban: done 000002_..." mirror commits containing the new task's file — no "kanban: create" commit for it. Also demonstrated by the restarted daemon's first sweep on the real board (33 done tasks with worktree ""): drift of 000030/000034/000036 folded under "kanban: done 000001_...".

CONSEQUENCE: (1) A task created right after any done-no-worktree task exists never gets its own "kanban: create X" mirror commit (the folding commit is mislabeled "kanban: done <earliest done task>"). (2) orchestrator_wait, which reports commit subjects, never surfaces create events.

SUGGESTED DIRECTION (for the dev to decide): in rescan, process "??" (create) files before done files, or label the commit from the actual diff; keep the self-heal behavior (identical-tree no-op skip, deleted-file/disk-drift heal on next mirror commit).

# Notes

- 2026-10-10 22:15 Implemented in src/orchestrator.ts, rescan(): split the task loop into two passes. Pass one commits "kanban: create <file>" for every "??" (not-yet-mirrored) file before anything else, so a later whole-board done commit can no longer fold pending creates under its label. Pass two keeps the original branches; the create branch there now only retries a failed pass-one commit (identical-tree guard makes it a no-op otherwise).
- Gated the done commit on the file actually differing from the mirror (`if (code && merged)`) instead of calling commitKanban unconditionally. mergeDone still runs for every done worktree task (it completes the merge and clears the worktree), so the merge lifecycle is unchanged; the redundant middle branch (`code && done && !worktree`) was removed, it is fully covered by the gated done branch.
- commitKanban itself untouched: identical-tree no-op skip and deleted-file/disk-drift heal on the next mirror commit all preserved.
- Added part M to src/orchestrator.test.ts: a new task created while a settled done-no-worktree task exists must get its own "kanban: create" commit and further sweeps add nothing. Fails against the old code (verified by reverting), passes with the fix. Full orchestrator, kanban and webui suites pass.
- Known residual (out of scope, pre-existing): several files created between two sweeps still fold under the first "kanban: create" label, since pass one's first create commit rebuilds the tree from the whole board; a create event still surfaces, just one label covers several files. Per-file scoped commits would close that if it ever matters.
- 2026-10-10 22:40 Review passed, no fixes needed. Verified: `boardStatus` compares against the mirror ref, so the `if (code && merged)` gate is a per-file "differs from the mirror" check, correct for the settled-task case. Merge lifecycle unchanged (mergeDone still runs for every done worktree task; deferred and conflicted merges still suppress the commit, same as before). Removed middle branch is fully covered by the gated done branch: same message for non-empty code, and a "??" done file gets the pass-one create commit while the done commit no-ops on the identical tree. Ran all three suites (orchestrator, kanban, webui): pass. Re-ran the revert check myself: with main's orchestrator.ts, part M times out waiting for the late task's create commit, so the regression test really catches the bug. Heal-on-next-mirror-commit trade accepted as documented.
