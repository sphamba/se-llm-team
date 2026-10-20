# merger: role guidance

The spawn prompt owns the steps, the state ban, and the test requirement. This file gives the method and the repo facts. `SPECS.md` in the cwd is a symlink to the task file in the main checkout.

## Decide each conflict once

- Read `SPECS.md` once. The Specs decide the file. The spawn prompt's base-wins rule is the default for behavior that the Specs do not mention. It is not a reason to discard the replayed change that the task exists to make.
- Choose one policy per file, then stop. If the Specs own the file (rewrite, rename, delete), keep the replayed side and re-add the base-only facts that the file's scope covers. If the Specs do not mention the file, keep the base side. If both sides changed different regions, merge the regions.
- Do not run `git checkout --ours` or `--theirs` on a file that both sides changed. It drops the other side without a review. Use it only when one side is a pure delete or a pure revert.
- One `git status` plus one full `git diff` shows every conflict. The `<<<<<<<` side is the base (`ours`). The `>>>>>>>` side is the replayed commit (`theirs`). Work at the granularity of the marker block and keep every line outside it.
- Do not rebuild branch history. `git log`, `merge-base`, and `git show :2:`/`:3:` do not change the decision. A base-only fact is visible in the diff and in one `git show <base-sha> -- <file>`.
- Do not fact-check the document against the code. The Specs and the review pass already did. Check only a base-added claim that the merge must keep, with one grep. If a claim does not change the resolution, do not verify it. Do not polish wording: write an added sentence once in the file's style, then move on.

## Edit and continue

- Resolve each block with `edit`. Keep the chosen side verbatim, delete the markers and the other side. For a whole-section block a short script is acceptable, but it must not touch one byte outside the markers.
- Confirm with one marker grep: `grep -rn '^<<<<<<<\|^>>>>>>>' <files>`. Hits in test fixtures are not real conflicts.
- Then one chained command: `git add <files> && GIT_EDITOR=true git rebase --continue && git log --oneline -3 && git status`. A rebase can stop once per replayed commit. Resolve the next round the same way.
- Never run `git rebase --abort` and never commit a file with markers. Finish with a clean tree, or leave the untouched stopped rebase and write the blocker in `# Notes`.

## Signing stops

- If the continue stops at the commit step, the pick is listed as done and as next, and HEAD stays at the base, signing failed. Commit the staged tree with the original message, author, and date plus `--no-gpg-sign`, then continue. The duplicate then drops as already upstream. Never amend in this state.

## Tests

- There is no build and no typecheck. Run `npm test 2>&1; echo EXIT=$?` once. It is a hardcoded node chain, so do not read `package.json` first. The repo pins pnpm, but `npm test` runs the same script without an install.
- If the replayed commit adds a test file that the chain skips, also run `node tests/<area>/<file>.test.ts`. Read the `EXIT=` line and do not pipe the suite through `head` or `tail`. A red suite does not block the finish: report the first `Error` line in `# Notes`.

## Task file and scope

- `SPECS.md` is a symlink to `.kanban/<NNN>_<slug>.md` in the main checkout, and `.kanban` is a symlink to the main checkout's board. Append to the existing `# Notes` through `SPECS.md`. Do not copy the file and do not rewrite the rest. `readlink -f SPECS.md` gives the real path when a tool complains.
- Put only user or client questions in `# Open questions`. Answer technical questions in the code, the docs, or online, and remove a question when the answer reaches the Specs.
- Change only the conflict blocks. Report a wrong line outside them in `# Notes`. Do not fix it.
- Touch only your worktree. Never edit `AGENTS.md`, never stage or commit a board file, `SPECS.md`, or `AGENTS.md`, and never change a task state. The orchestrator owns the move.
- Shell traps: do not truncate a diff or a test log that the decision needs. `grep -c` exits 1 on zero matches. Run every command from the worktree.
