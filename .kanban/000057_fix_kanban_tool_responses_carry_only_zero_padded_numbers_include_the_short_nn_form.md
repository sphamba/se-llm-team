---
name: "fix: kanban tool responses carry only zero-padded numbers - include the short #NN form"
priority: "medium"
state: "live-testing"
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

- [2026-10-11 09:05] Implemented in worktree commit 24d3719: exported taskNum(file) from src/kanban.ts (leading 6 digits, 0 fallback for non-numbered names) and reused it in createTask numbering; all four kanban tool responses (create/update/set_state/set_worktree) now carry both the file name and (#NN); kanban_list entries and the tool description gain num. Checks: node kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass (webui.test spawns its own daemon with isolated HOME and port 0, so it runs without the no-webui override). No real tsc installed; typechecked src/kanban.ts + src/kanban.test.ts with typescript 5.9.3 strict from another local project: only the two pre-existing errors in untouched replaceSections code, error set identical to main.
- [2026-10-11 09:13] Reviewed commit 24d3719: conforms to specs. All four tool outputs carry file (#NN) consistently, kanban_list entries and description gain num, kanban_get untouched; createTask refactor (n > 0 filter) behaviorally equivalent for max+1 numbering. Verified independently: kanban/orchestrator/webui tests all pass; tsc strict (es2023, typescript from paseo) on src/kanban.ts + src/kanban.test.ts shows only the two pre-existing errors identical to main. Note, not a defect: src/orchestrator.ts:601 keeps a local taskNum with MAX_SAFE_INTEGER fallback (sort ordering); pre-existing and out of scope per the file-set constraint (disjoint from active lanes #56/#63). No fixes; state -> to-live-test.
