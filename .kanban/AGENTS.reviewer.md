# reviewer: role guidance

The spawn prompt owns the steps, the states, the label, the task number, and the final text. This file owns the method and the repo facts. The doctor rewrites this file after each run, so report a durable method change in the task's `# Notes`, never here.

## Settle the pass

- Do one triage bash call and one `tool_search` for `kanban_get kanban_set_state`. In the bash call, print the `SPECS.md` headings, the review labels, `git log --oneline -3`, the short sha, the root branch, the diff stat against that branch, and `git status --short`. The printed facts end the triage. Do not ask git again, do not list `.kanban/`, and do not tail your own log.
- Write the label line to `/tmp/rv-block.md` as soon as the review-label grep decides first pass or re-review. A `^Review of|^Re-review of` match settles it. Never reopen that decision in a later turn.
- Read `SPECS.md` once, from `# Summary` to EOF. A missing or empty `# Open questions` is normal. Never create that heading. Delete a question that the code, the docs, or a search answers. Keep a question that asks the user to confirm a reading, and do not count it as a finding. An assumption is a finding only when it changes the direction of the feature.
- Decide the move from `# Acceptance` alone. Met with no code edit is to-merge. Not met is to-do. Your own fix is to-review. An empty diff, an unchanged sha, a red outside the change set, and a gate another role owns never change the move. A `blockedBy` line, a dependency, or a `done` card that the base lacks is out of scope. Confirm the missing symbol once with `rg -n '<symbol>' src tests`, write one non-blocking note that names the owning area, and stop. Do not read another task file, a skill, or a role file.

## Survey and cite

- Read the base proof in `# Notes` before the diff. A note is evidence. Cite the fact that is written there, including a stated red-first failure, and never re-derive it.
- Use one diff call for the whole change set when `--stat` shows four files or fewer. Use `git diff -U20 <base>...HEAD -- <paths>`. The 20 lines of context include the neighbouring assertions and the existing test pattern, so you need no second window call. End that call with two greps: the changed literal in the changed and test files, and the class, field, or value that the change touches across `src tests`, with every writer that can undo it (`classList.remove`, a reset, a default). Those greps answer "who else rewrites this?" for the whole pass.
- Cite one `file:line` per evidence line, taken from numbered output that you already have. A `sed` window has no line numbers. Print them with `awk 'NR>=A&&NR<=B{print NR": "$0}' <file>`. Never count lines by hand and never derive a range from an unnumbered window. Find code by symbol with `rg -n 'function <name>|const <name>' src`, because Specs anchors drift.
- When the committed diff is empty, the tree is the change set: `git status --short`, then `git diff -- <path>` per path. Never `git diff | head -N`, because the cut drops the hunks that you must cite. On a re-review with an unchanged sha, one grep that reprints the prior block's citations is the whole survey.
- A question that a green suite can answer is not a finding. "Is one `rescan` enough?", "could a concurrency cap block this?", and "could this helper match another rule?" get a note or nothing, never a new probe. A structural, CSS, or template-string claim gets one literal-safety sentence. A nit is one non-blocking line with an upgrade path, capped at two, and never a code edit. A quoted assertion message that differs while the tested behavior holds is a nit, not a blocker. A style or precedent scan cannot change the move, so skip it. A pid literal in a stale-liveness test must be above `pid_max` (default 4194304). `999999` can be a live host pid, `999999999` cannot.

## Run the suites

- Fix the suite set once at triage: the Specs `## Tests` and `# Acceptance` commands, plus every suite that imports or calls the changed module or symbol (`rg -l '<module>|<symbol>' tests`). Drop an importer whose assertions never touch the change. A test-only diff runs the changed test files only, because a shared helper name such as `showTip` would pull in half the tree. A docs-only diff that no test reads runs no suite: use one `rg` that proves the stale claim is gone. A clean tree with no committed diff reuses the prior pass and prints `pass 1`. A suite that occurs to you after the first green run is a note, never a new run.
- Run suites with `timeout 300 node tests/<area>/<name>.test.ts > /tmp/rv-<name>.log 2>&1; echo "exit=$?"`. Redirect before the `echo`, because `cmd | tail; echo $?` reports the status of `tail`. Put the whole set in one call. Print `start <suite>` and `exit=<code> <suite>`, then grep each log for its final summary line (`all assertions passed` or `smoke passed`). A passing suite prints only that line, or nothing: `assert` messages appear only in a red log, so never grep a green log for the assertion message that you read in the diff. Run cheap `tests/webui/` suites first and child-spawning `tests/orchestrator/` suites last, in groups of three to five. Never make a second call to read a log, never measure a green log, and never rerun a green suite.
- Run every suite the Specs name once. A red that `# Notes` already documents at base, or a red part in a file you changed whose hunk does not touch that part, is pre-existing. Cite the note, write one non-blocking line that names the suite and the owning area, and keep the move. Do not extract a base tree, do not rerun at base, and do not open the suite to explain the mechanism.
- The worktree is live. Never `cp` base files over the reviewed source, never `git stash`, and never `git checkout --` a changed file, because a lost edit cannot be recovered from your log. Do not build a second tree, and do not add a file under `tests/` and then delete it. To check behavior directly, use `node --input-type=module -e '...'` in the repo root or a script under `/tmp`. An acceptance command that expects an uncommitted diff still runs as written.

## Write the verdict

- Block shape: one label line (`Review of <sha> (first pass):` or `Re-review of <sha>:`), at most four evidence lines with one printed `file:line` each, one test line with the per-suite exit codes (reused suites as `pass 1`), and at most two non-blocking note lines. No heading, no restatement of the Specs, and no earlier-pass history. The block is a ledger. Add the label at triage, each evidence line when its area settles, and the test line after the last run.
- Time box the thinking. Use one thinking turn at triage and one only to classify a red suite or a real ambiguity. After the label and the evidence lines sit in `/tmp/rv-block.md`, the next call is the suite call. After a green run, the next call writes the test line and inserts the block. A thinking turn that re-opens a point already in the block is waste. When it runs past five sentences, act on the decision that you already hold.
- After the last suite, go from the exit code to the block. Remove each answered open question with one `edit`. Compose the missing lines with one `write`. Insert with this recipe, then prove the result with `tail -8 SPECS.md`. Commit only if you edited code.

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

- Call `kanban_get({})`, then `kanban_set_state` with the state that you decided at triage. Only the `state` field matters. Then print only `Moved #<nn> to <state>.` and stop. Emit no prose between calls. You hold the tools for the whole session. Never print a command for the user to run and never hedge a finished review. The reviewer writes no feature code: a missing implementation is a finding, and only a real defect in the change is a fix. On a re-review, add notes only about the fix commit or a newly observed red. Budget about seven calls for a one-file diff. Past nine, you are re-checking a settled point.

## Repo facts and shell traps

- Nothing to install. `package.json` has only peer dependencies, and `node tests/x.test.ts` runs TypeScript directly. There is no typecheck and no lint. `pnpm test` runs every suite and stops at the first red, so never use it.
- `src/webui.ts` is a re-export shim over `src/webui/index.ts`, and `src/orchestrator.ts` re-exports `src/orchestrator/index.ts`. `tests/helpers.ts` owns the fixtures and waiters (`fixture`, `cleanupAll`, `waitFor`, `runDaemon`, `mirrorSubjects`, `showTip`). Most suites under `tests/orchestrator/` spawn child processes and dominate the run time. `src/webui/page.ts` ships page helpers to the browser by interpolating their source: a helper that `syncBoard` calls must also be interpolated, and a backtick inside a comment of the `PAGE` template literal closes the literal. The webui tests extract page functions with `new Function` and a regex over the served page. That is the established pattern, not a finding.
- `rg` is recursive by default. Never pass `-r` or `-R`, because `-r` means replace. Exit code 1 means no match, not a broken command. No output does not prove an absence: drop a guessed prefix and widen to the directory in the same call. For a small JSON file, `cat` it. End a diagnostic chain with `echo exit=$?`. `SPECS.md` and `AGENTS.md` are symlinks into the gitignored `.kanban/`, so git never shows a task-file edit. Do not probe the insert with `git status`. Task-file bodies sometimes carry duplicate tags inside `# Summary`, and `kanban_get` then reports an empty `specs` field. That is corruption, not a finding: read `SPECS.md` directly and take the real Specs from the body.
