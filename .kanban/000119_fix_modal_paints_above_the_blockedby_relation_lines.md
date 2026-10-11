---
name: "fix: modal paints above the blockedBy relation lines"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The blockedBy relation lines paint on top of the modal overlay and detail card because #relations has z-index 1 and #modal has none. Give #modal a z-index above both so the dark overlay and the task details card paint above the lines.

# Specs
In the webui the blockedBy relation lines (SVG overlay #relations) paint on top of the dark overlay and the task details card. Cause: src/webui.ts:717 gives #relations z-index 1 while #modal (src/webui.ts:760, position:fixed inset 0) has no z-index (auto), so the lines paint above the modal; #tabs already needed z-index 1 for the same reason (the 000091 fix, comment at src/webui.ts:708). Fix: give #modal a z-index above #relations and #tabs (e.g. z-index: 2 in the #modal rule), so the backdrop and the detail card paint above both. Keep #relations pointer-events: none and its dash animation untouched. Extend src/webui.test.ts: a source assert that the #modal rule carries a z-index greater than #relations'. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes; the webui lane is free (#118 is backlog, blocked by #52).

# Notes
