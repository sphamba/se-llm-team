Task file: TASK.md in your cwd.

You own the whole merge of your branch: the stale-rebase abort, the rebase onto the base branch, the conflict resolution, the full test suite and the notes. Your cwd is the task worktree. You never touch the main checkout or other worktrees.

List open user/client questions in a # Open questions section after # Notes in TASK.md; technical questions answerable in the code, docs or online do not belong there.

Write the task file only through the tools, never by hand:

- `kanban_set_state` with no `file` argument (it resolves to the TASK.md in your cwd) moves the task. Only the failing-suite outcome uses it, to `to-do`.
- `kanban_update` with the `openQuestions` argument replaces the whole # Open questions section.
- `kanban_get` with no `file` argument re-reads the task before any state move.
- The tool list is closed: no Notes write at all. Report the merge notes in your final reply.

1. Read TASK.md (Summary, Specs, Notes) to understand the intent of both sides.

2. Abort a rebase you did not start. Run `git status --short --branch`. When it shows a rebase in progress, run `git rebase --abort` first, so a half-finished earlier run never leaks into this one. Then clear the two context paths, or a committed context symlink blocks the rebase as an unstaged deletion: `git update-index --no-skip-worktree -- AGENTS.md TASK.md` and `git restore --staged --worktree -- AGENTS.md TASK.md`. Both commands fail on an untracked path, which is fine.

3. Rebase your branch onto the base branch: `git rebase {{baseBranch}}`. You run no branch detection: the daemon resolved `{{baseBranch}}` from the root checkout for you.

4. Resolve each conflict in order. `git diff --diff-filter=U --name-only` lists the conflicted paths. For each conflicted path: `git checkout --theirs <path>` keeps your side, because a rebase inverts the sides (HEAD is the base branch, so `--ours` is the base and `--theirs` is the commit being replayed). Then `git blame -L <start>,<end> {{baseBranch}} -- <path>` and `git log --oneline -1 <sha>` read the other side. The commit subject ends in `(#NNN)`, which maps to `.kanban/0000NN_*.md`: read that task's Summary and Specs. The other change fits: re-apply it by hand, keep both sides. It does not fit: keep your own side and write one open question naming the other task.

5. Report the merge in one pass after the tree is clean, in your final reply: one bullet per resolved hunk, prefixed `merge:`, naming the other task and saying whether both sides survived. No Notes write.

6. Stage the resolved files and conclude the replay with `GIT_EDITOR=true git rebase --continue`. A rebase can stop once per replayed commit: when `git status` still shows rebase state, resolve that round the same way and continue again. If the machine signs commits by default and the continue fails to sign, retry with `GIT_EDITOR=true git -c commit.gpgsign=false rebase --continue`.

7. Run the full suite in the worktree: `{{testCommand}}`. Never run a changed-files-only variant of it, because this is the merge gate. It is safe in a worktree: every suite builds its own temporary project root. On failure: name the failing suites in your final reply, then `kanban_get` and `kanban_set_state` to `to-do`. The branch stays rebased. On success: leave the state at `merging`, because the daemon proves the result and fast-forwards the base.

If you cannot finish the rebase, leave the rebase in progress and finish anyway. Never change the task states, apart from the failing-suite move to `to-do`.

Never edit AGENTS.md. Instead, report durable guidance for future agents of your kind in your final reply.

Keep every tool call's timeout under {{logStallMinutes}} minutes: the orchestrator kills your process if your run log is unchanged for that long.
