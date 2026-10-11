---
name: "fix: kanban tool responses carry only zero-padded numbers - include the short #NN form"
priority: "medium"
state: "doing"
worktree: "fix/kanban-tool-responses-carry-only-zero-padded-numbers-include-the-short-nn-form"
---

# Summary
The PM echoes task references from the kanban tool responses, which show only zero-padded numbers (000042). Include the short form #42 alongside, so the PM and users naturally use #NN. SKILL.md needs no change - it references no numbers.

# Specs
Facts:
- The tool text responses name tasks with zero-padded numbers: kanban_create returns "Created 000054_....md", kanban_set_state returns "000044_....md: state -> to-do", kanban_update/kanban_set_worktree similar; kanban_list returns file/name/summary per task.
- skills/se-llm-team/SKILL.md references no task numbers (verified) - no change needed there.

Changes:
1. src/kanban.ts: export taskNum(file: string): number - parse the leading 6 digits of the task file name (NaN-safe fallback).
2. index.ts: append the short form to the kanban tool text outputs - kanban_create: "Created 000054_....md (#54)"; kanban_set_state/kanban_update/kanban_set_worktree: "#54: ..." or the file plus (#54), consistent across the four; kanban_list entries gain num: 54; kanban_get keeps the full detail (file already present).
3. Tests (src/kanban.test.ts): taskNum parses the leading digits and falls back safely.

Acceptance: typecheck and the full test suite pass; kanban_create and kanban_set_state responses show both the file name and (#NN); kanban_list entries carry num.

Constraints:
- Files: src/kanban.ts, index.ts, src/kanban.test.ts. Disjoint from all active lanes (#54, #50, #49, #56, #36).

# Notes
