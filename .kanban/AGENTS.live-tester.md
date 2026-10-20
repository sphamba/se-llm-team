# live-tester: role guidance

Live-test the merged diff through a real user path on an isolated fixture. Never run a `*.test.ts` suite. Never touch the real board, port 4242, or the project daemon. Never edit product code. The one exception is the task file in SPECS.md. One fixture, one run, one report.

## Pick the lane

- Pick the lane from the claim in one line. Served text, CSS, or markup: hub-only root, the `GET /` bytes, and one computed style. Board or modal behavior: hub-only root, one task per state, then DOM, style, and geometry checks. Prompt or spawn argv: daemon e2e with a fake agent. Daemon, state, pid, or log: daemon e2e with fixture state and pid liveness. CLI or tool surface: direct CLI probe and the artifact it writes. Use the cheapest check that FAILS when the change is absent. One control per claim, maximum.
- Recon is read SPECS.md, the tests under `tests/`, and the helper file. Nothing else. A behavior question is cheaper to answer with one fixture run and a state dump than with product reads. Do not read `pipeline.ts`, `main.ts`, `board.ts`, `config.ts`, or `spawn.ts` to predict what a run will show. If a grep misses, run one `grep -rn <name> src/`, then stop. If a path or layout doubt appears, resolve it with one command (`readlink -f`, `ls -la`) before you reason about it, because `.kanban`, `AGENTS.md`, and `SPECS.md` are often symlinks and the board is a shared real directory.

## Freeze before the first run

- Before the first run, write the claim-to-check table in the driver header. One line per check: the claim, the printed proof (state, log line, pid), and at most one control per claim. Then write the whole lifecycle. A green tally that includes the control ends the test.
- Do not add a scenario after the first tally. A scenario added after a green run costs a rewrite, a rerun, and a stale-comment pass. If a new doubt appears, write it in the report as not exercised, not as code.
- Run the control from an extracted parent commit, not a second worktree: `git -C <repo> archive <parent-sha> | tar -x -C /tmp/<t>/pre-fix`. This needs no registration, branch, or lock. Prove it with one `existsSync` of an entry file. Give the driver a `scriptRoot` parameter so the control and the fixed run share one scenario function.

## Fixture

- The harness shapes already exist. `tests/helpers.ts` exports `fixture()`, `runDaemon()`, `waitFor()`, `freePort()`, `killAll()`, and `cleanupAll()`. `src/pid.ts` exports `pidPath()`, `pidEntry()`, `pidAlive()`, `agentPid()`, and `killTree()`. `tests/orchestrator/daemon.test.ts` shows the fake-agent fixture end to end. Copy those shapes, do not invent a harness.
- Daemon launch: write `<root>/.kanban/se-llm-team.json` with `agent` set to the fake agent path, a small `pollMinutes`, and the config keys the claim needs. Then run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the merged checkout, because `agents/` is read from cwd. Set `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME`, and a fixture `XDG_CONFIG_HOME`. The lock is `<root>/.kanban/.orchestrator.lock` and the log is `<root>/.kanban/.logs/orchestrator.log`. Do not grep for these paths.
- A fake agent is an executable node script that appends one JSON line of `argv`, `cwd`, and pid to a capture file, then keeps running. Role context and prompt files exist only between spawn and exit, so read the capture, never post-run state. Spawn argv is config data, so read the config, never the prompt.
- Fixture git: `git init -q`, then set `user.email`, `user.name`, and `commit.gpgsign false` inside the fixture, or pass `-c commit.gpgsign=false` to each commit. The real global config signs, and an unsigned fixture commit dies with "no secret key" after the setup already ran.

## Run discipline

- Scale the lifecycle to the lane. A daemon or CLI lane needs one driver and a five-line `run.sh`: `node --check driver.mjs`, `bash -n run.sh`, `node driver.mjs 2>&1 | tee $HERE/run.log`, `exit "${PIPESTATUS[0]}"`. The `setup.sh` plus launcher split is for hub lanes, which need a live process and a port probe. Derive every path from one root variable, and keep the tee log outside every directory that setup deletes.
- Put every timing value in one constants block at the top of the driver. Shorten observation windows to fit the run, never the production gate value, or a latency claim becomes meaningless. Prefer `waitFor` polling to a fixed `sleep`, and never sleep shorter than the window you assert on.
- Write the driver with the write tool, never a heredoc. Patch it with the edit tool only, using text copied from the file you just read. Anchor an edit on the comment or key above a bare literal, because two lines can share the same literal text. Put one scenario and its runner call in the same edit call. After an edit, read that one region back, then run `node --check`.
- Read the tail of the run log FIRST, then the exit code. `set -euo pipefail` inside a `tee` chain stops the script with the failing line scrolled away. Exit 126 is a missing executable bit, 127 is a wrong path, and 143 with no output means the harness killed its own process group.
- A process or port check must not count its own command. Use `pgrep -af <pattern>` or `grep -v grep`. Read `ss -ltnp` for the pid and cmdline before you report a leak. An unrelated listener is environment, not a fixture defect.
- Cleanup: sidecars live in `<root>/.kanban/.pids/` as `<slug>.pid`, `<slug>.exit`, `<slug>.system-prompt.md`, and `<slug>.analysis.pid`. Enumerate the exact names you created, never a glob, because a glob also matches `.exit` and its first field is a code. Kill the group with `killTree`, and only when the parsed pid is numeric, greater than 1, and not your own. Then prove the daemon exited and the pids are gone, and print that proof.

## Report

- Append `## Live test (<date +%F>)` under the existing `# Notes`. Get the insert point from one `grep -n '^#' <task file>`, draft the section in `/tmp/<t>/report.md`, read it once, then paste it with `oldText` copied from the file. Quote the last printed tally and name the fixture assumptions that shaped the result. After the paste, run one command for the heading plus tail, and one for the tally plus the cleanup proof. Then stop. Never change a task state, and never send a `notes` field through `kanban_update`.
- Every sentence must map to a printed check, a log quote, or a measured value. If a check stopped before a path ran, write "not exercised" and stop, do not explain why it did not run. Say a defect predates the diff only with the measurement that proves it. Classify each failure in one sentence: checker bug, timing, fixture state, environment, or product. A fixture-only failure is a fixture learning, never a finding, and a finding must be reachable in default usage.

## Hub-only lane

- A hub root is `<root>/.kanban/` with task `.md` files, no git and no daemon. Frontmatter needs only `name` and `state`. A card needs the state that maps to the role (`doing` to developer, `reviewing` to reviewer, `live-testing` to live-tester, `doctor` for a doctor card) plus a matching `.kanban/.logs/<slug>.<role>.<n>.log`. A log renders and yields token stats with three record types: a `message_end` user message, `message_update` text deltas, and one `turn_end` with usage per turn.
- `startHub({root, host, port})` from `src/hub.ts` calls `server.unref()`, so a launcher that awaits it exits with nothing bound. Hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT. Set `XDG_CONFIG_HOME` to a fixture dir, because the hub registry is global. Preflight `/api/hub` and record the served commit before any other check, and prove the socket with a `/health` curl plus an anchored `ss -ltn` line. Routes: `/`, `/api/hub`, `/api/tasks`, `/api/task-detail?num=N`, `/api/task-history?num=N`, `/api/agent-log?file=`, and `/api/card-stats`.

## UI traps

- Playwright: import from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. Move the mouse to `0, 0` before you sample a style, because `:hover` outranks active classes. Close the overlay with `#m-close`, and wait for a hidden state with `waitForFunction`. `textContent` reads collapsed `<details>` and `innerText` does not. Compare `color-mix()` channels with tolerance, scope selectors to the node you assert on, and never slice text before matching.
