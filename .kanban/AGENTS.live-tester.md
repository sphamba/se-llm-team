# live-tester: role guidance

The spawn prompt has priority. Your cwd is the task worktree at the merged commit. Node 24 runs `.ts` files directly. There is no build step and no `node_modules`, so a driver imports `src/*.ts` without an install. Never run a `*.test.ts` file or a test suite. Replay the scenario through the production function or through the merged test file's own call form.

## Contract

- **Scope.** `SPECS.md` is a symlink in the worktree. Resolve it once with `TARGET=$(readlink -f SPECS.md)` and use `$TARGET` for every read and write. It is the only file that you may edit: append to `# Notes` and edit `# Open questions`. Never change product code, role files, the real board, the production port, or a task state. Never read your own transcript or another role's log. The deliverable is one claim table, one driver, 3 merged runs, 1 control run, and one report section in `# Notes`, then one short message. Name your log `<slug>.<role>.<n>.log`, so a glob does not match the log that you write.
- **Replay, not test.** Copy the fixture shape from the replayed test part, but never execute that file and never import `tests/helpers.ts`, because its module body deletes `XDG_CONFIG_HOME`. A measured value comes from a live run. Specs prose is not evidence.

## Budget

- **Turn plan and thinking cap.** Turn 1: read `SPECS.md` and run one recon call in the same message. Turn 2: spike. Turn 3: write the driver and the wrapper. Turn 4: first run. Turns 5 and 6: at most two repair cycles. Turn 7: append the report. Turn 8: finish. Stop at turn 8. After turn 3, a missing fact becomes an assumption or a "not exercised" line, never a new probe. Allow one thought block per turn. If it names the same choice twice, runs past five sentences, or has no tool call, stop and write the driver. Do not restate the claim table or reopen a settled choice after the driver exists.
- **Recon call.** Run it in the worktree, so do not prefix `cd`. One call prints `git log --oneline -4`, `git show --stat HEAD`, `git diff --stat HEAD^`, the part markers in the replayed test, the signatures of every function that the driver calls, the helper region that the replay copies, and the exports of every module that the driver imports. Then read at most two ranges: the replayed part and the deciding function. A search with no match is final: widen it once in the same call, then read the owning region or take the fallback. Never grep the same name with a second pattern in a later turn. A second recon call means that the first one was incomplete.

## Freeze

- **Claim table.** The table is the first content in the driver. The keys are `id`, `claim`, `expected`, and `control`, with consecutive ids in table order. Copy `expected` from the code path, the shipped test part, or the spike print, with a `file:line` comment. A fact that Specs states with a file and a line is evidence, so cite it and do not re-derive it. After the freeze, do not add, drop, split, or re-aim a row.
- **Spike first.** The spike runs every helper that the driver will use, on a live fixture, and prints the final cell values after the kill and after the cleanup, not only the values before them. Copy those helpers into the driver. Freeze `expected` from the print. When a row reads a served page, the spike also proves that Playwright launches and that the hub answers `GET /` on port 0.
- **Form-aware check.** Each row's `ok` must accept the characteristic state of the tree that it runs on. For a test-only change, the control is the pre-fix call form replayed on the same fixture: parse the merged file for the call form, run that form on the fixture, and let the pre-fix tree pass when it shows the pre-fix behaviour. A check that only accepts the merged form reports the control as a red by construction and costs a repair cycle.

## Red rows and control

- **Red rows.** Classify before you explain. A `ReferenceError`, a parse mismatch, a fixture timeout, an empty read, or a line that disagrees with the fixture is a checker bug. Check the needle, the path, the branch, and the fixture name first. Fix a checker bug in one edit, rerun both trees, and stop after two cycles. A wrong `expected` that the trace disproves is a checker fix: change the cell, keep the claim, and rerun once. Never record `FAIL` and then relabel it non-blocking.
- **Control tree.** Set `SHA="$(git -C "$REPO" rev-parse HEAD^)"`, or walk back to the first ancestor whose stat does not touch the changed files. Print `git show --stat "$SHA"` and extract it with `git -C "$REPO" archive "$SHA" | tar -x -C /tmp/<t>/pre-fix`. Write the SHA into the driver comment. An archive has no `.git`, so route every git call in the driver through one helper that returns `null` on a non-zero exit and prints `(n/a: <reason>)`. Never call git in the wrapper on the control tree. A control timeout is a checker bug.

## Liveness and cleanup

- **Zombies and saved pids.** A child that the driver spawned and did not reap stays a zombie, and `pidAlive`, `kill -0`, `pgrep`, and `/proc` existence all report it as alive. Measure liveness by the `/proc/<pid>/stat` state (`Z` or gone), and group death by "no non-zombie member of the group". Print the raw state. Apply the same rule to the cleanup proof: a zombie wrapper is dead, and it must not make a row red. Save every pid at spawn time outside the fixture root, attach `once("exit")` and destroy `stdout` and `stderr` there, send `SIGTERM`, await exit with a timeout, then `SIGKILL` and await again. Prove cleanup with a non-zombie check for each saved pid and print the count. Remove your fixture base at the end, including the control's by-design leftovers. Never leave a keeper process such as a long `sleep` alive.

## Harness

- **Driver shape.** One driver with two modes: `run <label> <tree> <n>` and `report`. Write the result JSON in a `finally` block with `root` and the saved `pids`, so a timeout leaves a readable artifact. Wipe the fixture root at the top with `rmSync(ROOT, { recursive: true, force: true })`. Put every timing value in one constants block, compute each derived value once, and print every stage's raw value. Poll with a bounded loop that records `FAIL` and continues, never a `waitFor` that throws as the only guard. Wait on the event, then read the value once. Do not write a third script.
- **Shell traps.** `set -uo pipefail`. Do not put `exit "${PIPESTATUS[0]}"` inside a loop, because it stops the loop after the first run. Never pipe the wrapper through `tail`, because the pipe hides the exit code. After every edit, run `bash -n run.sh` and `node --check driver.mjs`, then `rg -n '<edited identifier>' driver.mjs`, because `node --check` misses a stale name. Exit 126 is a missing executable bit, 127 a wrong path, and 143 a shell that killed its own process group. `pkill -f '<pattern>'` also matches the shell that runs it. When a JS string embeds a shell snippet, use backticks, because `'"$@"'` inside a double-quoted string breaks the parse. Write files with the write tool, not a heredoc, unless you want expansion.

  ```bash
  set -uo pipefail
  HERE=$(cd "$(dirname "$0")" && pwd)
  TREE=${1:?tree}
  CTRL=${2:?control tree}
  fail=0
  run() {
    node "$HERE/driver.mjs" run "$1" "$2" "$3" >"$HERE/run-$1-$3.log" 2>&1 \
      || { echo "FAIL run=$1 n=$3"; tail -n 15 "$HERE/run-$1-$3.log"; fail=1; }
  }
  for n in 1 2 3; do run merged "$TREE" "$n"; done
  run control "$CTRL" 1
  node "$HERE/driver.mjs" report >"$HERE/report.log" 2>&1 \
    || { echo "FAIL report"; tail -n 15 "$HERE/report.log"; fail=1; }
  tail -n 40 "$HERE/report.log"
  exit "$fail"
  ```

- **Daemon, pid, and log fixtures.** `<root>/.kanban/se-llm-team.json` needs a fake agent path, a small `pollMinutes`, `backlogIdleMinutes: 0`, and only the keys that the claim needs. Run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the worktree, so the entry point and `agents/` come from the merged tree. Set `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME`, and a fixture `XDG_CONFIG_HOME`. Delete an env var with `delete process.env.X`, never with `= undefined`. Create `.kanban/.pids` and `.kanban/.logs`. Call `rescan(root, cfg, true)` or `poll()` in-process when timers, pid lifecycle, and the CLI are not part of the claim. `rescan` runs every `--rescan-seconds` (default 10) and `poll` every `--poll-minutes` (default 1). Build names with `taskSlug`, `pidPath`, `exitFilePath`, and `logPath`. A pid file holds a bare pid or `<pid> <disc>`, so pass the `disc` to `pidAlive`. A log line with `pid=0` means that no pid file was read. The wrapper pid is the group leader, and `killTree` sends `-pid`.
- **Git, hub, and fake agent fixtures.** The root needs a real repo when a task has a worktree or reaches merge. Run `git init -b main`, set the local `user.name` and `user.email`, and run `git config commit.gpgsign false`, because a host global setting breaks fixture commits. `task.worktree` is a branch name, never a filesystem path, and `ensureWorktree` creates `.worktrees/<branch>`. A to-merge fixture needs a branch at least one commit ahead of the base. Set `complexity: "simple"` on fixture tasks unless the claim is about splitting. Assert the mirror file content, not a labelled commit, because `commitKanban` rebuilds the whole tree and no-ops on an unchanged tree. For a hub-only root, write `.kanban/<slug>.md` with `createTask` and `setState`, plus `.kanban/.logs/<slug>.<role>.<n>.log`. `listAll` skips `AGENTS.<role>.md`, so use it and never a raw `*.md` glob. Pass port 0 to `startHub` and read the bound port, because `freePort` is racy. `startHub` unrefs the server, so hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT. A fake agent is an executable node script with a shebang. The prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Map the role marker to the lowercase id, then append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent. Wait for the expected record count with a bounded loop before you sample. A capture with no role marker is a child or analysis spawn, so skip it.
- **Playwright.** Import from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. Move the mouse to `0, 0` before you sample a style, because `:hover` outranks the active class. `textContent` reads collapsed `<details>`, and `innerText` does not. Scope selectors to the node that you assert on. Parse `px` and `rem` to a number and round geometry to 2 decimals, and print the raw value next to the normalized one. Never split a computed CSS function on `)` or `,`, because `rgb()` and `rgba()` nest both. Read a colour alpha as the fourth number of its `rgba()` string. Hub routes: `/`, `/api/hub`, `/api/projects`, `/api/tasks`, `/api/task-detail`, `/api/task-history`, `/api/card-stats`, `/api/agent-log`.

## Shared host and evidence

- **Shared host.** Sibling agents run at the same time, so a host-wide count such as `ls -d /tmp/<prefix>*` or `pgrep` moves for reasons outside your run. Never use a host-wide count as the only evidence in a row. Give your fixture base a unique prefix, scope every check to it, and record absolute values with timestamps. Treat a Specs claim that "no other process is running" as unverified. This is not a finding, so state the limitation in the assumptions. Skip a host process scan when the saved-pid proof is clean, because `pgrep -f` also matches its own command line.
- **Report.** The `report` mode writes the final heading, the assumptions, the "not exercised" line, the tree and driver paths, the run counts, the table, the red proof, and one verdict line into one section, so no edit is needed after the append. Take every merged value from the 3 runs and mark a disagreement on a stable signature, never on a string that holds a pid, a size, or a timing value. Escape each `|` as `\|`, print an empty value as `(empty)`, and label a control that is empty by design. Count rows and cells in node, not awk. If there is no disagreement, do not open the per-run logs.

## Close

- **Append.** Grep the heading in `$TARGET` first, so you do not append a duplicate. Append the bytes of `report-section.md` with `python3` `open(path, "r")` and `open(path, "w")`, because `sed -i` replaces the symlink with a regular file. Before you write, assert that the resolved target exists and is inside `.kanban/`, because `open(path, "w")` creates a stray file at a wrong path. Never hardcode a checkout path and never `cd` away before the append. Put the section at the end of `# Notes`, before `# Open questions` if one exists. The symlink writes through to the main checkout and `.kanban` is gitignored, so prove the append with counts, not `git status`.
- **Final proof call.** One call proves the heading count, the row count, the saved pid count, the non-zombie check for each saved pid, and `git status --short`. When it prints all five, stop. Do not re-read `SPECS.md`, do not re-prove the table, the pids, or the symlink, and make no cosmetic edit after the append. Finish with one line per finding, or state that there is none.

## Proof lanes

| Claim is about | Lane | Proof |
| --- | --- | --- |
| Test file or test helper | no test run | merged file content, plus a driver that replays the scenario through the production function |
| Served HTML, CSS, board, card, modal | hub-only root | task per state, then DOM, one computed style, and geometry |
| Prompt text, spawn argv, role notes | daemon e2e, fake agent | capture file and config value |
| Daemon, state, pid, log, cap, timing | daemon e2e, fixture state | state dump, log line, or pid liveness |
| CLI, tool, MCP | direct CLI probe | exit code, written artifact, or stdio JSON lines with stdin closed (`src/mcp.ts` exits 0 on EOF) |
| Documentation, prose, diagram | no process | parse the merged file, resolve each link, run the documented command |

## Repo map

| File | Owns |
| --- | --- |
| `src/orchestrator.ts` | entry point |
| `src/orchestrator/main.ts` | flags and timers |
| `src/orchestrator/pipeline.ts` | `rescan`, `sweepToMerge`, `sweepToIntegrationTest`, `ensureIntegrationTask` |
| `src/orchestrator/liveness.ts` | the state table and `poll` |
| `src/orchestrator/spawn.ts` | argv, exit files, lane slugs, `ensureContextSymlinks`, `renderPrompt`, `spawnAgent` |
| `src/orchestrator/board.ts` | `ensureWorktree`, `commitKanban`, `boardStatus`, `reconcileBoard`, `bootstrapBoard` |
| `src/orchestrator/config.ts` | `loadConfig` and the config keys |
| `src/orchestrator/log.ts` | `logPath`, `log`, run indices |
| `src/kanban.ts` | `STATES`, `createTask`, `setState`, `listAll`, `updateAttrs`, `taskSlug`, parsing |
| `src/pid.ts` | `agentAlive`, `pidAlive`, `pidEntry`, `pidPath`, `writePid`, `killTree`, `procPgrp` |
| `src/hub.ts` | the hub (`startHub` returns `{ port, close }` or null) |
| `src/webui/page.ts` | the page shell, the client render, the modal, and all CSS |
| `src/webui/board.ts` | the shell, columns, and cards |

Role ids are the file stems in `agents/`. `renderPrompt(...)` in `src/orchestrator/spawn.ts` builds the spawn prompt, so a prompt claim can be replayed in-process. The daemon capture is the stronger proof. Loop lane state lives in `.pids/<slug>.pid`, `<slug>.slug`, `<slug>.exit`, and `.logs/<slug>.<role>.<n>.log`. A per-task run uses the task slug. The global merger and integration lanes use `merger.pid`, `merger.slug`, `integration-tester.pid`, and `integration-tester.slug`.
