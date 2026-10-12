---
name: "fix: webui board columns show the old review -> live-test -> merge order"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#155"
complexity: "simple"
shortName: "webui-columns-pipeline-order"
---

# Summary
The web dashboard still lays out the pipeline columns in the old order, so with the new pipeline a card moves backwards on the board (reviewing -> to-merge -> to-live-test). Fix the stacked pair order so to-merge/merging comes before to-live-test/live-testing.

# Specs
Found in the live test of #155.

The web dashboard still lays out the pipeline columns in the old order. src/webui.ts computes LAYOUT = pairLayout(STATES) and src/kanban.ts STATES still lists to-live-test, live-testing before to-merge, merging, so the rendered columns are:

backlog | to-do/doing | to-review/reviewing | to-live-test/live-testing | to-merge/merging | done

With the new pipeline a card goes reviewing -> to-merge (rightmost pair) -> to-live-test (one pair left), so it moves backwards on the board.

# Change

Fix the pair order so to-merge/merging comes before to-live-test/live-testing. STATES order is used only for this layout and for state validation (src/kanban.ts line 149), so it is safe to reorder, but src/webui.test.ts line 389 asserts the current LAYOUT and must be updated with it.

# Acceptance

`node src/webui.test.ts` passes.

# Notes
