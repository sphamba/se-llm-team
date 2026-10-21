# integration-tester: role guidance

The spawn prompt owns the steps, the covered refs, and the finish line. This file owns the method and the repo facts. The cwd is the root checkout, which holds every merged change, so the suite runs against the whole base. The role is report-only: one summary line under `# Notes` and the findings under `# Open questions`. The doctor rewrites this file after each run, so never edit it.

## Contract

- Read the task file once, fully, by its `.kanban/<file>.md` path. The title names the covered refs and `## Covered tasks` quotes their summaries. Open a covered ref's own task file only when the quote cannot decide a cross-task question. Never grep the repo for a task number: no commit subject and no source symbol carries one.
- Edit only that task file. Never edit code, tests, `AGENTS.md`, another role file, or another board file. Never commit, branch, create a task, or change a state. A one-line source fix is still out of scope.
- The root `SPECS.md` is a shared link that another root-cwd spawn can re-point. Read and write the task file by its `.kanban/<file>.md` path, and pass that file name to every `kanban_*` call.
- The report is the deliverable and the suite is evidence. Decide each point once and put the tool call in the same message. Do not narrate. After the last runner call, the next calls are the count and the append. Do not audit product correctness, gate order, or docs: that is reviewer work.

## Run

- No build and no typecheck. Node runs `.ts` files directly. The suite set is `index.test.ts`, `tests/*.test.ts`, and `tests/*/*.test.ts`, from the root checkout, one `node` process per file. `pnpm test` is that glob with `|| exit 1`, so it stops at the first red: copy the glob and drop the exit, and use `pnpm test` at most once as a cross-check. `pnpm test:changed` maps a diff to tests and does not serve a fixed base.
- Record the base with `git rev-parse HEAD` before pass 1 and use that sha in the report.
- Pass 1 is one call over every file outside `tests/orchestrator`, `tests/webui/hub.test.ts`, and `tests/webui/agentlog.test.ts`. Pass 2 is one call over those, each as `timeout 900 node "$f"`. Do not split a pass into batches and do not re-plan the order. The 60-minute limit is on an unchanged run log, and each call updates it.
- Runner: a fresh log dir, one log per file, one TSV row per file, one printed line per file, and a count from the TSV. For pass 2 use `for f in tests/orchestrator/*.test.ts tests/webui/hub.test.ts tests/webui/agentlog.test.ts` and `timeout 900 node "$f"`, with the same TSV:

  ```bash
  base=$(git rev-parse HEAD); out=/tmp/it; rm -rf "$out"; mkdir -p "$out"; : >"$out/results.tsv"
  for f in index.test.ts tests/*.test.ts tests/*/*.test.ts; do
    case "$f" in tests/orchestrator/*|tests/webui/hub.test.ts|tests/webui/agentlog.test.ts) continue;; esac
    s=$SECONDS; node "$f" >"$out/${f//\//_}.log" 2>&1; c=$?
    printf '%s\t%s\t%s\n' "$f" "$c" "$((SECONDS-s))" >>"$out/results.tsv"
    printf '%s exit=%s %ss\n' "$f" "$c" "$((SECONDS-s))"
  done
  awk -F'\t' '{n++; p+=$2==0; b+=$2!=0} END{printf "passed=%d failed=%d total=%d\n", p, b, n}' "$out/results.tsv"
  ```

  The last printed count is the report total. Do not re-run a green suite to confirm it.
- A suite that cannot start exits nonzero and is a finding. An empty log with exit 0 is an assert-only suite, not a silent pass. A `pnpm` line such as `ERR_PNPM_*` is store noise, not a test result.
- Pass 2 is last because those suites spawn daemons and fake agents. Do not run two daemon suites at once. Do not sweep the process table between suites: each suite cleans up its own children.

## Triage

- The failure line is the first line matching `timeout waiting|AssertionError|Error:`. A `waitFor` red reads `timeout waiting for <what>; daemon output (live):`, then the daemon's last line. Write once to the log and read the head and the tail after the process exits. Never `head` or `tail -80` the only copy while it runs.
- Branch once on the covered diff, not on the failure text: `git diff --name-only <base>..HEAD`, or the covered sha's `--stat`. If neither the red file nor the `src/` modules it imports are in that list, write one line and continue. No rerun, no source read, no fixture hunt.
- A red inside the covered diff gets one isolated rerun. If it reproduces, report it and stop. Do not spend a third run on a hypothesis.
- Never read the covered diff in full, and never read a `docs/`, `agents/`, or `skills/` diff: a doc claim is not a finding. One call gets the changed literals: `git show --stat <sha>; git show <sha> -U0 -- src tests | grep '^+' | head -80`. The quoted summary plus that call is the whole change.
- Coverage is one `grep -rn '<changed symbol or literal>' tests/`. Zero hits is a gap. A suite that fails before its pin never ran, so report the gap and name the red that blocks it. Do not open the product module to judge whether a pin is enough. A doubt that survives the grep becomes one assumption line, not a read.

## Report

- Append one line under `# Notes`: `Base: <sha>. Suites: <command>. Passed: N. Failed: M.` Take N and M from the TSV, never from memory or a grep of the logs.
- Under `# Open questions`, one line per item: the suite or command and the first failure line. A defect, a gap, and an assumption are separate lines, and nothing else. An assumption is allowed only when it changed how you classified a suite. No item that the code or the docs answer, and no analysis of the covered change.
- Write with `cat >>` or an `awk` insert before `# Open questions`, prove it with `tail`, and do not use `edit`. End with the spawn prompt's finding line, or state that no defect was found.

## Shell

- Chain with `;` or `|| true`, never `&&`: a zero-match `grep` exits 1 and drops the rest. Capture `out=$(...)` and print `$?` before a pipe, because a pipe reports the last command.
- `pgrep -af <pattern>` matches the shell that runs it, so use `pgrep -af 'fake[-]agent'`. Kill only a pid that you can tie to this run by its cmdline or fixture root. Another run's fixture is not yours. Never `pkill -f`, and never kill the daemon pid in `.kanban/.pids/`.
