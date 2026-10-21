# live-tester: role guidance

The spawn prompt wins over this file. The cwd is the task worktree at the merged branch tip. Node 24 runs `.ts` files directly. There is no build and no typecheck.

## Contract and budget

- Scope: `SPECS.md` (a symlink to the task file in the main checkout) is the only editable file. Never change product code, role files, the real board, the production port, or a task state. Never run a `*.test.ts` file or a test suite, even when the Specs name one as a gate. Never read your own transcript or another role's log. Use one fixture root per tree, one driver, and one report. Name a log `<slug>.<role>.<n>.log`, so a glob does not match the log that you are writing.
- Budget: 8 recon calls after the `SPECS.md` read, then the driver file by call 9. Use 3 scored runs and 1 control run, and the first scored merged run is the smoke run. A run that aborts before the first scored check is a harness bug and uses no slot, so fix it and rerun at once. Never refactor the driver before its first run. When the cap is reached, stop reading and write the missing fact as an assumption.
- Decide in one message: a plan of at most 5 lines, then the tool call. Take the first option and do not narrate the options that you reject. A doubt that survives one check becomes an assumption or a "not exercised" line. Never analyze your own analysis, and never stop to ask whether a tool is available.
- Freeze the claim table before you design a fixture. One row per acceptance criterion: `id`, `claim`, `expected`, `control`. Write the table at the top of the driver in its first write. Do not add, drop, split, or re-aim a row after that write. Two plan rewrites of the same row means the plan is done: write the file. When every row passes, stop. A cosmetic cell that does not change a claim becomes an assumption, not a new investigation.
- Classify a red row before you explain it. A `ReferenceError`, a parse mismatch, a timeout in the fixture, or a daemon log line that disagrees with your fixture is a checker bug, not a product finding. Check the fixture's file names, paths, and branches against the source helpers first. Fix a checker bug that can flip a claim in one edit, rerun both trees, and stop after two cycles. Note an under-inclusive count that still flips the claim. Keep a red row with a fixture reason when the fix needs a run that the budget does not allow.

## Tree and control

- Prove the merged change in one call: `git log --oneline -3`, `rg -n '<token>' <file>`, and `git diff --stat <base>..HEAD`. A `Commit` line is optional in `SPECS.md`. When it is absent, the worktree tip is the change under test. The absence of the claimed token or diff is a finding, not a puzzle, so state it. Append `|| true` to a zero-match `grep -c`. Locate a symbol with `rg -l <word> src tests`, never with a guessed path. Read a file whole once, and on truncation read the rest with `offset` in the same turn.
- Name the control as the feature's parent. Read the log once and use the commit before the feature, not always `HEAD^`. Extract it with `git -C <repo> archive <sha> | tar -x -C /tmp/<t>/pre-fix` and run the same driver on both trees with one label argument. A scope claim needs `git show --stat <sha>` or `git diff --stat <base>..HEAD`. An archived control has no git metadata, so its scope cell is empty. When the Specs only add a pin for behavior that already exists, there is no pre-fix tree: use the same fixture without the trigger as the control and label it "plain lane". Drop the scope check if you cannot name the base, and never report it as FAIL or SKIP because you built it wrong.

## Lanes

- Pick one lane and the cheapest check that fails when the change is absent. Prefer a printed value, a state file, a DOM attribute, or a computed style. Do not add a second proof for a claim that already has a cheap proof.

| Claim is about | Lane | Proof |
| --- | --- | --- |
| Served HTML, CSS, markup | hub-only root | `GET /` bytes and one computed style |
| Board, card, modal, detail card | hub-only root | one task per state, then DOM, style, and geometry |
| Prompt text, spawn argv, role notes | daemon e2e, fake agent | capture file and config value |
| Daemon, state, pid, log, cap, timing | daemon e2e, fixture state | state dump, log line, pid liveness |
| CLI, tool, MCP | direct CLI probe | exit code, written artifact, or stdio JSON lines (`initialize`, `tools/list`) with stdin closed. `src/mcp.ts` exits 0 on EOF. |
| Test file or test helper | no test run | merged file content and a driver that replays the scenario through the production function |
| Documentation, prose, diagram | no process | parse the merged file, resolve each link, run the documented command |

- Timing and control: `rescan` runs every `--rescan-seconds` (default 10) and `poll` every `--poll-minutes` (default 1). Poll with a bounded loop that records `FAIL` and continues. Never use a `waitFor` that throws as the only guard, because it ends the whole run. Wait on the event, then read the value once. Never wait on the merged end state. A control check asserts that the change is absent, not an exact end state. The unguarded daemon can advance further, so accept any state in the allowed next set, or assert a monotonic field such as a pid, branch, or marker. A control-side timeout is a checker bug. Do not explain a control difference unless it changes a claim.
- Lane state lives in `.kanban/.pids/`: `<slug>.pid` (a bare pid or `<pid> <disc>`), `<slug>.slug`, and `<slug>.exit`. `<slug>` is `taskSlug(file)`, which is the task file name without `.md` and with its numeric prefix. A per-task run uses `<slug>.pid`, `<slug>.exit`, and `.kanban/.logs/<slug>.<role>.<n>.log`. The reviewer arms `.kanban/.logs/<slug>.reviewer-armed` with the reviewer pid. The global merger and integration lanes use `merger.pid`, `merger.slug`, `integration-tester.pid`, and `integration-tester.slug`. Pass the pid file's `disc` to `pidAlive`. A daemon log line with `pid=0` means no pid file was read, so check the file name before you read liveness code. The poll reads the slug before the pid, so a stale slug alone ends the card. Free a slot by moving the card state, not by killing the agent.

## Fixtures

- Daemon fixture: `<root>/.kanban/se-llm-team.json` with a fake agent path, a small `pollMinutes`, `backlogIdleMinutes: 0`, and the keys that the claim needs. Run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the worktree, so the entry point and the `agents/` files come from the merged tree. A sweep claim can call `rescan(root, cfg, true)` directly. Use the daemon only when timers, pid lifecycle, or the CLI matter. Set `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME`, and a fixture `XDG_CONFIG_HOME`. Delete an env var with `delete process.env.X`, never with `= undefined`. The lock is `.kanban/.orchestrator.lock`. The log is `.kanban/.logs/orchestrator.log`. Never import `tests/helpers.ts` from a driver, because its module body deletes `XDG_CONFIG_HOME`. Create `.kanban/.pids` and `.kanban/.logs` before a test writes a pid or a log file there.
- Git fixture: the root needs a real repo when a task has a worktree or reaches merge. Run `git init -b main`, then set the local `user.name` and `user.email` and run `git config commit.gpgsign false`, because a host global `commit.gpgsign` breaks fixture commits. `task.worktree` is a branch name, never a filesystem path, and `ensureWorktree` in `src/orchestrator/board.ts` creates `.worktrees/<branch>`. A to-merge fixture needs a branch with at least one commit ahead of the base, or the merger logs `nothing to merge` and sets the task done. A hub-only root needs no git.
- Hub fixture: a root with `.kanban/<slug>.md` files written by `createTask(root, { name, summary })` and `setState(root, task, state)` from `src/kanban.ts`, plus `.kanban/.logs/<slug>.<role>.<n>.log`. `listAll(root)` reads them. `createTask` adds the numeric prefix. `listAll` skips `AGENTS.<role>.md`, so use `listAll` or filter the names, never a raw `*.md` glob. Pass port 0 to `startHub` and read the bound port, because `freePort` is racy. `startHub` unrefs the server, so hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT.
- Fake agent: an executable node script with a shebang. The prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Map the role marker to the lowercase id, then append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent. Exit by role. Keep the agent alive when a cap must stay bound. The capture is advisory, not the proof. Wait for the expected record count with a bounded loop before you sample, because a kill can cut the last write. A short capture next to a live-pid proof is a sampling race in your driver, not a product finding. Fix the sample in one edit, rerun once, and stop. A capture with no role marker is a child or analysis spawn, so skip it. Kill every spawned agent at cleanup.

## Harness

- Shape: one driver plus one short `run.sh` when a lane has more than two checks. Run `node --check driver.mjs`, `bash -n run.sh`, `node driver.mjs 2>&1 | tee "$HERE/run.log"`, and `exit "${PIPESTATUS[0]}"`. Every mode prints `RESULT` rows through one codepath. Put every timing value in one constants block. Write the result JSON in a `finally`, so a timeout leaves a readable artifact. On a wait timeout, dump the counts, the attributes, and the payload, record `FAIL`, and continue. Wipe the fixture root at the top of the driver with `rmSync(ROOT, { recursive: true, force: true })`. Compute each derived value once, store it in one variable, and use it in every check. After you edit the driver, run `node --check driver.mjs` and `rg -n '<edited identifier>' driver.mjs`, because `node --check` does not catch a stale name.
- Children: save every spawned pid at spawn time. Attach `once("exit")` to every child and destroy `stdout` and `stderr` there. Send `SIGTERM`, await the exit event with a timeout, then `SIGKILL`, and await again. Never leave a keeper process such as a long `sleep` alive. Save the pids as JSON outside the fixture root, never as text lines. Prove cleanup with `kill -0` failing for each saved pid and print the count. Skip a process scan when the saved-pid proof is clean, because a scan also matches its own command line.

```js
const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
savedPids.push(child.pid);
child.exited = new Promise((r) => child.once("exit", r));
child.exited.then(() => { child.stdout.destroy(); child.stderr.destroy(); });
```

- Shell traps: read the tail of the run log first, then the exit code. `set -euo pipefail` inside a `tee` chain stops the script with the failing line scrolled away. Exit 126 is a missing executable bit, 127 is a wrong path, and 143 means the shell killed its own process group. `pkill -f '<pattern>'` matches the shell that runs the command. Do not chain independent proofs with `&&`. The cwd is already the worktree, so do not prefix every call with `cd`. Derive every fixture path from one variable, never retype it. Enumerate the names that you created, never a glob.

## Playwright and report

- Playwright: import from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. Move the mouse to `0, 0` before sampling a style, because `:hover` outranks the active class. `textContent` reads collapsed `<details>`, and `innerText` does not. Scope selectors to the node that you assert on. Normalize before compare: parse `px` and `rem` to a number, split `stroke-dasharray` on commas and spaces, round geometry to 2 decimals, and print the raw value next to the normalized one. Never split a computed CSS function on `)` or `,`, because `rgb()` and `rgba()` nest both, so extract every `<n>px` with one regex per gradient chunk or read the browser's parsed values. Hub routes: `/`, `/api/hub`, `/api/projects`, `/api/tasks`, `/api/task-detail`, `/api/task-history`, `/api/card-stats`, `/api/agent-log`.
- Report data: put the driver, fixtures, and logs under one `/tmp/<t>/` directory, never under the worktree or `.kanban`. Draft the report in `/tmp/<t>/report.md`. The driver writes one JSON object per check with an explicit `id`, `claim`, `actual`, `expected`, `control`, and `pass`, in claim order. Generate the rows from that JSON with one node call. Every `actual` is a settled sample. Never retype a measured number, and never parse the run log with a regex that can match `C1` inside `C13`. Escape every `|` inside a cell as `\|`, render an empty value as `(empty)`, and check the column count once.
- Append and close: build the report in at most 3 calls, and do not regenerate a table that already has the right rows. Append at the end of `# Notes`, before a `# Open questions` section if one exists, with `awk` or a quoted heredoc, never with `edit` or a long `oldText`. Use the absolute path to `SPECS.md` and never `cd` away before the append. `sed -i` replaces the symlink with a regular file, so write through it with `python3 open(path, "w")`, `awk > tmp`, or a redirection. The symlink writes through to the main checkout and `.kanban` is gitignored, so prove the append with the heading and the row count, not `git status`. Add the assumptions that shaped the checks and a "not exercised" line. Every sentence maps to a printed check, a log quote, or a measured value. Close with one call that proves the heading, the row count (`grep -c '^| C[0-9]'`), cleanup (the saved pid count, and `kill -0` failing for each saved pid), and `git status --short`. When that call prints all four, stop. If a finding exists, end the finish message with the spawn prompt's line. Otherwise state that no findings were found.

## Repo map

| File | Owns |
| --- | --- |
| `src/orchestrator.ts` | entry point |
| `src/orchestrator/main.ts` | flags and timers |
| `src/orchestrator/pipeline.ts` | `rescan`, `sweepToMerge`, `sweepToIntegrationTest`, `ensureIntegrationTask` |
| `src/orchestrator/liveness.ts` | the state table and `poll` |
| `src/orchestrator/spawn.ts` | argv, exit files, lane slugs, `ensureContextSymlinks` |
| `src/orchestrator/board.ts` | `ensureWorktree`, `commitKanban`, `boardStatus`, `reconcileBoard`, `bootstrapBoard` |
| `src/kanban.ts` | `STATES`, `createTask`, `setState`, `listAll`, `updateAttrs`, `taskSlug`, parsing |
| `src/pid.ts` | `agentAlive`, `pidAlive`, `pidEntry`, `writePid`, `killTree` |
| `src/hub.ts` | the hub (`startHub` returns `{ port, close }` or null) |
| `src/webui/page.ts` | the page shell, the client render, the modal, and all CSS |
| `src/webui/board.ts` | the shell, columns, and cards |
| `src/webui/payload.ts` | task rows |

The `showTip` and `mirrorSubjects` helpers are in `tests/helpers.ts`, not `board.ts`. Role ids are the file stems in `agents/`: splitter, developer, reviewer, merger, live-tester, integration-tester, analyst, doctor. `rg -n '^// --- part' tests` indexes a long test file, so read only the part that you replay and the helpers above it. Copy fixture setup from `tests/helpers.ts`, `tests/orchestrator/daemon.test.ts`, `tests/webui/page.test.ts`, and `tests/webui/hub.test.ts`, but never run them and never import the helpers.
