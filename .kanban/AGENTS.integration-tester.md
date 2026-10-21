# integration-tester: role guidance

The spawn prompt owns the steps, the covered refs, and the final text. This file gives the method and the repo facts. The doctor rewrites this file after each run, so never edit it. The cwd is the root checkout. `SPECS.md` is a symlink into the main checkout, and `.kanban/` is gitignored. A write through `SPECS.md` therefore edits the live task file, and `git status` never shows it. The role is report-only: one summary line under `# Notes`, the findings under `# Open questions`.

## Contract

- Read `SPECS.md` once, fully. The title names the covered ref, and `## Covered tasks` lists them. Open a covered ref's own task file only when the quoted summary cannot decide a cross-task question. Never search the repo for a task number, because no commit subject and no source symbol carries one.
- Edit only `SPECS.md`. Never edit code, tests, `AGENTS.md`, or another board file. Never commit, branch, create a task, or change a state. A small source fix is still out of scope.
- A red suite is a finding. Do not fix it, and do not explain it from the source. Spend one isolated rerun and one log read on it, then write the finding.
- Grep `src/` and `tests/` for literals. Do not page a suite, a helper, or a product module to explain a failure. Do not inspect a fixture's git history, and do not open the task file of an uncovered ref.

## Run

- There is no build and no typecheck. Run one file as `node tests/<area>/<file>.test.ts`. The set is `index.test.ts`, `tests/*.test.ts`, and `tests/*/*.test.ts`. The areas are `tests/kanban`, `tests/orchestrator`, `tests/webui`, and `tests/efficiency-analysis`. `pnpm test:changed` maps a diff to tests, so it does not serve a run against a fixed base.
- `pnpm test` stops at the first red file and hides every later suite. Do not use it to learn the full result. Use it at most once, as a cross-check of a result that you already hold.
- Split the run into two passes. Pass 1 is every file outside `tests/orchestrator`, `tests/webui/hub`, and `tests/webui/agentlog`. Pass 2 runs those slow, daemon-spawning suites one at a time, last, each under `timeout 900`.
- Run this recipe once per pass with a fresh log dir. It keeps one exit code per file, keeps the output, prints a line so the run log grows, and does not stop on red:

  ```bash
  sha=$(git rev-parse HEAD); log=/tmp/it-run; mkdir -p "$log"; fail=0
  for f in index.test.ts tests/*.test.ts tests/*/*.test.ts; do
    [ -f "$f" ] || continue
    node "$f" >"$log/${f//\//_}.log" 2>&1; c=$?
    printf '%s exit=%s\n' "$f" "$c"
    if [ $c -ne 0 ]; then fail=1; fi
  done
  printf 'sha=%s fail=%s logs=%s\n' "$sha" "$fail" "$log"
  ```

  Use `timeout 900 node "$f"` for pass 2, and skip the pass 1 paths there.
- Record the base with `git rev-parse HEAD` before the run. A merge can land during the suite, and the sha makes the result reproducible.
- A `pnpm` line such as `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` before the `$ for t` line is store noise, not a test result. Do not investigate the store.

## Triage

- The first `AssertionError` or timeout line, plus the last line that the daemon printed, is the finding. A timeout is a finding, not a puzzle. Report the suite, the wait text, and the last daemon line, then stop. Do not chase a temp fixture, because cleanup deletes it when the process exits.
- A red that names a wait text or a symbol outside the covered diffs is a pre-existing red, not your finding. Write one line, then continue the run with the next suite.
- Never truncate the only copy of a failure with `head` or `tail -80`. Write once to the log dir, and read the head and the tail after the process exits.

## Coverage

- A coverage gap is behavior that a covered ref changed and no suite pins. One grep of the changed literal in `tests/` decides it, and zero hits means the gap. Do not read commit history for it. If a suite fails before its assertion, that pin never ran, so report it as a gap and name the red that blocks it.

## Report

- Append the summary line first: `Base: <sha>. Suites: <command>. Passed: N. Failed: M.` Count from the runner output, not from memory.
- In `# Open questions`, write one item per line. Give the suite or command and the first failure line. Keep defects, gaps, and assumptions on separate lines.
- Write the report before the last third of the budget. The report is the deliverable, and the run is only evidence.
- Write through `SPECS.md` with `cat >>` or a small Python insert, before `# Open questions` when that heading exists. Prove the write with `tail`, do not use `edit`, and do not restate the suite output. End with the spawn prompt's finding line, or state that no defect was found, then stop.

## Shell

- Chain recon with `;` or `|| true`, never `&&`. A zero-match `grep` exits 1 and drops every command behind it. Capture with `out=$(...)` and print `$?` before any pipe, because a pipe reports the last command.
- `pgrep -af <pattern>` matches the shell that runs it. Use `pgrep -af 'fake[-]agent'` to skip the self-match. Kill fixture children by pid with `kill <pid>`, never `pkill -f`, and clean them after each slow suite instead of once at the end.
