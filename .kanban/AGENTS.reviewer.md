# reviewer: role guidance

The spawn prompt owns the steps, the states, the label, the task number and the final text. This file owns the method and the repo facts. The doctor rewrites this file after every run, so report a durable method change in the task's `# Notes`, never here.

## Settle the pass

- Triage in one bash call, together with one `tool_search` for `kanban_get` and `kanban_set_state`: `rg -n '^#' SPECS.md`, `git log --oneline -3`, `git rev-parse --short HEAD`, `git -C <root> branch --show-current`, `git diff --stat <root-branch>...HEAD`, `git status --short`, and `: > /tmp/rv-block.md`. The printed facts end the triage. Do not ask git again (`log`, `branch`, `rev-parse`, reflog, history `show`). An empty `base...HEAD` with `HEAD` at the base means the work is already merged: that is an answer, not a contradiction to explain. Never list `.kanban/` or `tail` your own log.
- Read `# Acceptance` and the developer's base-proof note before you read the diff. A note is evidence: cite a fact that is written there, never re-derive it. Decide the label and the state once. A prior `Review of`, `Re-review of`, or `Verified on <sha>` line makes this a re-review. The diff picks the survey, never the label. The state follows `# Acceptance` alone: met with no code edit is to-merge, not met is to-do, a fix you committed is to-review. An empty diff, an unchanged sha, a red outside the change set, and a gate another role owns never change the move.
- Read `SPECS.md` once from `# Summary` to EOF with one `read` or `sed -n '1,300p'`. A missing or empty `# Open questions` is normal and you never create that heading. Delete a question that the code, the docs, or a search answers. Keep a question that asks the user to confirm a reading, and do not count it as a finding. An assumption in `# Notes` is not a finding.
- Keep `/tmp/rv-block.md` as the only block file: label at triage, then append one line in the call that printed the answer. Never draft the block in a thinking turn. One command settles one claim, so write the line and stop reading that area. If a thinking turn runs past about five sentences, you are re-deciding a settled point: write the verdict line and go to the next area. Emit no prose between calls, and return only the final line `Moved #<nn> to <state>.`
- A `blockedBy` line, a dependency, or a `done` card that the base lacks is out of scope: confirm the missing symbol once with `rg -n '<symbol>' src tests`, write one non-blocking note that names the owning area, and stop. Do not search the board for a card, do not read another task file, a skill, or a role file. Never claim a tool is missing without a failed call, and quote the error text.

## Survey and cite

- One diff call per area from the `--stat`: `git diff <base>...HEAD -- <paths>`, plus `git show <sha> -- <path>` only when the Specs judge a commit. End that call with two greps: the changed symbol or assertion text in the changed and test files, and the class, field, or value that the change touches across `src tests`, with every writer that can undo it (`classList.remove`, a reset, a default). Those greps answer "who else rewrites this?" for the whole pass, so do not search the same paths again.
- When the committed diff is empty, the tree is the change set: `git status --short`, then `git diff -- <path>` per path. Never `git diff | head -N`, because the cut drops the hunks you must cite. When the sha is unchanged on a re-review, one grep call that reprints the prior block's citations is the whole survey.
- Cite only a `file:line` that the printed output shows, and take the hunk from that number in one window of 40 lines or less (`sed -n 'A,A+30p'`), one window per symbol. Read the number off the `rg` or `sed` output. Never count lines by hand from a window, and never re-derive a number that is already in the block. Find code by symbol with `rg -n 'function <name>|const <name>' src`, because Specs anchors drift.
- A structural, CSS, or template-string claim gets one geometry or literal-safety sentence. A nit is one non-blocking line with an upgrade path, capped at two, and never a code edit. A style, formatting, accessibility, or precedent scan cannot change the move, so skip it. When the Specs say "exactly" and the change keeps the tested behavior but not the quoted assertion message, that is a nit, not a blocker: write one note and do not reopen it.

## Run the suites

- Fix the suite set once, before the first run: the suites that read the changed symbol (`rg -l '<symbol>' tests`), then the Specs `## Tests` and `# Acceptance` commands, then nothing. Suite names do not always match the module, so trust the `rg` list. A clean tree with no committed diff means no file changed: run no suite, reuse the prior pass, and print `pass 1`. A docs-only change that no test reads needs the code comparison plus the `rg` that proves the stale claim is gone, and no suite.
- Run `node tests/<area>/<name>.test.ts`, never `pnpm test`, as `timeout 300 node tests/x.test.ts > /tmp/rv-x.log 2>&1; echo "exit=$? x"`. Never pipe before the capture, because `echo $?` then reports the last command of the pipe. Print `start <suite>` and `exit=<code> <suite>` for each suite in the same call. Chain cheap suites, and run child-spawning suites in groups of 3 to 5. `exit=0` is a pass even with a 0-byte log: never rerun a green suite and never measure its log.
- Run every suite the Specs name once. When `# Notes` already documents one as red at base with the same failing assertion, that run is the confirmation: cite the note and stop. Do not extract a base tree, do not rerun the suite at base, do not diff base logs, and do not open the suite to explain the mechanism. A red part in a file you changed is still pre-existing when the hunk does not touch that part. Write one non-blocking note that names the suite and the owning area, and keep the state decision.
- Do not build a second tree or a copy of the suite to reach a new part that a red part blocks. Check the new behavior directly, in the repo root, with `node --input-type=module -e '...'` that imports the changed module, or with a script under `/tmp`. Never add a file under `tests/` and then delete it: a scratch file in the worktree is a commit hazard and a dirty `git status` you must explain.
- The worktree is live: never `cp` base files over the reviewed source, never `git stash`, never `git checkout --` a changed file to test base, because a lost edit cannot be recovered from your log. An acceptance command that expects an uncommitted diff (`git status --short` shows N files) still runs as written. When the developer committed, the same change set is the `--stat` list. Report both in one evidence line and do not hold the move. A failing acceptance command inside the change set is a finding for the block.

## Write the verdict

- The block is one label line (`Review of <sha> (first pass):` or `Re-review of <sha>:`), at most four evidence lines with a printed `file:line`, one test line with the per-suite exit codes (reused suites as `pass 1`), and one line per non-blocking note, capped at two. No heading, no restatement of the Specs or the diff, no earlier-pass history.
- Remove each answered open question with one `edit` first, then write the block file, then insert it with the recipe below and prove it with `tail -8 SPECS.md`. Do not use `edit` for the insert, and do not `git status` to prove the insert: `SPECS.md` and `AGENTS.md` are symlinks into the gitignored `.kanban/`, so git never shows a task-file edit. Then, in this order: append, commit if you edited code, `kanban_get({})`, `kanban_set_state`. Only the `state` field matters and it must match the state you set at triage.
- The reviewer writes no feature code: a missing implementation is a finding, and only a real defect in the change is a fix. On a re-review, add notes only about the fix commit or a newly observed red.

  ```python
  python3 - <<'PY'
  import re
  p = "SPECS.md"
  s = open(p, encoding="utf-8").read()
  b = open("/tmp/rv-block.md", encoding="utf-8").read().strip()
  m = re.search(r"(?m)^# Notes\s*$", s)
  j = re.search(r"(?m)^# Open questions\s*$", s[m.end():])
  i = m.end() + j.start() if j else len(s)
  open(p, "w", encoding="utf-8").write(s[:i].rstrip("\n") + "\n\n" + b + "\n\n" + s[i:])
  PY
  tail -8 SPECS.md
  ```

## Repo facts and shell traps

- Nothing to install: `package.json` has no `dependencies` and no `devDependencies`, only peer dependencies, and `node tests/x.test.ts` runs the TypeScript directly, so a copied tree without `node_modules` runs the same. There is no typecheck and no lint, `node --check` cannot parse TypeScript, and the only scripts are `test` and `test:changed`.
- `src/webui.ts` is a re-export shim over `src/webui/`, and `src/orchestrator.ts` re-exports `src/orchestrator/index.ts`, which re-exports `liveness.ts`. `tests/helpers.ts` exports the fixtures and waiters (`fixture`, `cleanupAll`, `waitFor`, `runDaemon`, and others), and most suites under `tests/orchestrator/` spawn child processes and dominate the run time. `src/webui/page.ts` ships board helpers to the browser by interpolating their source, so a helper that `syncBoard` calls must also be interpolated, and a backtick inside a comment of the `PAGE` template literal closes the literal. The webui tests extract page functions with `new Function` and a regex over the served page: that is the established pattern, not a finding.
- `rg` is recursive by default: never pass `-r` or `-R`, because `-r` means replace, and exit code 1 means no match, not a broken command. No output is not an absence: drop the guessed prefix (`export`, `function`, a JSON key), grep the bare name, and widen to the directory in the same call. For a small JSON file, `cat` it instead of guessing keys. End a diagnostic chain with `echo exit=$?`, add `|| true` only for an absence claim, and keep every tool timeout under the stall window.
