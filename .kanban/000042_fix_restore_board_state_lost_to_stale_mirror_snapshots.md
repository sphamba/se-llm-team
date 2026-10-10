---
name: "fix: restore board state lost to stale mirror snapshots"
priority: "high"
state: "doing"
worktree: "fix/restore-board-state-lost-to-stale-mirror-snapshots"
---

# Summary
Restore the 4 task files erased from .kanban (under fresh numbers 000045-000048, their old numbers now taken by active tasks) and the 3 tasks (000034, 000037, 000041) whose done state was reverted to backlog, taking each file's newest state from the intentional commits in refs/heads/meta/kanban history. Board surgery only; no code changes.

# Specs
# Context

The daemon mirrors the working-tree .kanban onto refs/heads/meta/kanban via full-tree snapshot commits (git plumbing: hash-object -w, mktree, commit-tree, update-ref — src/orchestrator.ts commitKanban). A stale working tree produced snapshot commits that (a) erased files 000042-000045 from the branch tip and (b) reverted states of 000034, 000037, 000041 from done back to backlog. The user then restored .kanban from the stale tip, so the working tree now holds 41 files (9 backlog, 32 done) and matches the stale tip. Correct end state: 45 files, each task showing the state of its newest intentional commit on refs/heads/meta/kanban.

# Specs
# Context

The daemon mirrors the working-tree .kanban onto refs/heads/meta/kanban via full-tree snapshot commits (git plumbing: hash-object -w, mktree, commit-tree, update-ref — commitKanban in src/orchestrator.ts). A stale working tree produced snapshot commits that (a) erased files 000042-000045 from the branch tip and (b) reverted states of 000034, 000037, 000041 from done back to backlog. The tip now holds 41 files matching that stale tree. Correct end state: every task file present with the state of its newest intentional commit (kanban: create / kanban: done) in refs/heads/meta/kanban history.

Numbering: 000042-000044 are taken by three active tasks created today (this task; chore: merge origin/main into main; fix: reconcile working-tree .kanban from meta/kanban). Do NOT rename any active task file — agent pid/log files key on the task filename (src/orchestrator.ts:122), renaming wedges the pipeline. The 4 erased tasks therefore restore under fresh numbers 000045-000048 with a provenance note.

# Specs

- Work in the task worktree; .kanban is a symlink to the shared root board, so writes land on the shared board and the running daemon mirrors them to refs/heads/meta/kanban. The daemon mirrors automatically (10s scan); run no git plumbing against refs/heads/meta/kanban yourself. Modify no code files; never stage anything.
- Step 1 (restore 4 erased tasks), fresh numbers:
  - 000045_fix_mirror_commit_label_swallows_create_events_on_refs_heads_meta_kanban.md (erased as 000042_fix_mirror_commit_label_swallows_create_events_on_refs_heads_meta_kanban.md)
  - 000046_fix_fresh_non_bare_clone_bootstrap_never_materializes_the_board.md (erased as 000043_fix_fresh_non_bare_clone_bootstrap_never_materializes_the_board.md)
  - 000047_<original slug>.md (erased as 000044_<original slug>.md; find the slug with `git log --format='%H %s' refs/heads/meta/kanban --diff-filter=A -- '.kanban/000044*'`)
  - 000048_fix_webui_horizontal_scrollbar_sits_mid_screen_pin_it_to_the_viewport_bottom.md (erased as 000045_fix_webui_horizontal_scrollbar_sits_mid_screen_pin_it_to_the_viewport_bottom.md)
  For each: find the newest commit on refs/heads/meta/kanban whose subject starts with `kanban: done <erased filename>` (fall back to `kanban: create <erased filename>`); read the full file content at that commit (`git show <commit>:<path>`); write it into .kanban/ under the fresh number, keeping the frontmatter (state "done", priority, name) and body from that commit; append one line to the # Notes section: `Restored from erased task <erased filename> (refs/heads/meta/kanban history commit <short sha>); renumbered because the old number is taken by an active task.`
- Step 2 (fix 3 regressed states), for these files: 000034_fix_board_lives_on_a_meta_kanban_branch_kanban_untracked_mirrored_by_the_daemon.md, 000037_fix_orchestrator_wait_resolves_the_board_feed_from_session_cwd_worktree_sessions_never_see_main_checkout_events.md, 000041_fix_webui_theme_is_one_dark_use_ayu_light_and_ayu_dark_instead.md: find the newest commit on refs/heads/meta/kanban whose subject starts with `kanban: done <filename>`; set the frontmatter state to "done" (or copy the full file content from that commit). Touch nothing else in these files.
- Touch no other task files.

# Acceptance

- refs/heads/meta/kanban tip holds 48 task files with unique numbers (000001-000048).
- The 7 recovered tasks (000034, 000037, 000041, 000045, 000046, 000047, 000048) state "done" in the working tree and on the branch tip.
- Working-tree .kanban matches the branch tip exactly.
- No code files changed in this task.

# Acceptance

- refs/heads/meta/kanban tip contains 45 task files; 000034, 000037, 000041, 000042, 000043, 000044, 000045 all state "done".
- Working-tree .kanban matches the branch tip exactly.
- `git ls-files .kanban` in the main checkout is empty (nothing staged).
- No code files changed in this task.

# Notes
