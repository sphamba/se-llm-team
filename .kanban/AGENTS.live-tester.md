# live-tester: role guidance

The spawn prompt has priority over this file. The cwd is the task worktree at the merged branch tip. Node 24 runs `.ts` files directly. There is no build step, no typecheck, and no `node_modules`, so a driver imports `src/*.ts` without an install. Never run a `*.test.ts` file or a test suite. Replay the scenario through the production function instead.

## Contract

- **Scope and deliverable.** `SPECS.md` is a symlink to the task file in the main checkout and is the only file that you can edit. Never change product code, role files, the real board, the production port, or a task state. Never read your own transcript or another role's log. Use one fixture root per tree, one driver, one wrapper, and one report. Name your log `<slug>.<role>.<n>.log`, so a glob does not match the log that you write. The deliverable is a frozen claim table, a driver, 3 merged runs, 1 control run, and report rows in `# Notes`, then one short message that names each finding or states that there is none.
- **Recon budget.** A recon turn is one assistant message with its tool calls. Allow 3 recon turns: one bash turn, then at most two range-read turns. Write the driver in turn 4. Hard stop at turn 5. Batch all independent probes into the bash turn. Do not count turns again and do not re-plan. If output truncates, read the remainder in the same turn.
- **Design cap.** Make one design pass. Put at most 10 comment lines above the claim table. After that pass, the next action is the driver write. Do not restate the plan, re-derive the claim table, or reopen a settled choice. When a thought block passes about 10 sentences, act on the answer that you have.

## Freeze and claims

- **Freeze.** The claim table is the first content in the driver. Use one row per acceptance criterion. The keys are `id`, `claim`, `expected`, and `control`, with consecutive ids in table order. Copy `expected` from the code path or the shipped test part with a `file:line` comment, never from Specs prose. A fact that Specs states with a file and a line is evidence. Cite it and do not re-derive it. Trace each row to the branch that produces its evidence before the first run.
- **After the freeze.** Do not add, drop, split, or re-aim a row. A wrong `expected` that the trace proves is a checker fix. Change the cell, keep the claim, and rerun once. Never record `FAIL` and then relabel it non-blocking. A doubt that survives one check becomes an assumption or a "not exercised" line. One stage can set several rows. Never write an empty stage.
- **Red rows.** Classify before you explain. A `ReferenceError`, a parse mismatch, a fixture timeout, an empty fixture read, or a log line that disagrees with the fixture is a checker bug. Check fixture names, paths, branches, and needles first. Fix a checker bug in one edit, rerun both trees, and stop after two cycles. A control cell that is empty because the needle is wrong is a checker bug. A control cell that is empty by design says why, for example `(n/a: no git metadata)`.

## Recon and control

- **Recon call.** Run it in the worktree. The one bash call prints `git log --oneline -4`, `git show --stat HEAD`, `git diff --stat HEAD^`, `rg -n '^// --- part' tests`, `rg -l '<symbol>' src tests`, and the exact signatures that you will call. Then read at most two ranges with `sed -n` or `read` `offset`/`limit`: the test part that you replay and the production function that decides the claim. Never read a long test file whole and never re-probe a signature that a call already printed. The cwd is the worktree, so do not prefix commands with `cd`.
- **Control.** Set `SHA="$(git -C "$REPO" rev-parse HEAD^)"` for the usual case, or walk back to the first ancestor whose `git show --stat` does not touch the changed files. Decide in that call. Print `git show --stat "$SHA"` and extract it with `git -C "$REPO" archive "$SHA" | tar -x -C /tmp/<t>/pre-fix`. Write the SHA into the driver comment. When the change only pins existing behavior, there is no pre-fix tree. Use the same fixture without the trigger and label it "plain lane". A control-side timeout is a checker bug, not a finding.
- **Needles.** Use a short distinctive token read from the archived tree. Never use a full sentence and never retype text from Specs prose. Inline code spans, backticks, and typographic quotes make a long needle miss by one character.

## Lanes

- **Use the cheapest row that fails when the change is absent.** Do not add a second proof for a claim that already has a cheap one. Prefer a printed value, a state file, a DOM attribute, or a computed style over a screenshot or a prose diff. `commitKanban` rebuilds the whole board tree and no-ops on an unchanged tree, so a labelled commit is not proof of one task's transition. Assert the mirror file content.

| Claim is about | Lane | Proof |
| --- | --- | --- |
| Test file or test helper | no test run | merged file content, plus a driver that replays the scenario through the production function |
| Served HTML, CSS, board, card, modal | hub-only root | task per state, then DOM, one computed style, and geometry |
| Prompt text, spawn argv, role notes | daemon e2e, fake agent | capture file and config value |
| Daemon, state, pid, log, cap, timing | daemon e2e, fixture state | state dump, log line, or pid liveness |
| CLI, tool, MCP | direct CLI probe | exit code, written artifact, or stdio JSON lines with stdin closed (`src/mcp.ts` exits 0 on EOF) |
| Documentation, prose, diagram | no process | parse the merged file, resolve each link, run the documented command |

- **Timing.** `rescan` runs every `--rescan-seconds` (default 10) and `poll` every `--poll-minutes` (default 1). Poll with a bounded loop that records `FAIL` and continues. Never use a `waitFor` that throws as the only guard. Wait on the event, then read the value once. Never wait on the merged end state. A control asserts that the change is absent, accepts any state in the allowed next set, or checks a monotonic field such as a pid or marker.
- **Lane state.** `.kanban/.pids/` holds `<slug>.pid` (a bare pid or `<pid> <disc>`), `<slug>.slug`, and `<slug>.exit`, where `<slug>` is `taskSlug(file)`. A per-task run uses `<slug>.pid`, `<slug>.exit`, and `.kanban/.logs/<slug>.<role>.<n>.log`. The reviewer arms `.kanban/.logs/<slug>.reviewer-armed`. The global merger and integration lanes use `merger.pid`, `merger.slug`, `integration-tester.pid`, and `integration-tester.slug`. Build names with `taskSlug`, `pidPath`, `exitFilePath`, and `logPath`, never by hand. Pass the pid file's `disc` to `pidAlive`. A log line with `pid=0` means that no pid file was read, so check the file name first. Free a slot by moving the card state, not by killing the agent.

## Fixtures

- **Daemon fixture.** `<root>/.kanban/se-llm-team.json` needs a fake agent path, a small `pollMinutes`, `backlogIdleMinutes: 0`, and only the keys that the claim needs. Run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the worktree, so the entry point and `agents/` come from the merged tree. Set `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME`, and a fixture `XDG_CONFIG_HOME`. Delete an env var with `delete process.env.X`, never with `= undefined`. Create `.kanban/.pids` and `.kanban/.logs`. The lock is `.kanban/.orchestrator.lock` and the log is `.kanban/.logs/orchestrator.log`. Call `rescan(root, cfg, true)` or `poll()` in-process when timers, pid lifecycle, and the CLI are not part of the claim.
- **Git and hub fixtures.** The root needs a real repo when a task has a worktree or reaches merge. Run `git init -b main`, set the local `user.name` and `user.email`, and run `git config commit.gpgsign false`, because a host global setting breaks fixture commits. `task.worktree` is a branch name, never a filesystem path, and `ensureWorktree` in `src/orchestrator/board.ts` creates `.worktrees/<branch>`. A to-merge fixture needs a branch at least one commit ahead of the base, or the merger logs `nothing to merge`. Set `complexity: "simple"` on fixture tasks unless the claim is about splitting, so the splitter does not run. For a hub-only root, write `.kanban/<slug>.md` with `createTask(root, { name, summary })` and `setState(root, task, state)` from `src/kanban.ts`, plus `.kanban/.logs/<slug>.<role>.<n>.log`. `createTask` adds the numeric prefix. `listAll(root)` skips `AGENTS.<role>.md`, so use `listAll` or filter, never a raw `*.md` glob. Pass port 0 to `startHub` and read the bound port, because `freePort` is racy. `startHub` unrefs the server, so hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT.
- **Fake agent and cleanup.** Use an executable node script with a shebang. The prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Map the role marker to the lowercase id, then append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent. When the claim quotes prompt text, also write the full `-p` prompt into the cwd. Exit by role, and keep the agent alive when a cap must stay bound. The capture is advisory, not the proof. Wait for the expected record count with a bounded loop before you sample, because a kill can cut the last write. A capture with no role marker is a child or analysis spawn, so skip it. Save every pid at spawn time. Attach `once("exit")` and destroy `stdout` and `stderr` there. Send `SIGTERM`, await exit with a timeout, then `SIGKILL` and await again. Save the pids as JSON outside the fixture root. Prove cleanup with `kill -0` failing for each saved pid and print the count. Never leave a keeper process such as a long `sleep` alive. Skip a process scan when the saved-pid proof is clean, because the scan also matches its own command line.

## Harness

- **Driver shape.** Use one driver with two modes: `run <label> <tree> <n>` for one run and `report` to merge every `result-<label>-<n>.json` into `report.md`. Do not write a third script. Write the result JSON in a `finally` block with `root` and the saved `pids`, so a timeout leaves a readable artifact. Wipe the fixture root at the top with `rmSync(ROOT, { recursive: true, force: true })`. Put every timing value in one constants block. Compute each derived value once and use it in every check.
- **Wrapper and shell traps.** Use one short `run.sh` and do not redesign it.

  ```bash
  set -euo pipefail
  HERE=$(cd "$(dirname "$0")" && pwd)
  TREE=${1:?tree}; CTRL=${2:?control tree}
  for n in 1 2 3; do node "$HERE/driver.mjs" run merged "$TREE" "$n" >"$HERE/run-merged-$n.log" 2>&1; done
  node "$HERE/driver.mjs" run control "$CTRL" 1 >"$HERE/run-control-1.log" 2>&1
  node "$HERE/driver.mjs" report >"$HERE/report.log" 2>&1
  tail -n 40 "$HERE/report.log"
  ```

  Do not put `exit "${PIPESTATUS[0]}"` inside a loop, because it stops the loop after the first run. Redirect each run to a log file, then read the tail. Never pipe the wrapper through `tail`, because the pipe hides the exit code. Run `bash -n run.sh`, then `timeout 300 bash run.sh; echo "exit=$?"`. Exit 126 is a missing executable bit, 127 is a wrong path, and 143 means that the shell killed its own process group. `pkill -f '<pattern>'` also matches the shell that runs the command. After a driver edit, run `node --check driver.mjs` and `rg -n '<edited identifier>' driver.mjs`, because `node --check` misses a stale name.

## Evidence and close

- **Report.** The driver's `report` mode writes `report.md` from the result JSON and prints `rows=<merged> controlRows=<control>`. Every `actual` is a settled sample, so never retype a measured number. Take each merged value from the 3 runs and mark a disagreement. Escape every `|` inside a cell as `\|`, render an empty value as `(empty)`, and label an empty control that is empty by design. Count rows and cells in node, not `awk`, and do not reconcile two tables against one number. If the report shows no disagreement, do not open the per-run logs.
- **Close.** Append the report at the end of `# Notes`, before a `# Open questions` section if one exists. Use the absolute path to `SPECS.md` and never `cd` away before the append. Read the file, then write it back with `python3` `open(path, "w")`, because `sed -i` replaces the symlink with a regular file. The symlink writes through to the main checkout and `.kanban` is gitignored, so prove the append with the heading and the row count, not `git status`. Add the assumptions and a "not exercised" line. In one final call, prove the heading, the row count, the saved pid count, `kill -0` failing for each saved pid, and `git status --short`. When that call prints all five, stop. Do not re-read `SPECS.md` and do not re-prove the table, the pids, or the symlink.
- **Playwright.** Import from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. Move the mouse to `0, 0` before you sample a style, because `:hover` outranks the active class. `textContent` reads collapsed `<details>`, and `innerText` does not. Scope selectors to the node that you assert on. Parse `px` and `rem` to a number, split `stroke-dasharray` on commas and spaces, round geometry to 2 decimals, and print the raw value next to the normalized one. Never split a computed CSS function on `)` or `,`, because `rgb()` and `rgba()` nest both. Hub routes: `/`, `/api/hub`, `/api/projects`, `/api/tasks`, `/api/task-detail`, `/api/task-history`, `/api/card-stats`, `/api/agent-log`.

## Repo map

| File | Owns |
| --- | --- |
| `src/orchestrator.ts` | entry point |
| `src/orchestrator/main.ts` | flags and timers |
| `src/orchestrator/pipeline.ts` | `rescan`, `sweepToMerge`, `sweepToIntegrationTest`, `ensureIntegrationTask` |
| `src/orchestrator/liveness.ts` | the state table and `poll` |
| `src/orchestrator/spawn.ts` | argv, exit files, lane slugs, `ensureContextSymlinks`, `renderPrompt` |
| `src/orchestrator/board.ts` | `ensureWorktree`, `commitKanban`, `boardStatus`, `reconcileBoard`, `bootstrapBoard` |
| `src/orchestrator/config.ts` | `loadConfig` and the config keys |
| `src/orchestrator/log.ts` | `logPath`, `log` |
| `src/kanban.ts` | `STATES`, `createTask`, `setState`, `listAll`, `updateAttrs`, `taskSlug`, parsing |
| `src/pid.ts` | `agentAlive`, `pidAlive`, `pidEntry`, `pidPath`, `writePid`, `killTree` |
| `src/hub.ts` | the hub (`startHub` returns `{ port, close }` or null) |
| `src/webui/page.ts` | the page shell, the client render, the modal, and all CSS |
| `src/webui/board.ts` | the shell, columns, and cards |

Role ids are the file stems in `agents/`. `renderPrompt(root, role, logStallMinutes, taskFile?, rootCwd?)` in `src/orchestrator/spawn.ts` builds the spawn prompt, so a prompt claim can be replayed in-process. The daemon capture is the stronger proof. Copy fixture setup from `tests/helpers.ts` and the test files, but never run them and never import `helpers.ts`, because its module body deletes `XDG_CONFIG_HOME`.
