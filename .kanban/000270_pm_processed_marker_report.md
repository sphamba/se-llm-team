---
name: "feat: PM done-processing marker catch-up report and delete cleanup"
priority: "medium"
state: "doing"
worktree: "feat/270-pm-processed-marker-report"
issuer: "#268"
complexity: "simple"
shortName: "pm-processed-marker-report"
---

# Summary
The orchestrator side of the PM done-processing marker: the first sweep after daemon start reports done tasks with no marker (catch-up for a done transition missed while the daemon was dead), the report instructions teach the PM the mark flow, and kanban_delete removes the marker with the task.

# Specs
Goal: a done transition missed while the daemon was dead is reported at the next daemon start, the report teaches the PM the mark flow, and kanban_delete removes a deleted task's marker.

Contract (pinned verbatim, shared with the sibling subtask #269): the PM-processed marker of a task is the EMPTY side-file .kanban/.logs/<task file name minus the .md extension>.pm-processed (taskSlug; e.g. .kanban/.logs/000268_pm_processed_marker.pm-processed for 000268_pm_processed_marker.md). #269 writes this exact path from its own code (kanban_mark_processed), so never rename or reshape it. Read it inline with taskSlug + join (taskSlug is already exported by src/kanban.ts - no dependency on #269's new helper, so merge order does not matter).

Own only these files (your whole diff): src/orchestrator/report.ts, src/orchestrator/board.ts, tests/orchestrator/sweep.test.ts. Other areas (the mark tool, the unprocessed list scope) are #269's; do not touch src/kanban.ts, src/tools.ts or tests/mcp.test.ts.

1. src/orchestrator/report.ts, reportDone (lines ~67-88): when lastDone is being seeded (the first sweep after daemon start, the !seen branch), fold done tasks with no marker file into finished in the composed report, so a done transition missed while the daemon was dead is reported at the next start. Later sweeps report only new done transitions via lastDone, so an unmarked task is never re-reported on every 10 s sweep (the unprocessed list scope covers it until marked).
2. src/orchestrator/report.ts, composeReport: the "Instructions for the Project manager" section (lines ~28-31) gains a line: after processing, mark the done tasks processed via kanban_mark_processed, so future PM sessions know the flow.
3. src/orchestrator/board.ts, removeTask (line ~135): also remove the task's marker file when it exists.
4. tests/orchestrator/sweep.test.ts, part N (the PM report part, lines 12-54): extend it with the catch-up - a done task with no marker at daemon start is reported at the first sweep; a done task with a marker (writeFileSync the marker by hand) is not. Extend part N in place; do not touch the file's import lines (existsSync, writeFileSync, join are already imported) and keep every existing assert (baseline: 45 "assert." occurrences; yours must not drop one).

Run: pnpm test (full) must pass; pnpm test:changed for your touched files.
Out of scope: the mark tool and the unprocessed list scope (#269), the analysis .exit accumulation (#267), REPORT_MAX_AGE_MS, any task-file frontmatter change.

# Notes
