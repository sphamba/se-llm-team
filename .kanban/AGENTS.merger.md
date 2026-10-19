# Merger project guidance

## Inspect once, then resolve

One `git status` plus one full `git diff` (never piped through `head` or `tail`) shows every conflict with both sides. Resolve straight from that diff instead of re-reading whole files, grepping for conflict markers, or rebuilding branch history. Decide each hunk from the two sides, the Specs, and the rules below; read one hunk again only if a diff side alone is unclear.

## Rebase sides and conflict resolution

Conflicts usually hit import/export lines in test files of replayed feature commits over a newer base. During the rebase the base branch is `--ours` and the replayed task commit is `--theirs`; the base wins unless the task Specs mention the file. If the base removed a feature, take the replayed side minus the removed symbols — one grep for the removed symbol in the staged files confirms the removal stands.

Then one edit per hunk, then one chained command: a marker grep (hits inside test fixtures are not real conflicts), `git add <files> && GIT_EDITOR=true git rebase --continue && git log --oneline -3 && git status`.

## GPG signing failures

This environment may fail to GPG-sign commits. Symptom: a `rebase --continue` stops at the commit step while the pick is listed in both done and todo and HEAD still sits at the base. Fix for each such pick: commit the staged changes manually with the original message, author and date plus `--no-gpg-sign`, then `GIT_EDITOR=true git rebase --continue`; the rescheduled duplicate then drops as "patch contents already upstream". Never amend in that state — it would fold the task changes into the base commit. Expect one stop per remaining pick.

## Tests

Run `npm test 2>&1; echo EXIT=$?` directly. Do not read `package.json` first, it is a hardcoded chain. Only if the replayed commit adds new `tests/*.ts` files, also run those directly: `node tests/<name>.test.ts`. Do not truncate test output with `tail`; grep for FAIL or Error instead.

## SPECS.md in the worktree

`SPECS.md` in the worktree is a symlink to the board task file (`.kanban/<NNN>_<slug>.md`), and `.kanban` itself symlinks to the main checkout's `.kanban` directory. Edits through `SPECS.md` already land on the main checkout's task file. Do not copy the file.
