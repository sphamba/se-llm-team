---
name: "fix: content-driven column heights in the stacked pairs; drop the fixed height floor"
priority: "medium"
state: "doing"
worktree: "fix/96-content-driven-column"
---

# Summary
The #47 merge left every stacked column with a 300px height floor (the .col flex basis applies to the height axis inside a .pair). Columns must grow with their content again, while the column stacking stays.

# Specs
Facts (main after the #47 merge, verified): #board :488 is a flex row with gap 10px, align-items flex-start; .pair :490 is a column flex (min-width 300px, flex 1 0 300px); .col :491 has flex: 1 0 300px - as a .pair child the basis applies to the block (height) axis, flooring each stacked column at 300px (the old pre-merge floor was 200px). As a direct #board child (backlog, done) the same basis acts as width. The merge raised .pair to 300px per the live-tester's overlap warning (200px pairs overflowed their 300px columns by ~89px).

Changes:
1. `.pair .col` gets a content-driven flex (for example `flex: 0 0 auto`, or an equivalent that does not floor the height; exact rule the developer's choice), so stacked columns grow with their content and shrink to the header when empty.
2. The row-direction `.col` (backlog and done, direct children of #board) keeps `flex: 1 0 300px`: the width behavior and the single full-height side columns are unchanged.
3. Column stacking is unchanged: one .pair wrapper per stacked pair (four middle pairs in STATES order), backlog and done single side columns; counts, headers, the empty-column marker, and the show-all cap untouched.

Tests: the existing suite must pass (node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts); no test asserts the height value, so no test updates are expected.

Acceptance: stacked columns are content-height (small when empty, growing as cards fill), the four middle pairs and the two side columns render as before, full suite green.

Constraints:
- Files: src/webui.ts only.
- HOLD behind #72 (doing on feat/72-issuer-attribute-on, rewrites src/webui.ts + test): one webui rewrite at a time.

# Notes
