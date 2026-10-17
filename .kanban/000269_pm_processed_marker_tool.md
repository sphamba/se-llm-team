---
name: "feat: PM done-processing marker tool and unprocessed scope"
priority: "medium"
state: "done"
worktree: ""
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
- Review 2026-10-17, base main...HEAD at 1edd56a: pass. Moved to to-merge.
  - pmProcessedPath at src/kanban.ts:77-79 has the exact pinned shape: join(kanbanDir(root), ".logs", taskSlug(file) + ".pm-processed"). It sits next to kanbanDir. kanban.ts does not import log.ts, so no cycle.
  - Scope "unprocessed" is in the union at src/kanban.ts:20. listTasks uses a switch at src/kanban.ts:212-221. Unprocessed = state done and no marker file. The other scopes keep the old behavior. listTasks has one caller, the kanban_list tool (src/tools.ts:78).
  - kanban_mark_processed at src/tools.ts:205-233: files is required, getTask resolves each entry, missing and not-done tasks are skipped and named, the marker is an empty idempotent file, mkdirSync recursive makes .kanban/.logs on a fresh board, the board comes from ctx.cwd.
  - kanban_list scope enum and description name scope=unprocessed (src/tools.ts:69-81).
  - tests/mcp.test.ts lists 13 tool names with kanban_mark_processed (tests/mcp.test.ts:95-110).
  - New tests/tools.test.ts: 15 asserts, fixture() + cleaned.push(root), node:assert/strict. It covers the marker write, skip naming, idempotent re-mark, unprocessed exclusion, not-done never returned, and the pinned marker path.
  - Gitignore: the repo .gitignore ignores .kanban/ whole, so the marker path is ignored.
  - Tests: scoped union green, 10 suites exit=0 (6 tests/kanban suites, mcp, extension, tools, orchestrator/poll). Full pnpm test not run per the reviewer ban; the Spec Run line records the deviation.
  - Commit 1edd56a (poll.test.ts cooldown-count scoping) rides the branch outside the own-files list. Test-only change; its suite is green.
  - Open questions settled: getTask appends .md to an extensionless entry (src/kanban.ts:229-232), so that assumption holds. mkdirSync recursive covers a fresh board. Section removed.

## Live test (2026-10-17)

- Surface: the merged extension in a real pi session (`pi -p --mode json`, real HOME, cwd = a fixture board repo) plus one direct import probe of the merged `src/tools.ts` and `src/kanban.ts`. The installed extension symlink points at the main checkout, and the main checkout HEAD equals the worktree HEAD 747ab05, so the session ran the merged code.
- Result: 17 precheck checks and 23 session checks, all passed; the pi process exited 0.
- `kanban_mark_processed` is registered (13 tools in TOOLS) and marks a done task with the empty pinned marker `.kanban/.logs/000269_fixture_done.pm-processed`. Its result names the marked file and the skipped files in order: `Marked processed: 000269_fixture_done.md. Skipped (missing or not done): 000270_fixture_todo.md, 000271_fixture_missing.md`.
- A not-done task and a missing file are skipped and named. A second mark of the same done task is idempotent (same result, `none` skipped). An extensionless file name resolves to the same `.md` file and writes the same marker.
- `kanban_list` with `scope=unprocessed` returned only the unmarked done task, and excluded the marked done task and the not-done task. The returned row carried `state: "done"`. The scopes `done`, `in-progress` and `backlog` kept their old results.
- No board change: after the session the fixture git HEAD was unchanged, `git status --porcelain` was empty, the task files were byte-identical, and `git check-ignore` named the fixture `.gitignore` for the marker.
- Technical note: the pi session surfaced the extension tools through `tool_search`, so its JSONL held a leading `tool_search` call before the four kanban calls. The first check pass counted that call and showed 14 script failures. The checks now filter tool records by the `kanban_` name prefix, and the same session JSONL passes 23 of 23 checks.
- Assumptions: the fixture board tracks its task files and ignores `.kanban/` like the real repo, so "no board commit" is observable. The 1h report prune survival is the sibling path in `src/orchestrator/report.ts` and was not exercised here.


