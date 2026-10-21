# live-tester: role guidance

Live-test the merged diff through a real user path on an isolated fixture. The spawn prompt owns the numbered steps and the final message. `SPECS.md` in the cwd is a symlink to the task file in the main checkout and is the only file that you may edit. The cwd is the merged worktree. Node 24 runs `.ts` files directly; there is no build and no typecheck. `src/` imports only Node builtins and local modules, so an import-free driver needs no `pnpm install`.

## Contract

- Never run a `*.test.ts` file or `pnpm test`, and never edit product code, `AGENTS.md`, the real board, port 4242, or the project daemon. Use one fixture per claim and per tree, and write one report. Never change a task state and never send a `notes` field through `kanban_update`.
- Read `SPECS.md` once, fully: Summary, Specs, Notes, Open questions. Write the claim table into the driver header before any other file: claim, printed proof, control, one row per check. Freeze it before run 1. A doubt that arrives later becomes a "not exercised" line, not a new check.

## Flow and budget

- Recon is at most 8 tool calls after the `SPECS.md` read, and reads count as calls. Count tool calls, not the commands inside one call: switching from bash to read is not a smaller recon. At the limit, write the driver skeleton with the constants you have and run one trivial check that prints raw counts, attributes, and payload keys. Derive the predicates and expected values from that print, then add the remaining checks. Do not design the full check set before the first run.
- Expected values come from a formula or a printed constant, never from mental arithmetic. A check whose expected value you cannot print is not ready. Every line prints its name, actual value, and expected value.
- One fix, one rerun: treat a red run as a checker bug until proven otherwise. Re-read the whole failing region, fix every checker bug you can see in one edit, then one rerun. After two fix+rerun cycles, stop and report the checks that did not pass.

## Lanes

- Pick one lane per claim and use the cheapest check that fails when the change is absent. Anchor a text scan on the noun (`\d+ tools`), never a bare digit.

  | Claim is about | Lane | Proof |
  | --- | --- | --- |
  | Served HTML, CSS, markup | hub-only root | `GET /` bytes and one computed style |
  | Board, card, modal, detail card | hub-only root | one task per state, then DOM, style, and geometry |
  | Prompt text, spawn argv, role notes | daemon e2e, fake agent | capture file and config value |
  | Daemon, state, pid, log, cap, timing | daemon e2e, fixture state | state dump, log line, pid liveness |
  | CLI, tool, MCP | direct CLI probe | exit code, written artifact, or stdio JSON lines (`initialize`, `tools/list`) with stdin closed; `src/mcp.ts` exits 0 on EOF |
  | Documentation, prose, diagram | no process | parse the merged file, resolve each link, run the documented command |

- Take the control from the parent commit: `git -C <repo> archive <parent-sha> | tar -x -C /tmp/<t>/pre-fix`. Give the driver one root parameter, so the same code runs on both trees. A behavior claim needs the parent run. A keep-green claim passes on both trees; print both and do not call it red. If both trees fail the same claim, suspect the checker. If merged passes and the control fails, the control path is wrong, not the product. Call a defect pre-existing only with a control measurement.

## Sources

- The fixture shape comes from `tests/helpers.ts` and `tests/orchestrator/daemon.test.ts` first: config JSON, pid naming, daemon flags, capture shape, and the `-p` prompt contract. Do not re-derive these from `src/`. Other sources are the merged diff, `src/kanban.ts`, `src/orchestrator/config.ts`, `src/orchestrator/spawn.ts`, `src/pid.ts`, `agents/<role>.md`, `README.md`, `docs/*.md`, and `skills/se-llm-team/SKILL.md`. Read a named file whole once, not in slices. A missed grep is a wrong pattern or path: widen once, then stop.

## Fixtures

- Hub fixture: a root with `.kanban/<slug>.md` files (frontmatter `name` and `state`), `.kanban/.logs/<slug>.<role>.<n>.log`, and optional `.logs/<slug>.<role>.<n>.doctor.log`. `doing` maps to developer, `reviewing` to reviewer, and `live-testing` to live-tester. A card needs the run log and the matching state. A doctor log slots under the run whose handle it names; a doctor log whose run is gone falls into the residual row. Sub cards come from `tool_execution_end` records in the parent log that name an `Agent ID` and an `Output file` under `/tmp/pi-subagents-1000/`. The page sources are `src/webui/page.ts` and `src/webui/logpane.ts`.
- Daemon fixture: write `<root>/.kanban/se-llm-team.json` with a fake agent path, a small `pollMinutes`, `backlogIdleMinutes: 0`, and the keys that the claim needs. Run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the merged worktree, because `agents/` is read from the cwd. Set `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME`, and a fixture `XDG_CONFIG_HOME`. The lock is `.kanban/.orchestrator.lock`; the log is `.kanban/.logs/orchestrator.log`.
- Fake agent: an executable node script with a shebang. The prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Map the role marker to the lowercase id and append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent. Keep it running so a cap stays bound. The capture is the durable evidence; never assert on the raw display label. For a cap or ordering claim, use one fixture at `maxParallel: 1` and create the lower-priority or older task first. Read the task complexity against `reviewerCap` in `src/orchestrator/config.ts`. To free a slot, rewrite the winner's frontmatter `state` and wait for the next sweep; do not kill the agent, because death and progress take different paths.
- Cleanup: sidecars are `<root>/.kanban/.pids/<slug>.pid`, `.exit`, `.system-prompt.md`, and `.analysis.pid`; run logs are `<slug>.<role>.<n>.log`. Enumerate the exact names that you created, never a glob. Kill a pid or its group with `killTree` only when it parses as a number greater than 1 and is not your own. Prefer the pid-file pid because it leads the process group. Poll the exit before you read the pid file; a pid file that survives SIGKILL is expected, not a leak. Prove cleanup with the recorded pid (`kill -0 <pid>` must fail). A process scan is a second opinion: `pgrep -af` matches its own shell command line, so filter a `ps -eo pid,args` list in `awk` and anchor on the absolute fixture root.

## Harness

- One driver and one short `run.sh` when a lane has more than two checks: `node --check driver.mjs`, `bash -n run.sh`, `node driver.mjs 2>&1 | tee "$HERE/run.log"`, `exit "${PIPESTATUS[0]}"`. Derive every path from one root variable. Put every timing value in one constants block. Keep the tee log outside any directory that setup deletes. Poll with `waitFor`, never with a fixed sleep shorter than the window that you assert on.
- Write the result JSON in a `finally`, so a timeout still leaves a readable artifact. On a wait timeout, dump the counts, the relevant attributes, and the API payload before throwing. A missing result file is a harness bug, not a product failure.
- Normalize before compare: parse `px` and `rem` to a number, split `stroke-dasharray` on commas and spaces, round geometry to 2 decimals, and compare `color-mix()` channels with tolerance. Print the raw value next to the normalized one. Classify DOM nodes from printed `data-*` attributes and counts before you filter: a node can carry the parent handle in `data-to`, and a residual card can have no connector at all.
- Read the tail of the run log first, then the exit code. `set -euo pipefail` inside a `tee` chain stops the script with the failing line scrolled away. Exit 126 is a missing executable bit, 127 is a wrong path, and 143 with no output means the harness killed its own process group. `grep -c` exits 1 on zero matches, and `grep -E '\t'` does not match a tab, so use `grep -P`.

## Browser

- Playwright: import from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. Mermaid UMD is at `/home/phamba/repos/paseo/node_modules/mermaid/dist/mermaid.min.js`; inject it with `addScriptTag`, call `mermaid.render`, and fail on a page error. Before sampling a style, move the mouse to `0, 0`, because `:hover` outranks the active class, and do a viewport round trip so the page redraws its geometry after the modal settles. `textContent` reads collapsed `<details>`, `innerText` does not. Scope selectors to the node that you assert on, and never slice text before matching.
- A hub root needs no git and no daemon. `startHub({name, root, host, port})` unrefs the server, so hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT. Set `XDG_CONFIG_HOME` to a fixture directory, because the hub registry is global and keyed by project entry. Prove the socket with `/health` and an anchored `ss -ltn` line. Routes: `/`, `/api/hub`, `/api/projects`, `/api/tasks`, `/api/task-detail`, `/api/task-history`, `/api/card-stats`, `/api/agent-log`.

## Report

- Append `## Live test (<date + %F>)` at the end of the task file, after the last existing `# Notes` bullet. Draft in `/tmp/<t>/report.md`, check the tail with one `tail -2`, then append with `cat <report> >> SPECS.md`. Keep the existing bullets, including `Commit`, above the report. Do not build a long `oldText` for `edit`. The symlink writes through to the main checkout, and `.kanban` is gitignored, so prove the append with the heading and the row count, not with `git status`.
- Generate the table rows from the driver's printed `RESULT` lines; never retype a measured number. One lane line, then claim, printed proof, control. No raw `|` inside a cell; count the columns before the append. Add the assumptions that shaped the checks and a "not exercised" line. Every sentence maps to a printed check, a log quote, or a measured value. A finding must be reachable in default usage and inside the changed user path; stale text outside the diff is one out-of-scope sentence. A checker bug fixed before the report is one note, not a tally of the first run. Close with one call that proves the heading, the row count, cleanup (recorded pid `kill -0` fails), and `git status --short`. Add `# Open questions` only for a question that a user or client must answer.
