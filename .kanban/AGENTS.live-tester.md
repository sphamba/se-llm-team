# live-tester: role guidance

The spawn prompt has priority. The cwd is the task worktree at the merged commit. Node 24 runs `.ts` files directly. There is no build step, no typecheck, and no `node_modules`, so a driver imports `src/*.ts` without an install. Never run a `*.test.ts` file or a test suite. Replay the scenario through the production function instead.

## Plan and budget

- **Turn plan.** Turn 1 holds the `SPECS.md` read and the one recon call in the same message. Turn 2 holds the harness spike. Turn 3 writes the driver and the wrapper. Turn 4 runs the wrapper. Turn 5 starts the first repair. A turn is one assistant message with all its calls. Stop at turn 8. At turn 3, a missing fact becomes an assumption or a "not exercised" line, never a new probe.
- **Recon call.** Run it in the worktree, so do not prefix commands with `cd`. One call prints `git log --oneline -4`, `git show --stat HEAD`, `git diff --stat HEAD^`, `rg -n '^// --- part' tests`, `rg -l '<symbol>' src tests`, the signatures of every function that the driver calls, and `rg -n '^export|^export default'` for every module that the driver imports. Then read at most two ranges: the test part that you replay and the production function that decides the claim. Use `sed -n` or `read` `offset`/`limit`, never a whole test file. Never import `tests/helpers.ts`: its module body deletes `XDG_CONFIG_HOME`. Read only the named helper that you copy, and never grep that file twice. Copy the fixture shape from the test part.
- **Harness spike.** One bash call before the driver. Prove that each import resolves and prints a value, that Playwright launches, and, when a row reads a served page, that the hub starts on port 0 and answers `GET /`. Print each module's export names. Print the plain or unchanged value of every measured row and paste that print into `expected`. A search with no match is final: widen it once in the same call, then read the owning region or take the fallback. Never grep the same name with a second pattern in a later turn.
- **Thinking cap.** A thought that names the same choice twice, or runs past five sentences, ends with a tool call. Write a draft driver early, because the run finds a defect faster than the plan does. Do not restate the claim table, reopen a settled choice, or re-plan after the driver exists.

## Contract

- **Scope.** `SPECS.md` is a symlink to the task file in the main checkout. It is the only file that you can edit. Never change product code, role files, the real board, the production port, or a task state. Never read your own transcript or another role's log. Use one fixture root per tree, one driver, one wrapper, and one report. Name your log `<slug>.<role>.<n>.log`, so a glob does not match the log that you write. The deliverable is a frozen claim table, a driver, 3 merged runs, 1 control run, and report rows in `# Notes`, then one short message that names each finding or states that there is none.
- **Freeze.** The claim table is the first content in the driver, with one row per acceptance criterion. The keys are `id`, `claim`, `expected`, and `control`, with consecutive ids in table order. Copy `expected` from the code path or the shipped test part with a `file:line` comment, never from Specs prose. A fact that Specs states with a file and a line is evidence: cite it and do not re-derive it. A measured value comes from the spike print, never from prose or reasoning. Trace each row to the branch that produces its evidence before the first run.
- **After the freeze.** Do not add, drop, split, or re-aim a row. A wrong `expected` that the trace proves is a checker fix: change the cell, keep the claim, and rerun once. Never record `FAIL` and then relabel it non-blocking. One stage can set several rows. Never write an empty stage. A doubt that survives one check becomes an assumption or a "not exercised" line. Count repair cycles in the driver output and stop after two.
- **Red rows.** Classify before you explain. A `ReferenceError`, a parse mismatch, a fixture timeout, an empty fixture read, or a log line that disagrees with the fixture is a checker bug. Check fixture names, paths, branches, and needles first. Fix a checker bug in one edit, rerun both trees, and stop after two cycles. A control cell that is empty because the needle is wrong is a checker bug. A control cell that is empty by design says why, for example `(n/a: no git metadata)`.

## Control and red proof

- **Control tree.** Set `SHA="$(git -C "$REPO" rev-parse HEAD^)"`, or walk back to the first ancestor whose `git show --stat` does not touch the changed files. Print `git show --stat "$SHA"` and extract it with `git -C "$REPO" archive "$SHA" | tar -x -C /tmp/<t>/pre-fix`. Write the SHA into the driver comment. A test-only commit has no behaviour control: use the same fixture without the trigger (flag off, hold kept, click absent) and label it "trigger absent". A control-side timeout is a checker bug, not a finding.
- **No git metadata.** An archived or copied tree has no `.git`. Route every git call in the driver through one helper that returns `null` on a non-zero exit, and print `(n/a: <reason>)` in that cell. Never call git in the wrapper on the control tree. A first control run that dies on git costs a full wrapper cycle.
- **Red proof.** When the criterion asks for a red, copy the merged tree to `/tmp/<t>/red` with `git archive` or `cp -a`, drop the token in the copy, and run the row against the copy. Never edit the repo, and never present a red that another role recorded as your own. Every row that the mutation covers must flip.

## Lanes

- **Lanes and timing.** Use the cheapest row that fails when the change is absent. Do not add a second proof for a claim that already has a cheap one. Prefer a printed value, a state file, a DOM attribute, or a computed style over a screenshot or a prose diff. Poll with a bounded loop that records `FAIL` and continues, never a `waitFor` that throws as the only guard. Wait on the event, then read the value once. Never wait on the merged end state. `rescan` runs every `--rescan-seconds` (default 10) and `poll` every `--poll-minutes` (default 1). `commitKanban` rebuilds the whole board tree and no-ops on an unchanged tree, so a labelled commit is not proof of one task's transition: assert the mirror file content. Lane state: `.kanban/.pids/` holds `<slug>.pid` (a bare pid or `<pid> <disc>`), `<slug>.slug`, and `<slug>.exit`, where `<slug>` is `taskSlug(file)`. A per-task run uses `<slug>.pid`, `<slug>.exit`, and `.kanban/.logs/<slug>.<role>.<n>.log`. The reviewer arms `.kanban/.logs/<slug>.reviewer-armed`. The global merger and integration lanes use `merger.pid`, `merger.slug`, `integration-tester.pid`, and `integration-tester.slug`. Build names with `taskSlug`, `pidPath`, `exitFilePath`, and `logPath`, never by hand. Pass the pid file's `disc` to `pidAlive`. A log line with `pid=0` means that no pid file was read, so check the file name first. Free a slot by moving the card state, not by killing the agent.

| Claim is about | Lane | Proof |
| --- | --- | --- |
| Test file or test helper | no test run | merged file content, plus a driver that replays the scenario through the production function |
| Served HTML, CSS, board, card, modal | hub-only root | task per state, then DOM, one computed style, and geometry |
| Prompt text, spawn argv, role notes | daemon e2e, fake agent | capture file and config value |
| Daemon, state, pid, log, cap, timing | daemon e2e, fixture state | state dump, log line, or pid liveness |
| CLI, tool, MCP | direct CLI probe | exit code, written artifact, or stdio JSON lines with stdin closed (`src/mcp.ts` exits 0 on EOF) |
| Documentation, prose, diagram | no process | parse the merged file, resolve each link, run the documented command |

## Fixtures

- **Daemon fixture.** `<root>/.kanban/se-llm-team.json` needs a fake agent path, a small `pollMinutes`, `backlogIdleMinutes: 0`, and only the keys that the claim needs. Run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the worktree, so the entry point and `agents/` come from the merged tree. Set `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME`, and a fixture `XDG_CONFIG_HOME`. Delete an env var with `delete process.env.X`, never with `= undefined`. Create `.kanban/.pids` and `.kanban/.logs`. The lock is `.kanban/.orchestrator.lock` and the log is `.kanban/.logs/orchestrator.log`. Call `rescan(root, cfg, true)` or `poll()` in-process when timers, pid lifecycle, and the CLI are not part of the claim.
- **Git and hub fixtures.** The root needs a real repo when a task has a worktree or reaches merge. Run `git init -b main`, set the local `user.name` and `user.email`, and run `git config commit.gpgsign false`, because a host global setting breaks fixture commits. `task.worktree` is a branch name, never a filesystem path, and `ensureWorktree` in `src/orchestrator/board.ts` creates `.worktrees/<branch>`. A to-merge fixture needs a branch at least one commit ahead of the base, or the merger logs `nothing to merge`. Set `complexity: "simple"` on fixture tasks unless the claim is about splitting, so the splitter does not run. For a hub-only root, write `.kanban/<slug>.md` with `createTask(root, { name, summary })` and `setState(root, task, state)` from `src/kanban.ts`, plus `.kanban/.logs/<slug>.<role>.<n>.log`. `createTask` adds the numeric prefix. `listAll(root)` skips `AGENTS.<role>.md`, so use `listAll` or filter, never a raw `*.md` glob. Pass port 0 to `startHub` and read the bound port, because `freePort` is racy. `startHub` unrefs the server, so hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT.
- **Fake agent and cleanup.** Use an executable node script with a shebang. The prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Map the role marker to the lowercase id, then append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent. When the claim quotes prompt text, also write the full `-p` prompt into the cwd. Exit by role, and keep the agent alive when a cap must stay bound. The capture is advisory, not the proof. Wait for the expected record count with a bounded loop before you sample, because a kill can cut the last write. A capture with no role marker is a child or analysis spawn, so skip it. Save every pid at spawn time. Attach `once("exit")` and destroy `stdout` and `stderr` there. Send `SIGTERM`, await exit with a timeout, then `SIGKILL` and await again. Save the pids as JSON outside the fixture root. Prove cleanup with `kill -0` failing for each saved pid and print the count. Never leave a keeper process such as a long `sleep` alive. Skip a process scan when the saved-pid proof is clean, because the scan also matches its own command line.

## Harness

- **Driver shape.** Use one driver with two modes: `run <label> <tree> <n>` for one run and `report` to merge every `result-<label>-<n>.json` into `report.md` and a ready-to-append `/tmp/<t>/report-section.md`. Do not write a third script. Write the result JSON in a `finally` block with `root` and the saved `pids`, so a timeout leaves a readable artifact. Wipe the fixture root at the top with `rmSync(ROOT, { recursive: true, force: true })`. Put every timing value in one constants block. Compute each derived value once and use it in every check. Print every stage's raw value, so a red row needs no second read.
- **Wrapper and shell traps.** Use one short `run.sh`, and print the tail of every failing run, because the report does not exist after a failed control run.

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

  Do not put `exit "${PIPESTATUS[0]}"` inside a loop, because it stops the loop after the first run. Never pipe the wrapper through `tail`, because the pipe hides the exit code. Run `bash -n run.sh`, then `timeout 300 bash run.sh; echo "exit=$?"`. Exit 126 is a missing executable bit, 127 is a wrong path, and 143 means that the shell killed its own process group. `pkill -f '<pattern>'` also matches the shell that runs the command. After a driver edit, run `node --check driver.mjs` and `rg -n '<edited identifier>' driver.mjs`, because `node --check` misses a stale name. Make no cosmetic edit before the first run.

## Evidence and close

- **Report.** The `report` mode writes `report.md` and `report-section.md` from the result JSON, and prints `rows=<merged> controlRows=<control>`. Every `actual` is a settled sample, so never retype a measured number. Take each merged value from the 3 runs and mark a disagreement. Escape every `|` inside a cell as `\|`, render an empty value as `(empty)`, and label an empty control that is empty by design. Count rows and cells in node, not `awk`, and do not reconcile two tables against one number. If the report shows no disagreement, do not open the per-run logs. The section holds the assumptions, the "not exercised" line, the driver and tree paths, the run counts, the table, the red proof, and one verdict line.
- **Append and close.** Grep for the section heading first, so you do not append a duplicate. Append the bytes of `/tmp/<t>/report-section.md`, never a paste of stdout and never a retyped table. Use the absolute path to `SPECS.md` and never `cd` away before the append. Read the file, then write it back with `python3` `open(path, "w")`, because `sed -i` replaces the symlink with a regular file. Put the section at the end of `# Notes`, before a `# Open questions` section if one exists. The symlink writes through to the main checkout and `.kanban` is gitignored, so prove the append with the heading and the row count, not `git status`. In one final call, prove the heading count, the row count, the saved pid count, `kill -0` failing for each saved pid, and `git status --short`. When that call prints all five, stop. Do not re-read `SPECS.md` and do not re-prove the table, the pids, or the symlink.
- **Playwright.** Import from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. Move the mouse to `0, 0` before you sample a style, because `:hover` outranks the active class. `textContent` reads collapsed `<details>`, and `innerText` does not. Scope selectors to the node that you assert on. Parse `px` and `rem` to a number and round geometry to 2 decimals, and print the raw value next to the normalized one. Never split a computed CSS function on `)` or `,`, because `rgb()` and `rgba()` nest both. Read a colour alpha as the fourth number of its `rgba()` string. Hub routes: `/`, `/api/hub`, `/api/projects`, `/api/tasks`, `/api/task-detail`, `/api/task-history`, `/api/card-stats`, `/api/agent-log`.

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

Role ids are the file stems in `agents/`. `renderPrompt(root, role, logStallMinutes, taskFile?, rootCwd?)` in `src/orchestrator/spawn.ts` builds the spawn prompt, so a prompt claim can be replayed in-process. The daemon capture is the stronger proof. Copy fixture setup from the test part that you replay, but never run a test file and never import `tests/helpers.ts`, because its module body deletes `XDG_CONFIG_HOME`.
