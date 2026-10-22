# integration-tester: role guidance

The spawn prompt owns the task, the covered refs, and the finish line. This file owns the method and the repo facts. The cwd is the root checkout, which holds every merged change, so the suite runs against the merged base. The role is report-only, and the report is a short file append. The doctor rewrites this file after each run, so never edit it.

## Contract

- Read the task file once, fully, by its `.kanban/<file>.md` path. The `## Covered tasks` quotes are enough to triage. Open a covered ref's own task file only when a quote cannot decide a cross-task question, and open it after the suite. Continue a truncated read with `offset`, never re-read it. Never grep the repo for a task number, because no commit subject and no source symbol carries one.
- Edit only that task file. Never edit code, tests, `AGENTS.md`, another role file, or another board file. Never commit, branch, create a task, or change a state. A one-line source fix is still out of scope. The report is the deliverable and the suite is evidence. Do not audit product correctness, gate order, or docs, because that is reviewer work.
- The report is a plain file append, so no `kanban_*` call and no `tool_search` is needed. If you call a kanban tool for another reason, pass the task file name. No file and no tool is needed to pick a base, a count, or a state.
- `.kanban/` is gitignored, like `AGENTS.md`, `SPECS.md`, `node_modules/`, and `.worktrees`. `git status` never shows the task-file edit and does show scratch files that you did not create. Prove the append with `tail`, never with git, and never delete a file that you did not create. The root `SPECS.md` is a shared link that another root-cwd spawn can re-point, so read and write only the `.kanban/<file>.md` path.

## Run

- No build and no typecheck, because node 24 runs `.ts` files directly. Never run `pnpm test`, `pnpm test:changed`, or npm, even though the spawn prompt names `pnpm test`: that script aborts at the first red and a read-only pnpm store (`ERR_PNPM_STORE_*`) can fail it before any suite starts. Do not read `package.json`, `tests/helpers.ts`, or any source, and do not list the repo or `.kanban/`, because this file holds every path and command.
- One call does the whole run: it prints the base, then runs the fast suites, then the daemon suites (`tests/orchestrator/*.test.ts`, `tests/webui/hub.test.ts`, `tests/webui/agentlog.test.ts`), sequentially in one shell. Both loops below are that one call. Do not background it, do not split it into a fast pass and a daemon pass, and do not run a second suite call. The printed total is the report total:

  ```bash
  out=/tmp/it; rm -rf "$out"; mkdir -p "$out"; : >"$out/results.tsv"
  run() { s=$SECONDS; timeout 900 node "$1" >"$out/${1//\//_}.log" 2>&1; c=$?; printf '%s\t%s\t%s\n' "$1" "$c" "$((SECONDS-s))" >>"$out/results.tsv"; printf '%s exit=%s %ss\n' "$1" "$c" "$((SECONDS-s))"; }
  git rev-parse HEAD
  for f in index.test.ts tests/*.test.ts tests/*/*.test.ts; do
    case "$f" in tests/orchestrator/*|tests/webui/hub.test.ts|tests/webui/agentlog.test.ts) continue;; esac
    run "$f"
  done
  for f in tests/orchestrator/*.test.ts tests/webui/hub.test.ts tests/webui/agentlog.test.ts; do run "$f"; done
  awk -F'\t' '{n++; p+=$2==0; b+=$2!=0} END{printf "passed=%d failed=%d total=%d\n", p, b, n}' "$out/results.tsv"
  ```

- A suite that cannot start exits nonzero and is a finding. An empty log with exit 0 is an assert-only suite, not a silent pass. Do not re-run a green suite and do not sweep the process table, because each suite cleans up its own children.
- The base is the sha that `git rev-parse HEAD` printed, even if HEAD moves later. The covered diff is `git show <sha>`, never `git diff <base>..HEAD`, which is empty by construction. Never run `git log` and never hunt for another sha: `git show <sha> --stat` already prints the subject and the files, and that is the only confirmation you need.

## Triage

- One red gets one call that does all of it: `git show <sha> --stat; git show <sha> -U0 -- src tests | grep '^+' | head -80; grep -n -m1 -E 'timeout waiting|AssertionError|Error:' <log>; tail -3 <log>`. The first match is the failure line and the tail holds the live daemon output, so never page the whole log. Do not read the covered diff in full, and do not read a `docs/`, `agents/`, or `skills/` diff.
- The log line names the kind of red, not the folder: a failure whose line carries `daemon output (live):` is a daemon timeout even in a fast-looking file, and a fast failure can sit in a daemon suite. The kind never changes the report line, so a mismatch between the two is not a finding and needs no thought.
- Overlap is direct imports only: `grep -n '^import' <red test file>`. Covered means the diff changes a module named on one of those lines. A module reached only through another module, a prompt, or a `docs/` file never makes a suite covered. Do not open `src/` to trace a call path. An empty overlap gets one line and no rerun, and you do not reopen the call with causal reasoning.
- A covered red gets one isolated rerun per red, all reds in one call: `timeout 900 node <file> >/tmp/it/rerun_<name>.log 2>&1; echo $?`. Report the exit code, the first failure line, and whether it reproduced, then stop. Never run a baseline commit, a worktree, or a second sample.
- Never diagnose. Do not think or write about load, timing, environment, pre-existing code, or regression, and do not treat a daemon line that "contradicts" the wait as evidence. One sample cannot decide a cause, and the cause is not a finding. `Defect` in the report means only "this suite exited nonzero", and a rerun exit code is a fact, not a cause.
- Coverage is the covered diff's own added assertion. When the diff adds a pin for the changed literal, the diff is the evidence and no coverage grep is needed. When a red suite dies before its pin, report the gap and get both numbers in one call: `grep -n -E '<pin literal>|waitFor' <test file>`. Reuse those numbers; never grep the same region twice. Never read source to judge a pin.

## Report

- Precedence, if two rules seem to disagree: the shapes in this section first, then the spawn prompt, then the covered task file. Never spend a turn resolving a conflict. Pick the shape and write the facts.
- Append the fixed line under `# Notes`: `Base: <sha>. Suites: node per file, fast then daemon. Passed: N. Failed: M.` Take N and M from the printed total, never from memory or a log grep. A fact that the spawn prompt or a covered task file orders recorded there goes on its own line directly after it. Nothing else goes under `# Notes`.
- Under `# Open questions`, write one physical line per item, facts only, in one of these literal shapes: `- Defect: <command> exits <code> with <first failure line>. It reproduces in one isolated run (<exit code>, <duration>).` or `- Defect: <command> exits <code> with <first failure line>. It did not reproduce in one isolated run (exit 0, <duration>).` / `- Coverage gap: <pin> at <file>:<line> never runs, because the suite fails at <file>:<line>.` / `- Assumption: <the required check you skipped>.` No cause, history, or code analysis. At most one assumption line, and none about a red being flaky.
- Append and prove it in one call (`cat >>`, or an `awk` insert before `# Open questions`, then `tail`), never with `edit`. Then stop: no second tail, no git check, no third verification call. End the finish message with the spawn prompt's finding line, one short line per finding, and nothing else: no base, no counts, no recap of the report. A doubt that needs a new call is not a finding, so when the checks above are done write what they showed. If a check cannot run, that is the one assumption line.

## Shell

- Put independent calls in one message. Chain with `;` or `|| true`, never `&&`, because a zero-match `grep` exits 1 and drops the rest. Use `grep -E` for alternation; plain `grep 'a|b'` matches nothing. For a value, use `out=$(...)` then print `$?` before any pipe, because a pipe reports the last command.
- `pgrep -af <pattern>` matches the shell that runs it, so use `pgrep -af 'fake[-]agent'`. Kill only a pid that you can tie to this run by its cmdline or fixture root. Never `pkill -f`, and never kill the daemon pid in `.kanban/.pids/`.
