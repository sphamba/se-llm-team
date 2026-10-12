---
name: "fix: hovering a task highlights its blocked-by lines in and out"
priority: "medium"
state: "live-testing"
worktree: "fix/144-hover-highlights-relations-both-ways"
blockedBy: ""
issuer: "user"
complexity: "simple"
shortName: "hover-highlights-relations-both-ways"
---

# Summary
Hovering a task card highlights all of that task's blocked-by relation lines, both the lines going out of the task (toward its blockers) and the lines going in (from tasks it blocks), instead of only the outgoing ones.

# Specs
Current behavior (task #127 part 3, merged): makeCard wires el.onmouseenter/onmouseleave to hotRelations(file, on) (src/webui.ts:1118-1125, hotRelations :1137-1140), which toggles .relations-hot (stroke-opacity .8 over the .3 base, transition .15s ease at :938-939) on every #relations path whose data-file === file. Paths are built in drawRelations (:1161) from relationPaths (:802-817) which push { file: t.file, d: curve(...) } keyed ONLY by the blocked task's file, so hovering a blocker card lights nothing (its incoming lines are keyed by the other cards' files).

Fix, src/webui.ts plus src/webui.test.ts only:
- relationPaths carries both endpoints: keep data-file (the blocked task) and add data-blocker (the blocker's file) in the path attributes at drawRelations, so each path knows both tasks it connects.
- hotRelations toggles .relations-hot when p.dataset.file === file OR p.dataset.blocker === file, so hovering highlights the outgoing and incoming lines of that task in one style (.relations-hot unchanged).
- The hover wiring survives the 5s refresh (makeCard rebuilds), pointer-events none and the dash animation stay untouched, and the #127 one-way tests get extended to both directions.

Tests: extend the flat assertion script - a path between a blocker and a blocked task carries both data attributes; hotRelations for the blocked file highlights the path, hotRelations for the blocker file highlights the same path, an unrelated file highlights nothing; existing relation/hover assertions stay green.

# Notes
- relationPaths pushes { file, blocker, d } and drawRelations emits data-file plus data-blocker on each #relations path, so every curve knows both tasks it connects. hotRelations toggles .relations-hot when p.dataset.file === file || p.dataset.blocker === file: hovering either endpoint card raises the shared lines, mouseleave on either reverts. Hovering an unrelated card never un-highlights another card's lines, matching the per-card wiring.
- hotRelations, makeCard and drawRelations are client code inside the PAGE template literal, not module scope, so hotRelations cannot be imported. The test extracts it from the served page's <script> with the existing regex + new Function pattern and runs it against a one-path document stub.
- Tests: a relationPaths blocker-field assert, the functional hover test (blocked on, off, blocker on, off, unrelated file highlights nothing) and updated page-level asserts for the OR condition and the data-blocker attribute. node src/webui.test.ts, src/kanban.test.ts and src/extension.test.ts all pass.
- Committed 16635b1 on fix/144-hover-highlights-relations-both-ways. No open questions.
- Review: the diff matches the Specs exactly. relationPaths pushes { file, blocker, d } with blocker always set (the find and rectOf checks guard each push). drawRelations emits data-file plus an esc'd data-blocker. hotRelations ORs dataset.file and dataset.blocker. The .relations-hot rule, pointer-events none, and the dash animation stay untouched. makeCard wires the hover on each rebuild, so the wiring survives the 5s refresh. The test regex is correct: the inner closing brace is tab-indented, so \n\} matches only the function close. Only src/webui.ts and src/webui.test.ts changed. node src/webui.test.ts, src/kanban.test.ts, and src/extension.test.ts all pass in the worktree. No fixes needed; moving to to-live-test.
