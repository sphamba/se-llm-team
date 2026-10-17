---
name: "feat: PM done-processing marker and unprocessed done surface"
priority: "medium"
state: "to-do"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "pm-processed-marker"
---

# Summary
The done-notification channel has no durable marker for "PM processed this task's follow-ups", and a done transition while the daemon was dead never reports (reportDone seeds from the first post-restart snapshot). Add a .logs/<slug>.pm-processed side-file written by a new batch kanban_mark_processed tool, a kanban_list scope=unprocessed surface, and a startup catch-up report for done tasks with no marker.

# Specs
Goal: done tasks get marked as processed by the PM, unprocessed done tasks are visible in the kanban tools, and a done transition missed while the daemon was dead is reported at the next daemon start.

Background (audited 2026-10-17): the daemon queues one board report per done sweep in .kanban/.reports/ (src/orchestrator/report.ts; reportDone invoked from pipeline.ts:420), but reportDone's lastDone map (report.ts:67-79) seeds from the first post-restart snapshot, so done transitions while the daemon was dead never report. No durable per-task marker says "PM processed this task's follow-ups". All 12 tools live in the TOOLS record in src/tools.ts:46-280, registered generically in index.ts:44-58 and shared with the MCP host (src/mcp.ts imports TOOLS). kanban_list's scope is a 3-value union Scope (kanban.ts:22) consumed by listTasks's ternary (kanban.ts:269-273). .kanban/.logs/ is gitignored and follows the <name>.count convention (counterPath, log.ts:9).

Decided plan (grill-me, user-confirmed 2026-10-17):

1. Marker: .kanban/.logs/<slug>.pm-processed, an empty side-file per done task. Gitignored like the rest of .logs/, survives the 1h report prune, no task-file format change, no board commit per mark.

2. New tool kanban_mark_processed in the TOOLS record (src/tools.ts): params files: string[] (one or more task file names). For each: resolve the task, only mark tasks in state done (skip others and list them in the result), write .kanban/.logs/<slug>.pm-processed (empty file). Idempotent: re-marking rewrites. Rides the generic registration (index.ts:44-58) and the MCP host import with no extra wiring. The tool resolves its board to ctx.cwd like the other kanban tools.

3. kanban_list scope=unprocessed: extend the Scope union (kanban.ts:22) with "unprocessed" and turn listTasks's ternary (kanban.ts:269-273) into a switch. Unprocessed = tasks in state done with no marker file. The tools.ts kanban_list scope enum (tools.ts:52) gains the value.

4. Catch-up report, startup only: in reportDone (report.ts:71-88), when lastDone is being seeded (first sweep after daemon start), fold done tasks with no marker file into finished in the composed report, so a done transition missed while the daemon was dead is reported at the next start. Later sweeps report only new done transitions via lastDone, so an unmarked task is never re-reported on every 10 s sweep; the kanban_list unprocessed scope covers it until marked.

5. Report instructions: the "Instructions for the Project manager" section (report.ts:28-31) gains a line: after processing, mark the done tasks processed via kanban_mark_processed, so future PM sessions know the flow.

6. kanban_delete (removeTask, src/orchestrator.ts) also removes the task's marker file when it exists.

Tests:
- tests/orchestrator/sweep.test.ts part N (report channel): a done task with no marker at daemon start is reported at the first sweep; a done task with a marker is not.
- A tools test for kanban_mark_processed: marks a done task, skips a not-done task and names it in the result, idempotent on re-mark.
- A list test for scope=unprocessed: unmarked done tasks are returned, marked done tasks are excluded, not-done tasks are never returned.

Acceptance: the new/extended test files pass and pnpm test passes.

Out of scope: the analysis .exit accumulation (janitor task #267), changing the report delivery cutoff (REPORT_MAX_AGE_MS), and any frontmatter change to the task file.

Post-landing step (PM, not part of this task): one batch kanban_mark_processed call marks the current done stock so the catch-up rule starts clean. Do it promptly after this task reaches done, before the next daemon restart.

# Notes
