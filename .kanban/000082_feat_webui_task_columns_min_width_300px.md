---
name: "feat: webui task columns min-width 300px"
priority: "medium"
state: "doing"
worktree: "feat/82-webui-task-columns"
---

# Summary
Set the min-width of the webui task columns to 300px (currently 200px), so columns never get narrower than 300px.

# Specs
Set the webui task column min-width to 300px (user request; scheduled immediately on the user's order).

Facts (verified on current main):
- .col CSS (src/webui.ts:339): .col { ... min-width: 200px; flex: 1 0 200px; }
- No test asserts the 200px value.

Changes:
1. .col min-width 200px -> 300px, and the flex basis 200px -> 300px to match, so a column never starts narrower than 300px.
2. Everything else on #board (horizontal scroll, 10px gaps, accent borders) stays unchanged; the stacked-pair layout (#47, in main) is unaffected.

Acceptance:
- Task columns never render narrower than 300px.
- Typecheck and the full test suite pass: node src/webui.test.ts.

Constraints:
- Files: src/webui.ts.
- Same file as the active webui lanes (000039 to-do, 000068 live-testing, 000077/000076 queued); different regions, so a minor sequential merge is expected.

# Notes
