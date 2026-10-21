# reviewer: role guidance

The spawn prompt owns the steps, the states, the task number and the final text. This file gives the method and the repo facts. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Report a durable method change in the task's `# Notes`, never in this file or `AGENTS.md`. The doctor rewrites this file after every run.

## Open once, then decide the mode

- Run one bash call with no preamble: `rg -n '^#' SPECS.md`, `git log --oneline -6`, `git diff --stat "$b"...HEAD`, `git status --short`. Set `b` from the spawn prompt's root-checkout command, quote it, and never assume `main`.
- Read the body once, from `# Summary` to EOF, with one ranged `read` or `sed` window. Settle `# Open questions` on that read. A missing or empty section is normal. Never create that heading. Never read another task file, a skill or a role file for pipeline semantics, because the prompt owns them.
- Decide the mode after the body read, from the `# Notes` text that you just read. A reviewer block starts with `Review of` or `Re-review of`, or sits under a heading that contains `Review`. A non-empty diff with no reviewer block is a first review. With a reviewer block it is a re-review: read only that block's tail and the fix commit, and keep the first-pass evidence. An empty diff with a clean tree is verify-only: run the Specs-named suites, read the Notes claims and the dependency commits, and do not inspect branches, remotes or reflog. State the mode in one line, and do not re-decide it later.

## Read the diff once

- Use one diff call per area: `git diff "$b"...HEAD -- <paths from --stat>`. End that call with two greps: `rg -n '<changed symbol>|<new assertion text>' <changed files> <test files>`, and `rg -n '<the old value this change replaces>' src tests`. The second grep answers "who else pins this?" for the whole run. When the Specs judge a merged blocker or another commit, add `git show <sha> -- <path>` first, because it answers the claim in one command.
- Cite only a `file:line` that the printed output shows, and take a hunk from the printed line number with one window of 40 lines or less. Never page a file. One command settles one claim, so write the finding when the output answers it. Do not re-grep a log or re-read a file to confirm a green result, and do not do a second Specs-to-code pass.
- Decide a nit once, as one non-blocking `# Notes` line with an upgrade path, then close it, and never edit code for a nit, because a code edit sends the task back to to-review. When two Specs lines cannot both hold, write one non-blocking finding plus one `# Open questions` line when the choice is a product decision: state the current behavior and both options, then stop.

## Choose and run the tests

- The `## Tests` run line in the Specs is the union. Add a suite only when the diff edits that test file and the Specs do not name it. Add a caller suite only when the diff changes an exported signature or an arity, and name that caller with one rg. Write the union as one line before the run, then keep it: never widen it after a green run. For a verify-only task the union is exactly the Specs-named suites.
- Coverage map, used only when the Specs name no suite: `src/orchestrator/*` and `src/pid.ts` -> the `tests/orchestrator/` suite that asserts the changed behavior, because almost every suite there imports `poll` or `rescan`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` -> `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` -> `tests/mcp.test.ts` and `tests/tools.test.ts`, and `src/tools.ts` also to `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts` and `src/hub.ts` -> the touched `tests/webui/` suites, and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` -> `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` -> `tests/plugin.test.ts`. There is no `tests/orchestrator/liveness.test.ts`: `poll.test.ts` asserts the bounces and the cap, and `integration.test.ts` and `merge.test.ts` assert the lane ends.
- Run `node tests/<area>/<name>.test.ts`, never `pnpm test` or `npm test`, and wrap each suite in `timeout` so a hang cannot eat the pass. Chain `tests/webui/{page,board}`, `tests/webui/logpane` and `tests/kanban/{attributes,blockedby,git,naming,taskfile}` in one call. Run suites that spawn children in groups of 3 to 5, such as `tests/orchestrator/*`, `tests/webui/{hub,agentlog}` and `tests/kanban/locking`. Print `start <suite>` and `exit=<code> <suite>` for each suite in the same call, because the verdict quotes those lines. Print `MISSING <path>` for a bad path and continue. After a green run, the next action is the verdict.

## A red suite: one run, then stop

- A red run is a fact to report, not a puzzle to solve. Read the failing wait once, then classify in at most two commands: is the failing test file in the diff, and does the failure text come from an assertion that predates the diff? Write both answers down. An unrelated red is out of scope: no root-cause hunt through daemon sweeps, mirror commits, pid files or a scratch repo. Name the likely area in one non-blocking note with an upgrade path, and recommend a separate task.
- Base probe, one shell chain, only when the red file is outside the diff or the failing wait comes before the new assertions: `git stash push -- <changed paths>`, run the suite to a log, print `exit=$?`, `git stash pop`, then `git status --short`. A failure at base proves that the red predates the diff. The cap is two runs of the same red suite for the whole pass, and the base probe counts as one.
- When a suite times out before the new assertions run, the note says that the assertions are unverified, not that they pass. Recommend that the block move ahead of the slow part. Never claim a green result that no log shows, and never re-run a red suite in the hope of a green.
- Blame the environment only with a stated observation, and check it once: `pgrep -af 'fake-agent|orch-smoke'` and `uptime`. Leaked processes from another run, or a load spike, make a timing suite unreliable. Never kill a process that another task started. A probe must call the same entry point with the same input shape as production, and its assertion must match a literal that the code emits. Confirm that literal with one rg first. If a probe fails on an assumption, fix the assumption once or abandon the probe, and never iterate a third time.

## Write the verdict

- Build the block in the append call, never in a thinking turn, and do file work only in tool calls. If a tool you need is absent, load it with one `tool_search` before the next step. The block is one `Review of <sha> (first pass):` or `Re-review of <sha>:` line, at most four evidence lines with a printed `file:line` each, one test line with exit codes, and one line per non-blocking note. Add no heading, and do not restate the Specs, the diff or an earlier pass.
- Append at the end of `# Notes`, before `# Open questions` when that heading exists, and at EOF when it does not. Use this recipe, then prove it with `tail -8 SPECS.md`. Do not use `edit` and do not read the file again.

  ```python
  python3 - <<'PY'
  import re
  p = "SPECS.md"
  s = open(p, encoding="utf-8").read()
  b = """<review block>"""
  m = re.search(r"(?m)^# Notes\s*$", s)
  j = re.search(r"(?m)^# Open questions\s*$", s[m.end():])
  i = m.end() + j.start() if j else len(s)
  open(p, "w", encoding="utf-8").write(s[:i].rstrip("\n") + "\n\n" + b + "\n\n" + s[i:])
  PY
  tail -8 SPECS.md
  ```

- A red proof is owed only for behavior that this pass changes. With no source edit, cite the pass result and run nothing. With a source edit, use one call: revert the source only, run the named suite to a log, print `exit=$?`, grep the log for the failure class, restore, then `git status --short`. Commit only when you edited code.
- Keep one tail order: append the findings, commit only if you edited code, `tool_search("kanban")` once if the tools are not loaded, `kanban_get({})`, `kanban_set_state`. Only the `state` field matters, and it must match the state from the start. The final text is exactly `Moved #<nn> to <state>.` A pre-existing red never blocks the state move: say so in the note, then move the task.

## Repo facts and shell traps

- `package.json` has only `test` and `test:changed`, so there is no typecheck and no lint, and `node --check` cannot parse TypeScript. `src/webui.ts` is a re-export shim and the modules are under `src/webui/`. `src/orchestrator.ts` re-exports `src/orchestrator/index.ts`, which re-exports `liveness.ts`. `tests/helpers.ts` exports its fixtures and cleanup helpers at top level, and `cleanupAll` is idempotent. In a worktree `AGENTS.md` is a symlink to one role file, not a pipeline document.
- `.kanban/`, `SPECS.md` and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored, so `git status` and `git add` never show a task-file edit. Prove an append with `tail`, not with git.
- `rg` is recursive by default, so never pass `-r` or `-R`, because `-r` means replace. Exit code 1 means no match, not a broken command. A grep with no output is not an absence: drop the guessed prefix (`export`, `function`), grep the bare name, and widen to the directory in the same block. Read a cited `file:line` window before you doubt it. Never grep a quoted phrase from a comment, because comments wrap across lines. End a chain with `echo exit=$?`, and add `|| true` only for an absence claim.
