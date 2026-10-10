---
name: "fix: mirror commit label swallows create events on refs/heads/meta/kanban"
priority: "medium"
state: "to-do"
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
