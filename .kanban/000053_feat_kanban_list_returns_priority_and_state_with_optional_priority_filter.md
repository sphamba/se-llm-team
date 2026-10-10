---
name: "feat: kanban_list returns priority and state, with optional priority filter"
priority: "high"
state: "done"
worktree: ""
---

# Summary
The PM must order backlog tasks by priority but kanban_list returns only file, name and summary, forcing manual greps of .kanban/*.md frontmatter. Return priority and state per task and accept an optional priority filter.

# Specs
Exact changes:
- src/kanban.ts: TaskRef interface (~line 30) gains priority and state. listTasks (~line 104) maps priority and state through instead of stripping them, and takes an optional priority argument applied after the scope filter.
- index.ts: kanban_list tool (~line 32) gains optional priority param (low/medium/high/critical), passes it to listTasks, and its description mentions the priority/state fields and the filter.
- Tests (src/kanban.test.ts): listTasks returns priority and state per task; the priority filter returns only matching tasks and combines with scope.

Acceptance: typecheck and the full test suite pass; kanban_list with scope=backlog and priority=high returns only high-priority tasks, each with priority and state set.

Ceiling: no priority sort in listTasks - the caller orders visually. Add sorting only if a caller needs it.

# Notes

- [2026-10-10 23:30] Implemented per specs in worktree feat/kanban-list-returns-priority-and-state-with-optional-priority-filter (commit 6160719). src/kanban.ts: TaskRef gains priority and state; listTasks(root, scope, priority?) maps priority/state through and filters by priority after the scope filter (no sort, per the ceiling). index.ts: kanban_list gains an optional priority StringEnum param, passes it to listTasks, description mentions the priority/state fields and the filter. Tests: listTasks returns priority/state per task; the filter returns only matching tasks alone (backlog high/medium, done high empty) and combined with scope (in-progress high, in-progress low empty).
- [2026-10-10 23:30] Checks: no real tsc installed (nvm bin has the deprecated npm stub, as noted in task 000043). Ran all three test files with node v24.20.0 native type stripping: kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass. Typechecked src/kanban.ts with a typescript 6.0.3 binary from another local project plus its @types/node (strict): only two pre-existing strict-mode errors in untouched replaceSections/createTask code, identical on main. index.ts typecheck needs @types/node and the pi-ai/pi-coding-agent/typebox deps this repo does not install; skipped, diff introduces no new type surface beyond the listTasks signature.
- [2026-10-10 23:55] Review passed, no fixes. Diff matches the specs exactly. Verified: Priority and TaskState types exist in src/kanban.ts and the `Priority | string` filter parameter follows the existing createTask input convention (src/kanban.ts line 238). Only index.ts consumes TaskRef; webui.ts uses full Task objects via listAll, so the TaskRef shape change breaks no caller. Re-ran all three test files: pass. Spot-checked the parseTask default: a task without a priority in frontmatter defaults to medium, matches the medium filter, and is excluded by the high filter. No sort in listTasks, per the ceiling.
- [2026-10-11 01:39] Live test passed, no issues. Drove listTasks from the worktree against the real board (root /home/phamba/repos/se-llm-team): scope=backlog returns 10 tasks, each with exactly file, name, priority, state, summary. Counts match a raw frontmatter grep: backlog low 5, medium 4, critical 1, high 0; 12 high total = 2 in-progress (000044, 000053) + 10 done. Filter combines with scope: in-progress high = 2, done high = 10. An invalid priority value returns 0 tasks, no crash.
- [2026-10-11 01:39] Ran the real tool flow through pi headless on a scratch board with only the worktree extension loaded (--no-extensions -e index.ts): scope=backlog priority=high returns only the high-priority task with priority and state set (acceptance met); unfiltered scope=backlog returns all backlog tasks; a task with no priority in frontmatter defaults to medium. Re-ran the full test suite from the worktree: kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass (exit 0).
