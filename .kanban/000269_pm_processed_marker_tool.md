---
name: "feat: PM done-processing marker tool and unprocessed scope"
priority: "medium"
state: "reviewing"
worktree: "feat/269-pm-processed-marker-tool"
issuer: "#268"
complexity: "moderate"
shortName: "pm-processed-marker-tool"
---

# Summary
The marker surface of the PM done-processing marker: a new kanban_mark_processed tool writes the per-task side-file marker, and kanban_list gains scope=unprocessed for done tasks with no marker. Carries the shared marker-path helper in kanban.ts.

# Specs
Goal: the PM can mark done tasks processed and can list done tasks that are not yet processed.

Contract (pinned verbatim, shared with the sibling subtask #<sibling>): the PM-processed marker of a task is the EMPTY side-file .kanban/.logs/<task file name minus the .md extension>.pm-processed (taskSlug; e.g. .kanban/.logs/000268_pm_processed_marker.pm-processed for 000268_pm_processed_marker.md). It is gitignored like the rest of .kanban/.logs/, survives the 1h report prune, changes no task-file format and issues no board commit. The sibling reads/removes this exact path in report.ts/board.ts from its own code, so never rename or reshape it.

Own only these files (your whole diff): src/kanban.ts, src/tools.ts, tests/mcp.test.ts, and one NEW test file (e.g. tests/tools.test.ts). Other areas (catch-up report, instructions line, kanban_delete marker cleanup) are the sibling's; do not touch src/orchestrator/report.ts, src/orchestrator/board.ts or tests/orchestrator/sweep.test.ts.

1. src/kanban.ts: add and export pmProcessedPath(root, file) returning join(kanbanDir(root), ".logs", taskSlug(file) + ".pm-processed") next to kanbanDir. It lives here (not in orchestrator/log.ts, where armedPath is the .logs side-file precedent) because kanban.ts must not import log.ts: log.ts imports kanbanDir back, so a helper there would cycle.
2. src/kanban.ts: extend the Scope union (line ~20) with "unprocessed" and turn listTasks's scope ternary (lines ~203-206) into a switch. Unprocessed = state done AND no marker file (existsSync on pmProcessedPath). Every existing scope keeps its exact behavior (the listTasks callers are only src/tools.ts kanban_list; the webui does not use listTasks).
3. src/tools.ts: add kanban_mark_processed to the TOOLS record. params: files: string[] (one or more task file names), required. For each: resolve the task via getTask, skip one that is missing or not in state done and name it in the result text, otherwise write the marker (empty file, idempotent rewrite). The result names what was marked and what was skipped. Rides the generic registration in index.ts and the MCP host import with no extra wiring; resolves the board to ctx.cwd like the other kanban tools.
4. src/tools.ts: the kanban_list scope enum gains "unprocessed"; the kanban_list description mentions scope=unprocessed (done tasks with no PM-processed marker).
5. tests/mcp.test.ts: the tools/list names array (12 names, lines ~96-110) gains "kanban_mark_processed" (13 names) - without this edit pnpm test fails here.
6. NEW test file: a tools-level test for kanban_mark_processed (marks a done task's marker, skips a not-done task and names it in the result, idempotent on re-mark) and a list test for scope=unprocessed (unmarked done tasks returned, marked done tasks excluded, not-done tasks never returned). Build the fixture with fixture() + cleaned.push(root) from tests/helpers.ts; node:assert/strict like tests/kanban/*.

Run: pnpm test (full) must pass; pnpm test:changed for your touched files.
Out of scope: the catch-up report, the report instructions line and the kanban_delete marker cleanup (sibling), the analysis .exit accumulation (#267), REPORT_MAX_AGE_MS, any task-file frontmatter change.

# Notes
- No-split decision (2026-10-17): this task does not parallelize. Every cut shares files. The tool in tools.ts imports pmProcessedPath from kanban.ts, so a tools.ts-only subtask does not compile until the kanban.ts piece merges. The new test file covers both the list scope and the tool, so no side owns it alone. A scope-vs-tool cut makes both subtasks edit kanban.ts and tools.ts, so it conflicts at merge. The work is small (one helper, one scope member, one tool, one test file). One developer pass is faster than two reviews, two merges, and two live tests. No state change; the developer starts on this task as-is.

# Open questions
- Assumption: a files entry without the .md extension (e.g. "000042_name") resolves through getTask and marks the .md task's marker path.
- Assumption: kanban_mark_processed creates .kanban/.logs when missing (recursive mkdir), so a fresh board works before the daemon ever made the dir.
