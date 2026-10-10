---
name: "fix: restore board state lost to stale mirror snapshots"
priority: "high"
state: "done"
worktree: ""
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
- Restored the 4 erased tasks under fresh numbers, from their newest intentional commits on refs/heads/meta/kanban. 000045 = erased 000042 (fix: mirror commit label swallows create events), commit 0d83d8b, state done. 000046 = erased 000043 (fix: fresh non-bare clone bootstrap never materializes the board), commit b65f275, state done. 000047 = erased 000044 (fix: webui polling resets the animated card spinners every refresh), commit 6aa8dd3. 000048 = erased 000045 (fix: webui horizontal scrollbar sits mid-screen), commit a3c54fc, state done. Each file holds the provenance line in its # Notes. I wrote the files into .kanban only and ran no git plumbing; the running daemon mirrored them onto refs/heads/meta/kanban.
- DEVIATION from the acceptance bullet: 000047 is restored with state "backlog", not "done". The mirror history for the erased 000044 holds only its creation commit 6aa8dd3 (added 23:49, deleted 00:44 by the stale snapshot). No kanban: done commit exists for it, and the spinner-preservation fix is verifiably absent from src/webui.ts (refresh() still rebuilds the DOM every 5 s, so the .spin animation still restarts). Forcing done would hide real pending work. Its HOLD queue (000041, 000039, 000033, 000036) is now all done, so the task is unblocked. Set it to done if it should be closed anyway.
- Restored 000034, 000037, 000041 by copying their full done-commit content (commits 3f83242, 959af3f, d58b708). This sets state "done" and also recovers the pipeline notes that the stale restore had wiped. Verified byte-identical to those commits.
- Extra damage found, already healed: in the stale window (00:06-00:44) the mirror shrank to 16-19 files; 000001-000026, 000028, 000031, 000033 were erased from the branch. The 00:44 restore (commit 147fddc) brought them back. No action needed.
- End state verified: the surgery restored the board to 48 files with unique numbers (a 49th task, 000049, was created by the PM from the 000043 live-test report while I worked). The working tree matches the branch tip with 0 blob differences. `git ls-files .kanban` in the main checkout returns 0 (nothing staged). No code files changed, so there is nothing to commit in this worktree; the board surgery landed on refs/heads/meta/kanban through the daemon mirror.
- [2026-10-11 01:20] Live test passed. Verified the end state like a user: refs/heads/meta/kanban tip holds 49 task files (48 from the surgery plus 000049, created by the PM mid-flight), numbers 000001-000049 unique and contiguous, no gaps or duplicates. The 7 recovered tasks check out: 000034, 000037, 000041, 000045, 000046, 000048 state "done" in the working tree and on the branch tip, content byte-identical to their source commits (spot checks: 000041 equals d58b708, 000046 equals b65f275 plus the provenance line only). 000047 states "backlog" as documented. Independent check of that deviation: no kanban: done commit exists for erased 000044, its creation was folded under the "kanban: done 000001..." commit 6aa8dd3 (the label bug task 000045 describes), restored content matches that commit plus the provenance line, and the spinner fix is absent from src/webui.ts (render() rebuilds board.innerHTML every refresh). Backlog is correct, not a regression. Working-tree .kanban matches the branch tip: 49/49 file lists identical, 48/49 blobs identical. The one blob difference was this task's own live-testing state change, which the daemon mirrors only on create and done events, so the lag is by design and not a surgery defect. `git ls-files .kanban` in the main checkout returns 0, and the worktree branch has zero code changes (HEAD equals the merge-base with origin/main, empty diff). kanban_list reads the board correctly: restored tasks appear in the right columns (000047 in backlog, the rest in done), kanban_get serves the restored files. No issues found, no new tasks needed.
- [2026-10-11 01:15] Review passed, no fixes. Verified all 7 touched files byte-identical to their source commits on refs/heads/meta/kanban: 000045 = 0d83d8b, 000046 = b65f275, 000047 = 6aa8dd3, 000048 = a3c54fc (each plus only the required provenance line in # Notes); 000034 = 3f83242, 000037 = 959af3f, 000041 = d58b708, full copies. Provenance lines match the spec format exactly. Confirmed 3f83242, 959af3f, d58b708, b65f275, a3c54fc, 0d83d8b are the newest done/create commits for their files; confirmed no kanban: done commit exists for 000044, and verified against src/webui.ts that the spinner fix is absent (render() rebuilds board.innerHTML every 5 s), so the documented backlog state for 000047 is the right call, not a regression. Worktree branch has zero code changes (HEAD == merge-base with main), main index has nothing staged, and the board file list and all 49 file blobs matched the mirror tip at review time. Observation: the mirror tip lags the working tree on this file's own reviewing-state change (last mirror commit 832d295 at 01:11); the daemon runs and should catch up on its scan, and backlog task 000044 (reconcile working-tree .kanban on start and every scan) targets this gap.
