---
name: "feat: PM done-processing marker and unprocessed done surface"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "pm-processed-marker"
blockedBy: ""
---

# Summary
Verification only: once #269 (marker tool + unprocessed scope) and #270 (catch-up report + delete cleanup) have landed, verify the pinned marker-path contract held end to end and the full suite passes.

# Specs
Verification scope only - the pieces are #269 (marker tool + unprocessed scope) and #270 (catch-up report + delete cleanup).

Pinned contract that must hold end to end: the PM-processed marker of a task is the empty side-file .kanban/.logs/<task file name minus the .md extension>.pm-processed (taskSlug; e.g. .kanban/.logs/000268_pm_processed_marker.pm-processed). #269 writes it (kanban_mark_processed) and reads it (kanban_list scope=unprocessed via the kanban.ts pmProcessedPath helper); #270 reads it (report.ts catch-up fold at the first sweep after daemon start) and removes it (board.ts removeTask). Check exactly one path shape everywhere: report.ts and board.ts read/remove the same path the kanban.ts helper builds (both sides pinned the convention independently).

Checks once both landed:
- kanban_mark_processed exists in the TOOLS record, rides the generic pi and MCP registration (13 tools), and marks only done tasks.
- kanban_list scope=unprocessed returns unmarked done tasks only.
- The first sweep after daemon start reports a done task with no marker; a marked done task is not re-reported; later sweeps report only new done transitions.
- kanban_delete removes the marker with the task.
- The report's PM instructions mention the mark flow.
- Tests: #269's new test file and #270's sweep.test.ts part N extension pass; pnpm test passes.

Out of scope (unchanged): the analysis .exit accumulation (#267), REPORT_MAX_AGE_MS, any task-file frontmatter change.
Post-landing step (PM, not part of any subtask): one batch kanban_mark_processed call marks the current done stock so the catch-up rule starts clean, promptly after this task reaches done and before the next daemon restart.

# Notes
- Blocked: #269 (marker tool + unprocessed scope) and #270 (catch-up report + delete cleanup) have not landed. This worktree is identical to main (0 commits ahead, 0 behind), so the pinned contract has no anchors to verify: no pmProcessedPath helper and no kanban_mark_processed tool in src/kanban.ts, no scope=unprocessed handling, and no PM-processed marker read in src/orchestrator/report.ts or removal in src/orchestrator/board.ts. tests/ holds no PM-processed assertion.
- Baseline assert count: 1877 across tests/*/*.test.ts. tests/orchestrator/sweep.test.ts has part N (one report per done sweep) but no PM-processed catch-up extension.
- No files changed and nothing committed. The verification run repeats once #269 and #270 reach main.
- Unblocked and verified: #269 (c19fc2c) and #270 (cfb11c2) landed on main, so this worktree fast-forwarded 995b317 -> 747ab05 (zero local commits, no files changed, nothing to commit).
- Pinned marker path holds everywhere: src/kanban.ts pmProcessedPath builds join(kanbanDir(root), ".logs", taskSlug(file) + ".pm-processed"), with taskSlug stripping only the .md suffix; src/orchestrator/report.ts (catch-up read) and src/orchestrator/board.ts (removeTask delete) build the same join independently, and src/tools.ts kanban_mark_processed writes through the helper. sweep.test.ts pins the read (part N catch-up) and the delete (part AG) with a hand-built path, so the contract is verified from the outside, not read back from src.
- kanban_mark_processed rides the generic Object.entries(TOOLS) registration in index.ts (pi) and src/mcp.ts (MCP); tests/mcp.test.ts pins the 13 tool names; tests/tools.test.ts pins empty marker, idempotence, skipped missing and not-done files, and scope=unprocessed (done unmarked only).
- kanban_delete routes to removeTask, which deletes the marker with the task file (part AG asserts the marker is gone).
- First-sweep catch-up: an unmarked done task is folded into one report at daemon start, a marked done task is not, and later sweeps report only new done transitions; composeReport's PM instructions name kanban_mark_processed. Part N and its catch-up extension assert all of this.
- Suite (run in /tmp/verify268): tests/tools.test.ts, tests/mcp.test.ts, all 13 tests/orchestrator/*.test.ts, all 6 tests/kanban/*.test.ts, all 5 tests/webui/*.test.ts exit 0. Deviation: the spec asked for pnpm test; per project test policy this run is the scoped set covering every changed module (kanban.ts maps to orchestrator+kanban+webui; tools.ts/report.ts/board.ts map to tools, mcp and the sweep area file). The remaining full-suite files (index, extension, plugin, context-symlinks, efficiency-analysis) map to no changed file.
- The post-landing PM batch mark of the current done stock (then a daemon restart) stays with the PM, as the spec states.
- Re-review at 747ab05: prior claims hold. Pinned marker path confirmed at src/kanban.ts:76 (pmProcessedPath, taskSlug strips only .md), read at report.ts reportDone and deleted at board.ts removeTask:140 with the same independent join, write-through at src/tools.ts:225; sweep.test.ts pins both sides with a hand-built path (part N catch-up, part AG delete).
- Registration: kanban_mark_processed rides the single generic Object.entries(TOOLS) registration at src/mcp.ts:46; the earlier "index.ts (pi)" site names a nonexistent file (src/ has no other TOOLS consumer), so the registration is the generic MCP one and tests/mcp.test.ts pins the 13 names. Minor Notes inaccuracy, verdict unchanged.
- Suite re-run (none recorded with a sha): all 26 files exit 0 on the current tree - tests/tools.test.ts, tests/mcp.test.ts, all 13 tests/orchestrator/*.test.ts (analysis, hub, log fast; the ten daemon suites serial), all 6 tests/kanban/*.test.ts, all 5 tests/webui/*.test.ts. The fast-forward also carries 747ab05, a tests/orchestrator/poll.test.ts-only commit (12 lines, test-only, covered by the poll suite).
- No fixes committed; the pinned contract held end to end.

## Live test (2026-10-17)

- Environment: merged worktree cbe76d9 (carries #269 c19fc2c and #270 cfb11c2), fixtures under /tmp/268-lt. The unit suites were not run, per the live-test policy: the production surface that the named tests pin was exercised instead.
- Tool surface through the real pi extension (`pi -p --mode json -ne -e index.ts` with the real HOME, fixture board): one session ran kanban_list scope=unprocessed, kanban_mark_processed on a done task and on a not-done task, kanban_list again, and kanban_delete. 11 checks, 0 failed. The list returned exactly the one unmarked done task, the mark wrote .kanban/.logs/000901_lt_pm_done_a.pm-processed and left the task file, the not-done task was skipped and named in the result, the second list was empty, kanban_delete removed the task file and its marker, and the marker of an untouched done task survived.
- Registration: the real MCP stdio server tools/list returns 13 tools, kanban_mark_processed included, and the names equal Object.keys(TOOLS) from the merged src/tools.ts. 5 checks, 0 failed.
- Daemon catch-up (isolated HOME, rescan 1 s, poll 0.05 min): the first sweep queued one report that names the unmarked done task LT-REPORT-A and not the marked LT-REPORT-B, and the PM instructions name kanban_mark_processed. A done task created after the first sweep produced a second report with only the new task; LT-REPORT-A was not reported again. 7 checks, 0 failed.
- Finding (minor, pi UI metadata): the pi registration passes label: undefined for kanban_mark_processed. index.ts maps labels for the other 12 tools only, and ToolDefinition.label is a required string. The tool still registers and executes (verified above), so the contract holds; only the UI label is missing.
- The earlier Notes bullet that questions the "index.ts (pi)" registration site is inaccurate: the repo-root index.ts is the pi entry, and loading it with `-e index.ts` registered and executed the tool.
- Total 23 checks, 0 failed. Assumptions: the fixture uses the real .kanban layout and file names; report expectations were read from the report files on disk; "13 tools" was counted from Object.keys(TOOLS) and the MCP tools/list reply; the MCP probe sent tools/list without an initialize handshake, which the server accepts. No observed behavior contradicts the task assumptions.
