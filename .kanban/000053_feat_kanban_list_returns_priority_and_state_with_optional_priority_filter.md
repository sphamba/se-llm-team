---
name: "feat: kanban_list returns priority and state, with optional priority filter"
priority: "high"
state: "to-do"
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
