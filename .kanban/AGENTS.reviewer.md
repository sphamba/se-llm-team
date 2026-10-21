# reviewer: role guidance

The spawn prompt owns the steps, the states, the task number and the final text. This file owns the method and the repo facts. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. The doctor rewrites this file after every run, so report a durable method change in the task's `# Notes`, never here.

## Settle the pass once

- Triage probe, one bash call in parallel with one `tool_search` for `kanban_get` and `kanban_set_state`: `rg -n '^#' SPECS.md`, `git log --oneline -6`, `git rev-parse --short HEAD`, `git -C <root> branch --show-current`, `git diff --stat <base>...HEAD`, `git status --short`, and `: > /tmp/rv-block.md`. Quote the base that the root command printed. These facts are the pass: never re-derive them with more `git log`, `git status`, `git branch`, `git rev-parse` or reflog calls, not even to confirm an empty diff.
- Set the mode and the state from those facts in one decision, and never reopen either. A committed diff is a review. A `Review of` or `Re-review of` heading makes it a re-review. An empty committed diff with a clean tree is verify-only. An empty committed diff with a dirty tree is work-missing: report the shas, the dirty paths, the absent symbol and the red suites, recommend a rebase onto the base that keeps the uncommitted tests, write no feature work, and move to to-do. The state follows `# Acceptance criteria` alone: met with no code edit is to-merge, not met is to-do, a fix you committed is to-review. A red outside the change set, a gate another role owns and a blocker that never landed are notes, never a reason to hold the move.
- Read the body once, `# Summary` to EOF, with one ranged `read` or `sed -n '1,300p'`. A missing or empty `# Open questions` is normal and you never create that heading. Delete a question that the code, the docs or a search answers, on sight and without deliberation. An assumption the developer voiced in `# Notes` is never a finding.
- Keep `/tmp/rv-block.md` as the only place where the review block grows: write its label line at triage, then append each evidence, test and note line in the same call that printed the answer. Never compose the block in a thinking turn and never rewrite it at the tail, because the tail call only inserts the finished file.
- A `blockedBy` line, a dependency or a `done` card that the base lacks is out of scope. Confirm the missing symbol once with `rg -n '<symbol>' src tests`, write one non-blocking note that names the owning card, and stop. Do not read another task file, the board, a skill or a role file. Never claim a tool is missing without a failed call, and quote the error text if one fails.

## Survey and cite

- One diff call per area from the `--stat`: `git diff <base>...HEAD -- <paths>`, plus `git show <sha> -- <path>` when the Specs judge a commit. End that call with two greps: the changed symbol or assertion text in the changed and test files, and the class, field or value that the change touches across `src tests` with every writer that can undo it (`classList.remove`, a reset, a default). The second grep answers "who else rewrites this?" for the whole pass. When the committed diff is empty the change set is the tree: `git status --short`, then `git diff -- <path>` per path, never `git diff | head -N`, because the cut drops the hunks you must cite.
- Cite only a `file:line` that the printed output shows, and take the hunk from that number in one window of 40 lines or less. Specs anchors drift, so find code by symbol with one `rg -n 'function <name>|const <name>' src` and cite what the grep printed. One command settles one claim: write the verdict line as soon as the output answers it, then stop reading that area and never take a second Specs-to-code pass.
- A structural, CSS or template-string claim gets one geometry or literal-safety sentence, nothing more. A nit is one non-blocking line with an upgrade path, chosen before you check how common the pattern is, capped at two, and never a code edit. There is no lint, no formatter and no line-length limit, so a style, formatting, accessibility or precedent scan cannot change the move: skip it.

## Run the suites

- Fix the set before the run as a union: every suite that reads a path in the change set, then the Specs `## Tests` suites, then nothing. On a re-review, reuse a prior green when the fix commit touched no file that suite covers, and print `pass 1` as its exit code. A docs-only fix that no test reads needs no suite: the code comparison plus the `rg` that proves the stale claim is gone is the evidence.
- Coverage map, used only when the Specs name no suite: `src/orchestrator/*` and `src/pid.ts` -> the `tests/orchestrator/` suite that asserts the changed behavior, since nearly all of them import `poll` or `rescan`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` -> `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` -> `tests/mcp.test.ts` and `tests/tools.test.ts`, and `src/tools.ts` also to `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts` and `src/hub.ts` -> the touched `tests/webui/` suites, and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` -> `tests/kanban/` plus `tests/tools.test.ts`. `skills/se-llm-team/SKILL.md` -> `tests/plugin.test.ts`, which reads only its frontmatter. `agents/doctor.md` -> `tests/efficiency-analysis/doctor.test.ts`, and `tests/orchestrator/config.test.ts` renders it. Other `agents/*.md` files are not pinned, so grep before you add a suite. Suite names do not always match the module.
- Run `node tests/<area>/<name>.test.ts`, never `pnpm test`, as `timeout 300 node tests/x.test.ts > /tmp/rv-x.log 2>&1; echo "exit=$? x"`. Never pipe before the capture, because `echo $?` then reports the last command of the pipe. Print `start <suite>` and `exit=<code> <suite>` for each suite in the same call, and `MISSING <path>` for a bad path, then continue. Chain the cheap suites and run the child-spawning ones in groups of 3 to 5. `exit=0` is a pass even with a 0-byte log: never re-run a green suite or `wc -c` its log. `scripts/test-changed.mjs` stops at the first red and falls back to every suite for an unmapped path, so use it as a probe only.

## A red suite: one probe, then stop

- A red run is a fact to report, not a puzzle. Grep the log once with `rg -n 'AssertionError|Error:|timeout waiting|failed|expected' /tmp/rv-x.log | head -5`, because a wait that times out prints `timeout waiting ...` and no `Error:` prefix. Never hunt the failing line when the red is outside the change set.
- Classify in at most two commands: is the red file in the change set, and does the change set touch the code that file imports? If neither the red file nor its imported `src` paths changed, the red predates the change by definition: no base probe, one non-blocking note that names the owning area, then stop. Probe the base only when the red file is in the change set. A committed fix leaves a clean tree and `git stash` does nothing, so `git checkout <base> -- <paths>`, run, print `exit=$?`, `git checkout HEAD -- <paths>`, `git status --short`. For an uncommitted fix, save `git diff -- <paths> > /tmp/rv-fix.patch` first and re-apply it with `git apply` after.
- Two runs of the same red suite is the cap and the base probe counts as one. A suite that times out before the new assertions is unverified, not passing: say so, recommend moving the new block ahead of the slow part, and never claim a green that no log shows. Blame the environment only with one checked observation (`pgrep -af 'fake-agent|orch-smoke'`, `uptime`), never kill a process another task started, and drop a probe whose assumption proves false.

## Write the verdict

- The block is one label line (`Review of <sha> (first pass):` or `Re-review of <sha>:`), at most four evidence lines with a printed `file:line`, one test line with per-suite exit codes, and one line per non-blocking note. No heading, no restatement of the Specs or the diff, no earlier-pass history. The reviewer writes no feature code: a missing implementation is a finding, and only a real defect in the change is a fix. On a re-review, add notes only about the fix commit or a newly observed red. Emit no prose between calls: the only text the run returns is the final line.
- Insert the file with this recipe, then prove it with `tail -8 SPECS.md`. Do not use `edit`, do not re-read the task file, and do not `git status` to prove the insert, because the task file is gitignored. Then, in this order: append, commit if you edited code, `kanban_get({})`, `kanban_set_state`. Only the `state` field matters and it must match the state you set at triage. The final text is exactly `Moved #<nn> to <state>.`, with no table and no summary.

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

- `package.json` has only `test` and `test:changed`: there is no typecheck, no lint, and `node --check` cannot parse TypeScript. `test` loops over `index.test.ts`, `tests/*.test.ts` and `tests/*/*.test.ts`. `src/webui.ts` is a re-export shim over `src/webui/`. `src/orchestrator.ts` re-exports `src/orchestrator/index.ts`, which re-exports `liveness.ts`. `tests/helpers.ts` exports `fixture`, `waitFor`, `waitForAsync`, `mirrorSubjects`, `showTip` and an idempotent `cleanupAll` at top level. Most suites under `tests/orchestrator/` spawn child processes and dominate the run time.
- `src/webui/page.ts` ships board helpers to the browser by interpolating their source, so a helper that `syncBoard` calls must also be interpolated, and a backtick inside a comment of the `PAGE` template literal closes the literal. The webui tests extract page functions with `new Function` and a regex over the served page: that is the established pattern, not a finding.
- In a worktree, `AGENTS.md` is a symlink to one role file and `SPECS.md` to one task file. Both resolve through `.kanban/` into the main checkout, and `.kanban/` is gitignored, so `git status` and `git add` never show a task-file edit.
- `rg` is recursive by default: never pass `-r` or `-R`, because `-r` means replace, and exit code 1 means no match, not a broken command. No output is not an absence: drop the guessed prefix (`export`, `function`), grep the bare name, and widen to the directory in the same call. `git rev-parse --short` takes one revision, so `git rev-parse --short HEAD main` fails and an `&&` chain skips the rest. End a diagnostic chain with `echo exit=$?`, add `|| true` only for an absence claim, and keep every tool timeout under the stall window.
