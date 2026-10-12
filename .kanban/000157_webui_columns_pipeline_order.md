---
name: "fix: webui board columns show the old review -> live-test -> merge order"
priority: "low"
state: "live-testing"
worktree: "fix/157-webui-columns-pipeline-order"
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

- Reordered STATES in src/kanban.ts so to-merge/merging precede to-live-test/live-testing; reordered the IN_PROGRESS set to match (membership only, order is cosmetic).
- Reordered the --ac accent class declarations in src/webui.ts to the same pipeline order (a test asserts they are declared in pipeline order).
- Updated src/webui.test.ts: the LAYOUT assertion, the buildShell pair assertion, and the local STATE_NAMES list all encoded the old order.
- Full suite passes: kanban, orchestrator, extension, webui. Committed de2c5e9 in the worktree.
- Review: verified independently. STATES has only three consumers (kanban.ts:149 validation includes-check, kanban.ts:171 IN_PROGRESS Set membership, webui.ts:802 pairLayout) and only the layout is order-sensitive, so the reorder is safe. The webui.ts accent reorder was in fact required: webui.test.ts:459 asserts the accent classes are declared in pipeline order. The other two "pipeline order" mentions in webui.test.ts (lines 972, 1138) are agent-row/log tie-break ordering, untouched and unaffected. All four suites pass in the worktree. No fixes needed.
- Merge: step 1 merged main into fix/157-webui-columns-pipeline-order in the worktree; clean merge with the ort strategy (main side touched README.md, SPECS.md, agents/*, skills/se-llm-team/SKILL.md, src/orchestrator.ts and src/orchestrator.test.ts, no overlap with the fix files), no conflicts, so the test suites were skipped per the merge procedure. Step 2 merged the branch into main in the project root as a fast-forward to 42b6e50 (src/kanban.ts, src/webui.ts, src/webui.test.ts). No fixes needed; nothing to resolve.

# Open questions

None.

Assumptions:
- The new pipeline order is reviewing -> to-merge/merging -> to-live-test/live-testing, so to-merge/merging renders as the pair before to-live-test/live-testing on the board.
- Reordering IN_PROGRESS and the CSS accent declarations alongside STATES is in scope, since both mirror the pipeline order and one test asserts the accent declaration order.