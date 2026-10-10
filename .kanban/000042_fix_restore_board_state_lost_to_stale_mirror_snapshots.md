---
name: "fix: restore board state lost to stale mirror snapshots"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Restore the 4 task files (000042-000045) erased from .kanban and the 3 tasks (000034, 000037, 000041) whose done state was reverted to backlog, taking each file's newest state from the intentional commits (kanban: create / kanban: done) in refs/heads/meta/kanban history. Also unstage the 41 board files staged in main's index by the user's manual checkout.

# Specs
# Context

The daemon mirrors the working-tree .kanban onto refs/heads/meta/kanban via full-tree snapshot commits (git plumbing: hash-object -w, mktree, commit-tree, update-ref — src/orchestrator.ts commitKanban). A stale working tree produced snapshot commits that (a) erased files 000042-000045 from the branch tip and (b) reverted states of 000034, 000037, 000041 from done back to backlog. The user then restored .kanban from the stale tip, so the working tree now holds 41 files (9 backlog, 32 done) and matches the stale tip. Correct end state: 45 files, each task showing the state of its newest intentional commit on refs/heads/meta/kanban.

# Specs

- Work in the task worktree; .kanban is a symlink to the shared root board, so writes land on the shared board and the running daemon mirrors them to refs/heads/meta/kanban.
- Step 1 (one-time, main checkout index): run `git -C /home/phamba/repos/se-llm-team restore --staged .kanban`. The 41 board files the user staged leave main's index; files stay on disk and .kanban becomes untracked-ignored again as designed. If the index is locked, wait and retry once. Change nothing else in the main checkout.
- Step 2 (recovery): for each of the 7 tasks — state-fix 000034, 000037, 000041; file-restore 000042, 000043, 000044, 000045 — find the newest commit on refs/heads/meta/kanban whose subject starts with `kanban: done <file>` or `kanban: create <file>` for that task file (`git log --format='%H %s' refs/heads/meta/kanban -- .kanban/<file>`). For missing files (000042-000045): write the full file content from that commit into .kanban/ (git cat-file blob / git show <commit>:<path>). For state regressions (000034, 000037, 000041): set only the frontmatter state to "done", or copy the full content from the newest done commit if simpler. Touch no other task files. Modify no code files.
- Step 3 (allocator guard): the task-number counter lives at .kanban/.logs/<name>.count (counterPath, src/kanban.ts:57-76). Confirm its value is >= 45 after recovery; if lower, raise it so the next kanban_create cannot collide with restored 000042-000045.
- The running daemon mirrors your writes automatically (10s scan); do not run git plumbing against refs/heads/meta/kanban yourself.
- Final verify: `git ls-tree --name-only refs/heads/meta/kanban:.kanban | wc -l` = 45; the 7 tasks show state "done" both in .kanban/ and on the branch tip; `git status --porcelain .kanban` in the main checkout is empty.

# Acceptance

- refs/heads/meta/kanban tip contains 45 task files; 000034, 000037, 000041, 000042, 000043, 000044, 000045 all state "done".
- Working-tree .kanban matches the branch tip exactly.
- `git ls-files .kanban` in the main checkout is empty (nothing staged).
- No code files changed in this task.

# Notes
