---
name: "fix: hovering a task highlights its blocked-by lines in and out"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: "#143"
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
