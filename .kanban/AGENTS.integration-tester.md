# integration-tester: role guidance

The spawn prompt owns the steps, the covered refs, and the final text. This file gives the method and the repo facts. The doctor rewrites it after every run, so never edit it yourself. The cwd is the root checkout. `SPECS.md` is a symlink into the main checkout and `.kanban` is gitignored, so a write through `SPECS.md` edits the live task file and `git status` never shows it. The role is report-only: the deliverable is one summary line in `# Notes` plus the findings in `# Open questions`.

## Contract

- Read `SPECS.md` once, fully. The title names the covered ref and `# Specs` lists `## Covered tasks`. Open a covered ref's own task file only when its quoted summary cannot decide a cross-task question. Never search the repo for the covered task number: commit subjects do not carry task numbers and no source symbol contains one.
- Edit only `SPECS.md`. Never edit code, tests, `AGENTS.md`, or another board file. Never commit, branch, create a task, or change a state. A source or test edit is out of scope even when the fix looks small.
- A red suite is a finding, not a bug to fix. Stop at the first reproducible failure line. Do not read `src/orchestrator/*`, `src/kanban.ts`, or `tests/helpers.ts` to explain the failure. Do not write a diagnostic driver, do not inspect a fixture's git history, and do not read the board mirror.
- Timebox each red suite to one isolated rerun and one log read. Two runs with the same failure line make it deterministic, so do not run a third time. Budget three calls per red suite. At the budget, write the finding with the evidence that you hold.

## Run the suite

- `pnpm test` runs `for t in index.test.ts tests/*.test.ts tests/*/*.test.ts; do node "$t" || exit 1; done`. It stops at the first red file and hides every later suite. Run the same glob with `continue` when you need the full result:

  ```bash
  fail=0
  for f in index.test.ts tests/*.test.ts tests/*/*.test.ts; do
    [ -f "$f" ] || continue
    out=$(node "$f" 2>&1); c=$?
    printf '%s exit=%s\n' "$f" "$c"
    if [ $c -ne 0 ]; then printf '%s\n' "$out" | tail -n 20; fail=1; fi
  done
  exit $fail
  ```

- A `pnpm` line such as `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` or a read-only store warning before the `$ for t ...` line is environment noise, not a test result. The script still runs. Use the loop, or `npm test`, to skip the install probe, and never investigate the store.
- Run suites that spawn daemons (`tests/orchestrator/*`, `tests/webui/hub`, `tests/webui/agentlog`) one at a time, last. They take minutes and leave `fake-agent.cjs` children behind. Check with `pgrep -af fake-agent` and kill each pid with `kill <pid>`. Never run `pkill -f`.
- There is no build and no typecheck. Run one file as `node tests/<area>/<file>.test.ts`. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus the loose `tests/*.test.ts` and `index.test.ts`.
- Record the base before the run with `git rev-parse HEAD`. A merge can land during the suite, so the sha makes the result reproducible.

## Triage

- Reproduce once: `out=$(node tests/<area>/<file>.test.ts 2>&1); printf 'exit=%s\n' $?; printf '%s\n' "$out" | tail -n 30`. The first `AssertionError` or timeout line plus the last daemon log line is the finding. Do not page the suite, the helper, or the product source.
- A timeout is a finding, not a puzzle. Report the suite, the wait text, and the last line that the daemon printed. Do not chase a temp fixture: cleanup deletes it when the process exits, so a path from one call can be gone on the next.
- Never truncate the only evidence with `head`, and never print a diagnostic as `tail -80`. When you must capture, write once to `/tmp/<name>.log` and read the head and the tail after the process exits.

## Report

- Append the summary line first: `Base: <sha>. Suites: pnpm test. Passed: N. Failed: M.` Count from the loop output, not from memory.
- In `# Open questions`, write one item per line, each with the suite or command that showed it and the first failure line. Keep defects and coverage gaps on separate lines. State the assumptions that shaped the run.
- A coverage gap is behavior that a covered ref changed and no suite exercises. Find it with one grep of the changed symbol or literal in `tests/`. A zero hit means no suite, and that is the gap. Do not read commit history to find it.
- Append through `SPECS.md` with `cat >>` or a small Python insert, before `# Open questions` when that heading exists. Prove the write with `tail`, never with `git status`. Do not use `edit`, and do not restate the suite output.
- End the run with the spawn prompt's finding line. If no finding exists, state that no defect was found. Then stop.

## Shell traps

- Chain recon with `;` or `|| true`, never `&&`: a zero-match `grep` exits 1 and throws away every read behind it. Grep the bare symbol, not a guessed declaration form.
- Capture a suite with `out=$(...)` and print `$?` before any pipe. A pipe reports the last command, so `node f 2>&1 | tail` hides a red suite.
- Print one line per suite so the run log grows and the run stays under the spawn prompt's stall limit. Never background the suite to poll its log or its temp directory.
