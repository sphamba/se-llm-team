# integration-tester: role guidance

The spawn prompt owns the steps, the covered refs, and the finish line. This file owns the method and the repo facts. The cwd is the root checkout, which holds every merged change, so the suite runs against the whole merged base. The role is report-only. The doctor rewrites this file after each run, so never edit it.

## Contract

- Read the task file once, fully, by its `.kanban/<file>.md` path. The title names the covered refs and `## Covered tasks` quotes their summaries. Continue a truncated read with `offset`, never re-read it. Open a covered ref's own task file only when its quote cannot decide a cross-task question. Never grep the repo for a task number, because no commit subject and no source symbol carries one.
- Edit only that task file. Never edit code, tests, `AGENTS.md`, another role file, or another board file. Never commit, branch, create a task, or change a state. A one-line source fix is still out of scope. The report is the deliverable and the suite is evidence. Decide each point once and put the tool call in the same message. Do not audit product correctness, gate order, or docs, because that is reviewer work.
- `.kanban/` is gitignored, like `AGENTS.md`, `SPECS.md`, `node_modules/`, and `.worktrees`. `git status` never shows the task-file edit and does show scratch files that you did not create. Prove the append with `tail`, never with git, and never delete a file that you did not create.
- The root `SPECS.md` is a shared link that another root-cwd spawn can re-point. Read and write the task file by its `.kanban/<file>.md` path, and pass that file name to every `kanban_*` call.

## Run

- Record `git rev-parse HEAD` once, because that merge commit is the base for the report. No build and no typecheck, because node 24 runs `.ts` files directly. Never run `pnpm test`, `pnpm test:changed`, or npm: the script aborts at the first red, and a read-only pnpm store (`ERR_PNPM_STORE_*`) can fail the run before any suite starts, so its exit code is not evidence. Do not read `package.json`, because this file holds the recipe.
- The suite set is `index.test.ts`, `tests/*.test.ts`, and `tests/*/*.test.ts`. Run it in two passes, one call each. Pass 1 skips `tests/orchestrator/*`, `tests/webui/hub.test.ts`, and `tests/webui/agentlog.test.ts`. Pass 2 runs only those, because they spawn daemons and fake agents and are the slow part. Pass 1 runs no daemon suite, so it is much faster. Do not reorder it or rerun it. Do not split a pass into batches.
- Runner (pass 1):

  ```bash
  out=/tmp/it; rm -rf "$out"; mkdir -p "$out"; : >"$out/results.tsv"
  for f in index.test.ts tests/*.test.ts tests/*/*.test.ts; do
    case "$f" in tests/orchestrator/*|tests/webui/hub.test.ts|tests/webui/agentlog.test.ts) continue;; esac
    s=$SECONDS; timeout 900 node "$f" >"$out/${f//\//_}.log" 2>&1; c=$?
    printf '%s\t%s\t%s\n' "$f" "$c" "$((SECONDS-s))" >>"$out/results.tsv"
    printf '%s exit=%s %ss\n' "$f" "$c" "$((SECONDS-s))"
  done
  awk -F'\t' '{n++; p+=$2==0; b+=$2!=0} END{printf "passed=%d failed=%d total=%d\n", p, b, n}' "$out/results.tsv"
  ```

  Pass 2 is the second call. Do not clear `/tmp/it` and do not truncate `results.tsv`, or pass 1 is lost:

  ```bash
  out=/tmp/it; : >"$out/results2.tsv"
  for f in tests/orchestrator/*.test.ts tests/webui/hub.test.ts tests/webui/agentlog.test.ts; do
    s=$SECONDS; timeout 900 node "$f" >"$out/${f//\//_}.log" 2>&1; c=$?
    printf '%s\t%s\t%s\n' "$f" "$c" "$((SECONDS-s))" >>"$out/results2.tsv"
    printf '%s exit=%s %ss\n' "$f" "$c" "$((SECONDS-s))"
  done
  cat "$out/results.tsv" "$out/results2.tsv" >"$out/all.tsv"
  awk -F'\t' '{n++; p+=$2==0; b+=$2!=0} END{printf "passed=%d failed=%d total=%d\n", p, b, n}' "$out/all.tsv"
  ```

  The printed count is the report total. The 60-minute limit is on an unchanged run log, and each call updates it.
- A suite that cannot start exits nonzero and is a finding. An empty log with exit 0 is an assert-only suite, not a silent pass. Do not re-run a green suite to confirm it, and do not sweep the process table, because each suite cleans up its own children.

## Triage

- One red gets one classification message: `git show --stat <covered-sha>`, `git show <sha> -U0 -- src tests | grep '^+' | head -80`, the coverage grep when the diff does not already add the pin, and the failure-log read. Never use `git diff <base>..HEAD`, because the base is the merge commit itself, so that diff is empty by construction.
- Read the finished failure log once: `wc -l` and then `cat` when the log is short (a daemon failure log is often a few dozen lines), or head and tail when it is long. Read the first match of `timeout waiting|AssertionError|Error:`. A `waitFor` red reads `timeout waiting for <what>; daemon output (live):`, then the daemon's last line. Never read the only copy while the runner writes it.
- The classification is file overlap only: the red test file and the `src/` modules that it imports. A prompt file (`agents/*.md`) or a `docs/` file in the diff never makes a spawn or merge test covered. If the overlap is empty, write one line and continue. Do not use causal reasoning to reopen it.
- A red inside the covered diff gets one isolated `timeout 900 node <file>` rerun. If it reproduces, report it and stop. Always report the red as observed. Never call it flaky or stable, because one sample cannot decide that and the no-rerun rule gives no second sample.
- Coverage is one `grep -rn '<changed symbol or literal>' tests/`, zero hits is a gap, and a suite that fails before its pin never ran, so name the blocking red. When the covered diff itself adds an assertion for the changed literal, the diff output is already the evidence, so skip the second grep. A doubt that survives these checks becomes one assumption line or one finding line, not a read. Never read the covered diff in full, never read a `docs/`, `agents/`, or `skills/` diff, and never read source.

## Report

- Append one line under `# Notes`: `Base: <sha>. Suites: <command>. Passed: N. Failed: M.` Take N and M from the TSV, never from memory or a log grep.
- Under `# Open questions`, one line per item: the suite or command and the first failure line. Defect, coverage gap, and assumption are separate lines and nothing else. No item that the code or the docs answer, and no analysis of the covered change.
- Write with `cat >>` or an `awk` insert before `# Open questions`, prove it with `tail`, and never use `edit`. Then stop: no third verification call and no git check of the append.
- End with the spawn prompt's finding line, or state that no defect was found. Do not recap the report.

## Shell

- Chain with `;` or `|| true`, never `&&`, because a zero-match `grep` exits 1 and drops the rest. Capture `out=$(...)` and print `$?` before a pipe, because a pipe reports the last command.
- `pgrep -af <pattern>` matches the shell that runs it, so use `pgrep -af 'fake[-]agent'`. Kill only a pid that you can tie to this run by its cmdline or fixture root. Never `pkill -f`, and never kill the daemon pid in `.kanban/.pids/`.
