---
name: "feat: webui task columns min-width 300px"
priority: "medium"
state: "done"
worktree: ""
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

- Changed src/webui.ts:339: `.col` min-width 200px -> 300px and flex basis 1 0 200px -> 1 0 300px. No other change.
- Checks: `node src/webui.test.ts` passes, `node src/kanban.test.ts` passes, `node src/orchestrator.test.ts` passes. Typecheck is not possible: the repo has no TypeScript dependency and no build step, so no local `tsc` exists. The change is inside a CSS template string, thus it has no type effect.
- Commit in worktree: bdfced0 "feat: set webui task column min-width to 300px".

## Review (2026-10-10)

- Diff matches the Specs exactly: src/webui.ts:339 `.col` min-width 200px -> 300px and flex basis `1 0 200px` -> `1 0 300px`; one line, one file, worktree clean apart from that commit.
- Re-ran all checks myself: `node src/webui.test.ts`, `node src/kanban.test.ts`, `node src/orchestrator.test.ts` all pass.
- Verified 300px cannot be undercut: `.col` (src/webui.ts:339) is the only width rule for board columns, no media query or stacked rule overrides it, no inline style writes a width (only transform/transition), and no second column implementation exists in src/ or index.ts. No test asserts the width, as the task notes said.
- Spec inaccuracy (not fixed, nothing to fix in this diff): the Specs claim "the stacked-pair layout (#47, in main)". Main has no `.pair` rule (`git grep pair main -- src/webui.ts` is empty). The #47 work is uncommitted in `.worktrees/feat/47-webui-stacked-column`, where `.pair` and `.col` still carry 200px (its src/webui.ts:447-448). So this merge cannot break #47 and #47 must raise `.pair` to a 300px floor when it lands, otherwise its 200px pair wrapper holds 300px columns that overflow. Out of scope here: main has no such rule and other worktrees must not be touched.
- No fixes made, state set to to-live-test.

## Live test (2026-10-11)

- Ran the dashboard from this worktree like a user: `startWebUi` on 127.0.0.1:4399 with the main checkout's board, opened in headless Chromium (system Google Chrome via Playwright). One CSS line in a template string, so this covers the whole user-visible effect.
- Acceptance PASS: 8 state columns render at 300.0px each at a 1280px viewport (computed `min-width: 300px`, `flex: 1 0 300px`); every column stays >= 300px at viewports 400/800/1024/1440/1920/2560/3200; columns grow above 300px only when there is spare width (306.75px each at 2560, 386.75px at 3200); the board scrolls horizontally (content 2506px at 1280px viewport) and the last column is fully reachable by scrolling at 800px; all columns stay on one row; widths hold after expanding a column with "show all".
- User flows PASS: clicking a card opens the detail modal, the Close button and a backdrop click close it, the modal fits an 800px viewport, the theme toggle flips light/dark, no JavaScript errors.
- Project checks pass in the worktree: `node src/webui.test.ts` and `node src/kanban.test.ts`.
- Merge safety: `git merge-tree --write-tree main feat/82-webui-task-columns` gives a clean tree holding both the 300px `.col` and main's 000068 `renderLogChunk` blank-line fix, so this branch (based before 000068) merges without dropping main's change.
- Finding (pre-existing, unrelated, reported to PM): Escape does not close the task detail modal. src/webui.ts has no keydown/Escape handler on main or in this branch; only the Close button and a backdrop click close it.
- Finding (pre-existing, unrelated, cosmetic, reported to PM): GET /favicon.ico returns 404, so every page load logs one console 404; the page declares no icon link.
- Verdict: change accepted, no fixes needed, state set to done.
