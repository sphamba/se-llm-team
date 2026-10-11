---
name: "fix: content-driven column heights in the stacked pairs; drop the fixed height floor"
priority: "medium"
state: "live-testing"
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

## Developer notes
- Commit c1ab268 on fix/96-content-driven-column (base main 4d79759, unchanged during the work); file src/webui.ts only, two added lines.
- Change: `.pair .col { flex: 0 0 auto; }` directly after the `.col` rule (line 491), with a short comment. Inside a `.pair` (column flex) the basis now acts on the block axis and sizes the column to its content. The direct child `.col` rule keeps `flex: 1 0 300px`, so backlog/done stay 300px wide side columns. No markup, LAYOUT, count, empty-marker or cap change.
- #72 hold: #72 was in reviewing when this work started (commit b5e8466 on feat/72-issuer-attribute-on, one commit on the same base). Its diff does not touch the `.pair` or `.col` CSS rules, so the HOLD condition (one webui rewrite at a time) is met and no conflict is expected in either merge order.
- Suite: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all green. No test change was needed.
- Environment note: without an isolated HOME, the orchestrator llm-config-flags smoke fails on the unmodified base too (actual developer flags include `--provider RCP`, which comes from the machine-global ~/.pi/agent/se-llm-team.json; the test fixture declares no provider). This is pre-existing and not caused by this change. The run with a temp HOME makes all three suites green.
- Browser check (headless Chrome over CDP against startWebUi on a temp board, ephemeral port, production webui untouched): with 5 cards in to-do and 1 in doing, the fixed CSS gives to-do 413px, doing 117px, all empty stacked columns 62px, side columns 62px high and 300px wide. Re-injecting the old `flex: 1 0 300px` gives 300px for doing and for every empty stacked column, the reported floor. So stacked columns grow with content and shrink to the header when empty, and the side columns are unchanged.

## Reviewer notes
- Review of commit 7e4683a on fix/96-content-driven-column. The diff against main is two added lines in src/webui.ts only: the `.pair .col { flex: 0 0 auto; }` rule and its comment.
- Spec check passes. Change 1 is present. The row-direction `.col` rule keeps `flex: 1 0 300px`. The LAYOUT, the markup, the counts, the empty marker and the show-all cap are untouched. The file constraint holds (src/webui.ts only).
- Rebase: main had moved to 35ba118 when the review started (per-run agent logs, plus the HOME isolation in the orchestrator llm-flag test), while the developer branch was based on 4d79759. The unre-based branch failed the llm-config-flags smoke on this machine through the ambient `~/.pi/agent/se-llm-team.json` (`--provider RCP` in the actual flags). The rebase onto 35ba118 resolved that and had no conflicts. The developer change itself is unchanged.
- Tests on the rebased branch with the normal HOME: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all green. No test update was needed.
- Independent browser check (headless Chrome through Playwright, startWebUi on a temp board with 5 cards in to-do and 1 in doing): the new rule gives to-do 391px, doing 117px, every empty stacked column 62px, and the side columns 62px high and 300px wide. Re-injecting `flex: 1 0 300px` for `.pair .col` floors doing and every empty stacked column at 300px. This matches the developer measurement and the acceptance.
- Merge check: `git merge-tree --write-tree main HEAD` is clean. The merge with feat/72-issuer-attribute-on auto-merges src/webui.ts without a conflict. The only conflict between those branches is src/orchestrator.test.ts, and that conflict is #72 against main, not this task.
- No fixes were made during the review. No open questions.
