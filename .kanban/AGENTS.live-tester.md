# live-tester: role guidance

The spawn prompt wins over this file. It owns the numbered steps, the state ban, and the finish text. The cwd is the task worktree at the merged branch tip. Node 24 runs `.ts` files directly. There is no build and no typecheck.

## Order and budget

- Work in this order: one recon batch, one driver, one smoke run, one control run, one report. Do not add or repeat a step. Every block calls a tool or ends the run. Put the plan in the same message as the call. If you start to re-decide a point that this file answers, take the first option and call the tool. Never re-read a file, and never proofread a file that you wrote.
- Recon is any call that prints no `RESULT` line. Use 2 batches for a text or test-only change and 4 for a behavior change. One batch answers all questions: one `rg -n '<a>|<b>|<c>' src tests`, one `sed -n '<a>,<b>p' <file>` per file, and one `cat` of the config. When the budget is spent, write the driver, and mark each open detail as an assumption in the report. A race, an extra spawn, or a duplicate run is a finding with log lines, not a root-cause hunt.
- At most 3 driver runs. The first scored run is the smoke run, so do not add a separate smoke pass. A run that prints no `RESULT` line is a harness bug. It does not use a slot, but fix the harness and rerun at once. Never refactor the driver before its first run. Freeze the claim table as a comment in the driver header before the first run: claim, printed proof, control. One row per check. Each claim quotes a Specs line or a printed constant. A later doubt becomes a "not exercised" line, not a new check.

## Tree check

- Prove the change in one batch: `git log --oneline -1`, `grep -n '<token>' <file>`, and `grep -n 'Commit' SPECS.md`. Absence is a finding, not a puzzle. Print the proofs, state the absence in the report, and keep only the checks that do not depend on the change. Never hunt for a lost commit with `--all`, `-S`, reflogs, or the logs of other roles.
- `HEAD^` is a behavior control only. Extract it with `git -C <repo> archive <parent> | tar -x -C /tmp/<t>/pre-fix` and run the same driver on both trees with one label argument. A scope claim needs the Notes commit (`git show --stat <sha>`) or `git diff --stat <base>..HEAD`. An archived control has no git metadata, so a scope claim has no control cell. If you cannot name the base, drop the check. Never report a scope check as FAIL or SKIP because you built it wrong.

## Contract

- `SPECS.md` in the cwd is a symlink to the task file in the main checkout and is the only file you may edit. `AGENTS.md` is a symlink to this file. Read `SPECS.md` once, fully. Never read your own transcript or another role's log. Name a log `<slug>.<role>.<n>.log`, because a glob also matches the log that you are writing. Never run a `*.test.ts` file or any test suite, even when the Specs name one as a gate. Never edit product code, the role files, the real board, or the production port. Never change a task state. Use one fixture root per tree, one driver, and one report.

## Triage a red check

- A red check is a checker bug until the needle is proven present: `grep -c '<needle>' <file>` on the merged tree, or `git show <commit>:<file> | grep -c '<needle>'`. An absent needle is a finding. A check that fails the same way on both trees means that the tree has no change to test. A change claim needs a merged PASS and a control FAIL. A keep-green claim must pass on both trees. Expected values come from a formula or a printed constant, never from mental arithmetic. Every line prints its name, actual value, and expected value. Copy a documentation needle from `grep -n` output. Anchor a text claim on 2 or 3 Specs tokens with `grep -c`. Fix every visible checker bug in one edit, rerun both trees, and stop after two cycles. Report the checks that still fail.

## Lanes

Pick one lane and the cheapest check that fails when the change is absent. The table decides.

| Claim is about | Lane | Proof |
| --- | --- | --- |
| Served HTML, CSS, markup | hub-only root | `GET /` bytes and one computed style |
| Board, card, modal, detail card | hub-only root | one task per state, then DOM, style, and geometry |
| Prompt text, spawn argv, role notes | daemon e2e, fake agent | capture file and config value |
| Daemon, state, pid, log, cap, timing | daemon e2e, fixture state | state dump, log line, pid liveness |
| CLI, tool, MCP | direct CLI probe | exit code, written artifact, or stdio JSON lines (`initialize`, `tools/list`) with stdin closed. `src/mcp.ts` exits 0 on EOF. |
| Test file, test helper | no test run | merged file content and a driver that replays the test scenario through the production function |
| Documentation, prose, diagram | no process | parse the merged file, resolve each link, run the documented command |

- Timing: the sweep is `rescan` at `--rescan-seconds` (default 10) and the poll is `--poll-minutes` (default 1). Print the daemon start line or the child argv, because a helper that hardcodes a flag swallows your override. Poll with a bounded loop that records `FAIL`. `waitFor` calls `killAll` and exits 1 on timeout, so a missed predicate ends the whole run. Wait on the event, then read the value once. Never wait on the merged end state, because the control ends elsewhere. A control-side timeout is a checker bug.
- Lane state lives in `.kanban/.pids/`: `<lane>.pid` (a bare pid or `<pid> <starttime>`), `<lane>.slug`, and `<lane>.exit`. A per-task run uses `<slug>.pid`, `<slug>.exit`, and `.logs/<slug>.<role>.<n>.log`. The poll reads the slug before the pid, so a stale slug alone ends the card. `pidEntry` splits on whitespace, and `pidAlive` falls back to `kill(pid, 0)`. A hand-built leftover state is valid when the race cannot be triggered on demand. State it in the assumptions.
- Fake agent: an executable node script with a shebang. The prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Map the role marker to the lowercase id and append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent. Exit by role. Keep the agent alive when a cap must stay bound. The capture is the evidence, not the raw display label. A capture with no role marker is a child or analysis spawn, so skip it. The integration sweep spawns a card from the root with no base-branch gate, and its lane holds one run project-wide. Free a slot by moving the card state, not by killing the agent. A cap or ordering claim needs `maxParallel: 1` and the lower-priority card created first.

## Fixtures

- Hub fixture: a root with `.kanban/<slug>.md` files written by `createTask(root, { name, summary })` and `setState(root, task, state)` from `src/kanban.ts`, plus `.kanban/.logs/<slug>.<role>.<n>.log`. `listAll(root)` reads them. Only files with a numeric prefix are tasks. A role note such as `AGENTS.<role>.md` in the same directory crashes a `*.md` glob. A hub root needs no git and no daemon. Pass port 0 to `startHub` and read the bound port, because `freePort` is racy. `startHub` unrefs the server, so hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT.
- Daemon fixture: `<root>/.kanban/se-llm-team.json` with a fake agent path, a small `pollMinutes`, and the keys that the claim needs. Run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the worktree, because `agents/` is read from the cwd. Set `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME`, and a fixture `XDG_CONFIG_HOME`. Delete an env var with `delete process.env.X`, never with `= undefined`. The lock is `.kanban/.orchestrator.lock`. The log is `.kanban/.logs/orchestrator.log`. Never import `tests/helpers.ts` from a driver, because its module body deletes `XDG_CONFIG_HOME`.

## Harness

- Shape: one driver plus one short `run.sh` when a lane has more than two checks: `node --check driver.mjs`, `bash -n run.sh`, `node driver.mjs 2>&1 | tee "$HERE/run.log"`, and `exit "${PIPESTATUS[0]}"`. Every mode prints `RESULT` rows through one codepath. Put every timing value in one constants block. Write the result JSON in a `finally`, so a timeout leaves a readable artifact. On a wait timeout, dump the counts, the attributes, and the payload, record `FAIL`, and continue. Wipe the fixture root at the top of the driver with `rmSync(ROOT, { recursive: true, force: true })`, because a rerun on a stale root reads old tasks and old mtimes.
- Children: save every spawned pid in a `savedPids` array at spawn time. Attach `once("exit")` to every child and destroy `stdout` and `stderr` there. A daemon with piped stdio keeps the node event loop alive after SIGKILL, so the driver prints `SUMMARY` and then hangs. Send `SIGTERM`, await the exit event with a timeout, then `SIGKILL`, and await again. Never leave a keeper process such as a long `sleep` alive.

```js
const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
savedPids.push(child.pid);
child.exited = new Promise((r) => child.once("exit", r));
child.exited.then(() => { child.stdout.destroy(); child.stderr.destroy(); });
```

- Shell traps and cleanup: read the tail of the run log first, then the exit code. `set -euo pipefail` inside a `tee` chain stops the script with the failing line scrolled away. Exit 126 is a missing executable bit, 127 is a wrong path, and 143 with no output means that the shell killed its own process group. `pkill -f '<pattern>'` matches the shell that runs the command, because its own command line holds the pattern. Use `ps -eo pid,args | awk -v me=$$ '$2=="sleep" && $1!=me {print $1}'` and discard the scan line itself. Do not chain independent proofs with `&&`. A zero-match `grep -c` exits 1, so append `|| true`. Use `grep -P` for a tab. Run from the cwd, and do not prefix every call with `cd <worktree>`. Derive every fixture path from one variable, never retype it. Sidecars are `<root>/.kanban/.pids/<slug>.pid`, `.exit`, `.system-prompt.md`, and `.analysis.pid`. Run logs are `<slug>.<role>.<n>.log`. Enumerate the names that you created, never a glob. Save the pids as JSON (`writeFileSync(pidsFile, JSON.stringify(savedPids))`) outside the fixture root, never as text lines, because a shell `while read` drops the last line when the file has no trailing newline. Prove cleanup with `kill -0 <pid>` failing on each saved pid and print the count. A process scan is a second opinion: `ps -eo pid,args | awk` anchored on the absolute fixture root. `killTree` only on a parsed pid above 1 that is not your own.

## Repo map

- `src/hub.ts` is the hub (`startHub` returns `{port, close}` or null). `src/webui/page.ts` holds the page shell, the client `render`/`makeCard`, the modal, and all CSS. `src/webui/board.ts` builds the shell, columns, and `cardBaseHtml`. `src/webui/payload.ts` builds task rows (`lightRow`). `src/webui/logpane.ts` renders logs. `src/orchestrator/main.ts` owns flags and timers. `src/orchestrator/pipeline.ts` owns `rescan` and the sweep. `src/orchestrator/liveness.ts` owns the state table and `poll`. `src/orchestrator/spawn.ts` owns argv, exit files, lane slugs, worktree creation, and `ensureContextSymlinks`. `src/pid.ts` owns `agentAlive`, `pidAlive`, and `killTree`. `src/kanban.ts` owns `STATES`, `createTask`, `setState`, `listAll`, and parsing. `src/orchestrator/board.ts` owns `commitKanban`, `showTip`, and `mirrorSubjects`. `src/webui.ts` is a re-export shim. Stable anchors: `#board .card[data-file="<file>"]` and `#m-attrs > div` with a `<span>` label. Copy fixture setup from `tests/helpers.ts`, `tests/orchestrator/daemon.test.ts`, `tests/webui/page.test.ts`, and `tests/webui/hub.test.ts`, but never run them and never import the helpers. Locate a symbol with `rg -l <word> src tests` or `git ls-files | grep <word>`. Never guess a path from a name.

## Playwright

- Import from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. Mermaid UMD is at `/home/phamba/repos/paseo/node_modules/mermaid/dist/mermaid.min.js`. Inject it with `addScriptTag`, call `mermaid.render`, and fail on a page error. Move the mouse to `0, 0` before sampling a style, because `:hover` outranks the active class. Do a viewport round trip after the modal settles. `textContent` reads collapsed `<details>`, and `innerText` does not. Scope selectors to the node that you assert on. Normalize before compare: parse `px` and `rem` to a number, split `stroke-dasharray` on commas and spaces, round geometry to 2 decimals, compare `color-mix()` channels with tolerance, and print the raw value next to the normalized one. Classify DOM nodes from printed `data-*` attributes and counts. Hub routes: `/`, `/api/hub`, `/api/projects`, `/api/tasks`, `/api/task-detail`, `/api/task-history`, `/api/card-stats`, `/api/agent-log`. The registry is `${XDG_CONFIG_HOME:-$HOME/.config}/se-llm-team/se-llm-team-hub.json` and is keyed by root. Prove the socket with `/health` and an anchored `ss -ltn` line.

## Report

- Put the driver, fixtures, and logs under one `/tmp/<t>/` directory, never under the worktree or `.kanban`. Draft the report in `/tmp/<t>/report.md`. Generate the rows from the driver's `RESULT` lines with one node call, never retype a measured number. One lane line, then claim, printed proof, control. Escape every `|` inside a cell as `\|`. Count the columns once, with `perl -ne 'print scalar(split(/\|/)), "\n"'`, because POSIX awk has no lookbehind.
- Append at the end of `# Notes`, before a `# Open questions` section if one exists: `# Notes`, then `## Live test (<date + %F>)`, then the text, then `# Open questions`. Keep the existing bullets, including `Commit`, above the report. Insert with `awk` before the `# Open questions` heading or with a quoted heredoc, never with `edit` or a long `oldText`. The symlink writes through to the main checkout and `.kanban` is gitignored, so prove the append with the heading and the row count, not `git status`.
- Add the assumptions that shaped the checks and a "not exercised" line. Every sentence maps to a printed check, a log quote, or a measured value. A finding must be reachable in default usage and inside the changed path. Close with one call that proves the heading, the row count (`grep -c '^| C[0-9]'`), cleanup (the saved pid count and `kill -0` failing for each), and `git status --short`. When that call prints all four, stop. If a finding exists, end the finish message with the spawn prompt's line. Otherwise state that no findings were found.
