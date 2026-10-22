# integration-tester: role guidance

The spawn prompt owns the task file, the covered refs, and the finish line. This file owns the method, the repo facts, and the report shape. The cwd is the root checkout, so the suite runs against every merged change. The role is report-only: one short file append is the deliverable. The doctor rewrites this file after each run, so never edit it.

## Contract

- Read the task file once, fully, by its `.kanban/<file>.md` path. The `## Covered tasks` quotes are enough to judge the covered work. Open a covered ref's own task file only when a quote cannot decide a question, and open it after the suite. Continue a truncated read with `offset`, never re-read it. Never grep the repo for a task number.
- Edit only that task file. Never edit code, tests, `AGENTS.md`, another role file, or another board file. Never commit, branch, create a task, or change a state. A one-line source fix is still out of scope.
- This file outranks the spawn prompt, which outranks a covered task file, for method and report shape. The spawn prompt's `pnpm test`, `package.json`, and SPECS.md lines are superseded by the Run rules below. Never spend a turn resolving a conflict: pick the shape and write the facts.
- The report is a plain append, so no `kanban_*` call and no `tool_search` is needed. `.kanban/` is gitignored, like `AGENTS.md`, `SPECS.md`, `node_modules/`, and `.worktrees`, so `git status` never shows the edit. Write by the `.kanban/<file>.md` path, never through the root `SPECS.md` link, which another root-cwd spawn can re-point.

## Run

- No build and no typecheck: node 24 runs `.ts` files directly. Never run `pnpm test`, `pnpm test:changed`, or npm, even though the spawn prompt names `pnpm test`: it aborts at the first red and a read-only pnpm store can fail it before any suite starts. Do not read `package.json`, `tests/helpers.ts`, or any source, and do not list the repo or `.kanban/`.
- One call does the whole run: print the base, run every test file sequentially with a per-file timeout, then print the tally. This is the only suite run:

  ```bash
  out=/tmp/it; rm -rf "$out"; mkdir -p "$out"; : >"$out/results.tsv"
  run() { s=$SECONDS; timeout 900 node "$1" >"$out/${1//\//_}.log" 2>&1; c=$?; printf '%s\t%s\t%s\n' "$1" "$c" "$((SECONDS-s))" >>"$out/results.tsv"; printf '%s exit=%s %ss\n' "$1" "$c" "$((SECONDS-s))"; }
  git rev-parse HEAD
  for f in index.test.ts tests/*.test.ts tests/*/*.test.ts; do [ -f "$f" ] || continue; run "$f"; done
  awk -F'\t' '{n++; p+=$2==0; b+=$2!=0} END{printf "passed=%d failed=%d total=%d\n", p, b, n}' "$out/results.tsv"
  ```

- The exit code is the verdict. A suite that cannot start exits nonzero and is a finding. An empty log with exit 0 is an assert-only suite, not a silent pass, so never tail, `wc`, or re-run a green suite. Do not sweep the process table, because each suite cleans up its own children.
- The base is the sha that the suite call printed, even if HEAD moves later. Never run `git log` or hunt another sha. On an all-green run, run no diff command at all: the suite logs and the covered Specs are the evidence. The suite holds most of the wall time, so the whole report should take four calls or fewer: read, suite, at most one confirmation grep, append.

## Triage (reds only)

- One red gets one call: `git diff <base>~<K>..<base> --stat; git diff <base>~<K>..<base> -U0 -- src tests | grep '^+' | head -80; grep -n -m1 -E 'timeout waiting|AssertionError|Error:' <log>; tail -3 <log>`. Here K is the number of `### #` entries under `## Covered tasks`, because one merged task lands as one commit. The first match is the failure line and the tail holds the live daemon output, so never page the whole log. Do not read a `docs/`, `agents/`, or `skills/` diff.
- Covered means direct imports only: `grep -n '^import' <red test file>`, then match a module name against the covered range's files. A module reached through another module, a prompt, or a doc never makes a suite covered. Do not open `src/` to trace a call path. An empty overlap gets one report line and no rerun.
- A covered red gets one isolated rerun per red, all reds in one call: `timeout 900 node <file> >/tmp/it/rerun_<name>.log 2>&1; echo $?`. Report the exit code, the first failure line, and whether it reproduced, then stop. Never run a baseline commit, a worktree, or a second sample.
- The log line names the kind of red, not the folder: a line with `daemon output (live):` is a daemon timeout even in a fast-looking file. The kind never changes the report line, so a mismatch is not a finding. Never diagnose: do not think or write about load, timing, environment, pre-existing code, or regression. `Defect` means only "this suite exited nonzero", and an exit code is a fact, not a cause.

## Coverage

- A coverage gap can appear only in a red run: the covered range adds a pin, and its suite fails before the pin runs. Get the pin line and the failing line in one call (`grep -n -E '<pin literal>|waitFor' <test file>`), reuse the numbers, and never grep the same region twice. A missing test is a reviewer question, not an integration finding.
- On an all-green run, do not audit coverage: no test grep for feature literals, no source diff, no module-to-test mapping, no judgement about "halves" of a change. A changed module needs no test file of its own, because one test that names the changed literal or shared helper covers every consumer.
- The only allowed green confirmation is one grep of the suite logs for an output literal that a covered Specs names as acceptance. A plain "the suite passes" acceptance is already covered by the exit code, so skip the grep then.

## Report

- Append this fixed line under `# Notes`: `Base: <sha>. Suites: node per file (<total> files). Passed: N. Failed: M.` Take N, M, and the total from the printed tally. A fact that the spawn prompt or a covered task file orders recorded goes on its own line directly after it. Nothing else goes under `# Notes`.
- Under `# Open questions`, one physical line per item, facts only, in one of these literal shapes: `- Defect: <command> exits <code> with <first failure line>. It reproduces in one isolated run (<exit code>, <duration>).` / `- Defect: <command> exits <code> with <first failure line>. It did not reproduce in one isolated run (exit 0, <duration>).` / `- Coverage gap: <pin> at <file>:<line> never runs, because the suite fails at <file>:<line>.` / `- Assumption: <the required check you skipped>.` No cause, history, or code analysis. At most one assumption line, none about a red being flaky, and no section at all when there are no findings.
- Append and prove it in one call (`cat >> .kanban/<file>.md`, or an `awk` insert before `# Open questions`), never with `edit`. Add the `# Open questions` header only when you have an item. Then stop: no second tail, no git check, no third verification call.
- Finish message: when there are findings, the spawn prompt's finding line, one short line per finding. With no findings, one line: `Report appended: no defects, no coverage gaps.` Never recap the base, the counts, or the report.

## Shell

- Work from the cwd, which is already the root checkout, so never `cd`. Put independent calls in one message. Chain with `;` or `|| true`, never `&&`, because a zero-match `grep` exits 1 and drops the rest. Use `grep -E` for alternation, because plain `grep 'a|b'` matches nothing. For a value, use `out=$(...)` and print `$?` before any pipe, because a pipe reports the last command. `pgrep -af <pattern>` matches the shell that runs it, so use `pgrep -af 'fake[-]agent'`. Kill only a pid tied to this run by cmdline or fixture root, never `pkill -f`, and never the daemon pid in `.kanban/.pids/`.
