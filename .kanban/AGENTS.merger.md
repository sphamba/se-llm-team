# merger: role guidance

The spawn prompt owns the steps, the state ban, and the test requirement. This file gives the method and the repo facts. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Task findings go in `# Notes`, never in this file or `AGENTS.md`. The Specs beat this file and the spawn prompt.

## Decide each conflict once

- Read `SPECS.md` once, fully, and decide each file's policy before the first edit. The spawn prompt's base-wins rule is the default for behavior that the Specs do not mention. It is not a reason to drop the replayed change that the task exists to make.
- Choose one policy per file, then stop. If the Specs own the file (rewrite, rename, delete), keep the replayed side and re-add the base-only facts that the file's scope covers. If the Specs do not mention the file, keep the base side. If both sides changed different regions, merge the regions. If both sides only append, keep both.
- Do not run `git checkout --ours` or `--theirs` on a file that both sides changed, even though the spawn prompt names it: it drops the other side without a review. Use it only for a pure delete or a pure revert.
- One `git status` plus one full `git diff` shows every conflict. The `<<<<<<<` side is the base (`ours`). The `>>>>>>>` side is the replayed commit (`theirs`). Work at the granularity of the marker block and keep every line outside it.
- Do not rebuild branch history and do not fact-check the document. The Specs and the review pass already did. A base-only fact is visible in the diff. Check a base-added claim only when the resolution depends on it, with one grep. Do not polish wording: write an added sentence once in the file's style, then move on.

## Resolve, continue, stop

- Resolve each block with `edit`, and keep the chosen side verbatim. A short script is acceptable for a whole-section block, but it must not touch one byte outside the markers.
- `tests/orchestrator/integration.test.ts` is one `// --- part N:` list at module scope. When both sides append a part, the part numbers and the module-scope names that carry them collide. Keep the base part verbatim, renumber the replayed parts and every name that carries the number (`root<N>`, `cfg<N>`, `covered<N>`, `lane<N>`, `stubDir<N>`), and merge the closing summary `console.log` lines into one. Never renumber the base side.
- Renumber with explicit old/new pairs and one `assert old in text` per pair, not a `\b` regex: a word boundary does not fire between a digit and a letter, so a name such as `covered16Pid` survives the pass. Then prove the result with one `grep -nE '(root|cfg|covered|lane|waiting|stubDir)[0-9]+' <file>`.
- Confirm with one marker grep: `grep -rn '^<<<<<<<\|^>>>>>>>' <files>`. A hit in a test fixture is not a real conflict. Then continue and print the state in one chained call: `git add <files> && GIT_EDITOR=true git rebase --continue && git log --oneline -3 && git status`. A rebase can stop once per replayed commit, so resolve the next round the same way. Do not rerun a suite after the continue when it passed on the tree you staged, because the continue does not change file content.
- Never run `git rebase --abort` and never commit a file with markers. Finish with a clean tree, or leave the untouched stopped rebase and write one blocker line in `# Notes`.
- If the continue stops at the commit step, the pick is listed as done and as next, and HEAD stays at the base, signing failed. Commit the staged tree with the original message, author, and date plus `--no-gpg-sign`, then continue. The duplicate then drops as already upstream. Never amend in this state.

## Tests

- There is no build and no typecheck. Run the suite once from the worktree as `npm test >/tmp/merge-test.log 2>&1; echo EXIT=$?`. The script is a `for` chain over `index.test.ts tests/*.test.ts tests/*/*.test.ts` that stops at the first red file, so the first failure line decides and no later suite ran. Do not read `package.json` first. If the replayed commit adds a test file that the chain skips, also run `node tests/<area>/<file>.test.ts` once.
- A red suite does not block the finish. It is one finding for `# Notes`, so spend one triage turn and stop. A wait failure prints `timeout waiting for ...`, not `Error`, so grep `timeout waiting|AssertionError|Error:` and match the wait text to its suite with one `grep -ln '<text>' tests/`.
- Prove a pre-existing red from the diff, not from the base: when `git diff --stat <base>..HEAD -- <suite> src/` is empty, the branch cannot have caused the failure. Write one line that names the suite, the first failure line, and the empty diff, then finish. Never check out the base, never rerun the suite to confirm, and never page the suite, `pipeline.ts`, or `tests/helpers.ts` to explain it.

## Task file and scope

- `SPECS.md` is a symlink to `.kanban/<NNN>_<slug>.md` in the main checkout, and `.kanban` is a symlink to the main checkout's board. Append through `SPECS.md`. Do not copy the file and do not rewrite the rest. `readlink -f SPECS.md` gives the real path when a tool complains.
- A task file can end with `# Open questions`, so a bare `cat >> SPECS.md` lands inside that section. Insert the `## Merge resolution` block before that heading when it exists, otherwise append, and then prove the heading order with one `grep -n '^# \|^## ' SPECS.md`. Write the notes as flat lines: what was resolved, the suite result, the blocker. No cross-reference such as "the section above" and no second wording pass.
- Put only user or client questions in `# Open questions`. Answer a technical question in the code, the docs, or online, and delete the question when the answer reaches the Specs.
- Change only the conflict blocks. Report a wrong line outside them in `# Notes`, do not fix it. Touch only your worktree: never edit `AGENTS.md`, never stage or commit a board file, `SPECS.md`, or `AGENTS.md`, and never change a task state. The orchestrator owns the move.
- Shell traps: chain reads with `;` or `|| true` because a zero-match `grep` exits 1 and drops the rest of an `&&` chain. Run every command from the worktree. Do not truncate a diff or the test log that the decision needs.
