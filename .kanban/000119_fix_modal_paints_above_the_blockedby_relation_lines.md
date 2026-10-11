---
name: "fix: modal paints above the blockedBy relation lines"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
The blockedBy relation lines paint on top of the modal overlay and detail card because #relations has z-index 1 and #modal has none. Give #modal a z-index above both so the dark overlay and the task details card paint above the lines.

# Specs
In the webui the blockedBy relation lines (SVG overlay #relations) paint on top of the dark overlay and the task details card. Cause: src/webui.ts:717 gives #relations z-index 1 while #modal (src/webui.ts:760, position:fixed inset 0) has no z-index (auto), so the lines paint above the modal; #tabs already needed z-index 1 for the same reason (the 000091 fix, comment at src/webui.ts:708). Fix: give #modal a z-index above #relations and #tabs (e.g. z-index: 2 in the #modal rule), so the backdrop and the detail card paint above both. Keep #relations pointer-events: none and its dash animation untouched. Extend src/webui.test.ts: a source assert that the #modal rule carries a z-index greater than #relations'. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes; the webui lane is free (#118 is backlog, blocked by #52).

# Notes
Implemented in worktree fix/119-modal-paints-above, commit 7cef488. src/webui.ts: #modal rule now carries z-index: 2, above #relations and #tabs (both z-index 1); the 000091 tab-bar comment extended to record the stacking order. #relations kept pointer-events: none and its dash animation. src/webui.test.ts: source assert compares the served page's #modal and #relations z-indexes and requires modal > relations. Both src/webui.test.ts and index.test.ts pass via node --experimental-strip-types --test (no npm test script exists).

Review (commit 7cef488, worktree fix/119-modal-paints-above): matches the Specs. #modal carries z-index: 2, above #relations and #tabs (both z-index 1). #relations kept pointer-events: none, its dash animation, and the reduced-motion override. The new source assert extracts both z-indexes from the served page and requires modal > relations; its regexes are sound (#modal \{ with a space cannot match #modal.hidden, [^}]* stays inside the one-line rule). The 000091 comment is extended, not rewritten, and now records the full stacking order. Both test files pass; worktree clean, no fixes needed.

Live test (worktree fix/119-modal-paints-above, commit 7cef488): no issues. The real webui module (src/webui.ts) was served on a scratch root with two tasks, one in doing, one in to-do with blockedBy: "#1", so the board draws one relation line. Browser (headless Chromium) flows:
- Relation line is drawn: #relations svg holds 1 path.
- Computed styles on the opened modal: #modal z-index 2, #relations z-index 1 with pointer-events none, #tabs z-index 1. Matches the Specs.
- Paint-order check: with the svg made hit-testable at runtime, elementsFromPoint along all 19 sampled points of the relation line returns the modal first (path wins 0/19, modal wins 19/19). The unfixed page served from the same module (z-index removed at serve time only) returns the path first (path wins 19/19, modal wins 0/19), so the test does detect the bug.
- Pixel check: at the line midpoint under the open overlay the fixed page renders srgb(130,133,143) against the unfixed srgb(156,159,165), the dark overlay now dimming the line.
- User flow: clicking a card opens the detail card (blocked task modal shows blockedBy #1), the overlay covers the board, and the close button hides the modal again. No page errors (the single-project server's /api/projects 404 is the documented normal).
Unit suites were not run in this step.

Merge: base branch resolved as main (root checkout on main, not detached). Step 1 in worktree fix/119-modal-paints-above: git merge main was already up to date, no conflicts, so the test suites were skipped. Step 2 in project root: git merge --no-edit fix/119-modal-paints-above fast-forwarded main ced7e55 to 7cef488 (src/webui.ts and src/webui.test.ts), root clean afterwards. No open questions.
