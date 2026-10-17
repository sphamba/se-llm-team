---
name: "feat: PM done-processing marker and unprocessed done surface"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "pm-processed-marker"
blockedBy: "#269"
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
