---
name: "fix: kanban tool responses carry only zero-padded numbers - include the short #NN form"
priority: "medium"
state: "done"
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

- [2026-10-11 09:17] Live test passed with one finding (pre-existing, not from this change). Ran the worktree extension (commit 24d3719) like a user: pi -p (RCP/GLM 5.3 Flash) in a scratch git repo, only kanban tools enabled via -e <worktree>/index.ts -t 'kanban_*'. kanban_create returned "Created 000001_fix_raw_capture.md (#1)"; second create numbered 000002 (#2) (max+1 numbering intact); kanban_list entries carry num: 1 and the tool description reads "Returns file, num (#NN), name, priority, state and summary"; kanban_update returned "Updated ... (#1)"; kanban_set_state returned "000001_... (#1): state -> to-do"; kanban_get kept the full detail with file present. kanban_set_worktree errored with ReferenceError "setWorktree is not defined" whenever called: index.ts:126 calls setWorktree but never imports it from src/kanban.ts. Verified pre-existing: main checkout index.ts has the identical missing import, so the tool has been broken on main too and the failure is unrelated to the #NN change (the branch's diff only touched the response text). All other acceptance points met; state -> done, one finding reported to the PM.

- [2026-10-11 09:30] Review pass, no fixes: diff touches exactly the three spec'd files; taskNum matches spec (leading 6 digits, parseInt stops at non-digits, NaN -> 0); all four responses (create/update/set_state/set_worktree) carry file + (#NN) consistently; kanban_list entries + tool description gain num; createTask reuse of taskNum keeps numbering (n > 0 filter equivalent to !isNaN for max+1). Re-verified in worktree: kanban/orchestrator/webui tests all pass; strict typecheck (ts 5.9.3, es2023 lib) error set identical to main, all pre-existing environmental (@types/node, lib) or in untouched code. Acceptance met.

- [2026-10-11 09:20] Review passed, no fixes. Diff of 24d3719 matches all spec points: taskNum exported with NaN-safe fallback and reused in createTask numbering (filter n > 0 equivalent to the old NaN filter); all four tool responses carry file name plus (#NN) consistently; kanban_list entries and description gain num; kanban_get untouched; tests cover taskNum parse, fallback, and listTasks num. Orchestrator.ts keeps its own private taskNum with a MAX_SAFE_INTEGER fallback for sort ordering (different semantics, and orchestrator.ts is out of the allowed file set). Checks re-run in the worktree: kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass. State was already moved to live-testing by another session during the review, so no state write from this review.
- [2026-10-11 09:05] Implemented in worktree commit 24d3719: exported taskNum(file) from src/kanban.ts (leading 6 digits, 0 fallback for non-numbered names) and reused it in createTask numbering; all four kanban tool responses (create/update/set_state/set_worktree) now carry both the file name and (#NN); kanban_list entries and the tool description gain num. Checks: node kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass (webui.test spawns its own daemon with isolated HOME and port 0, so it runs without the no-webui override). No real tsc installed; typechecked src/kanban.ts + src/kanban.test.ts with typescript 5.9.3 strict from another local project: only the two pre-existing errors in untouched replaceSections code, error set identical to main.
- [2026-10-11 09:13] Reviewed commit 24d3719: conforms to specs. All four tool outputs carry file (#NN) consistently, kanban_list entries and description gain num, kanban_get untouched; createTask refactor (n > 0 filter) behaviorally equivalent for max+1 numbering. Verified independently: kanban/orchestrator/webui tests all pass; tsc strict (es2023, typescript from paseo) on src/kanban.ts + src/kanban.test.ts shows only the two pre-existing errors identical to main. Note, not a defect: src/orchestrator.ts:601 keeps a local taskNum with MAX_SAFE_INTEGER fallback (sort ordering); pre-existing and out of scope per the file-set constraint (disjoint from active lanes #56/#63). No fixes; state -> to-live-test.
- [2026-10-11 09:15] Review passed, no fixes. Verified against specs: taskNum exported from src/kanban.ts (leading 6 digits, NaN fallback 0, reused by createTask numbering via map(taskNum).filter(n > 0)); all four kanban tool responses in index.ts carry the file name plus (#NN) in a consistent pattern; kanban_list description and TaskRef/listTasks entries gain num; kanban_get untouched as specified. TaskRef has no other construction sites, so the new required num field breaks nothing. Checks rerun in the worktree: kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass; typechecked src/kanban.ts + src/kanban.test.ts with typescript 5.9.3 strict, error set identical to main (only pre-existing untouched-code errors, lines shifted). Diff touches exactly the three allowed files.
