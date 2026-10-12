---
name: "fix: webui board columns show the old review -> live-test -> merge order"
priority: "low"
state: "done"
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

- Reordered STATES in src/kanban.ts so to-merge/merging precede to-live-test/live-testing; reordered the IN_PROGRESS set to match (membership only, order is cosmetic).
- Reordered the --ac accent class declarations in src/webui.ts to the same pipeline order (a test asserts they are declared in pipeline order).
- Updated src/webui.test.ts: the LAYOUT assertion, the buildShell pair assertion, and the local STATE_NAMES list all encoded the old order.
- Full suite passes: kanban, orchestrator, extension, webui. Committed de2c5e9 in the worktree.
- Review: verified independently. STATES has only three consumers (kanban.ts:149 validation includes-check, kanban.ts:171 IN_PROGRESS Set membership, webui.ts:802 pairLayout) and only the layout is order-sensitive, so the reorder is safe. The webui.ts accent reorder was in fact required: webui.test.ts:459 asserts the accent classes are declared in pipeline order. The other two "pipeline order" mentions in webui.test.ts (lines 972, 1138) are agent-row/log tie-break ordering, untouched and unaffected. All four suites pass in the worktree. No fixes needed.
- Merge: step 1 merged main into fix/157-webui-columns-pipeline-order in the worktree; clean merge with the ort strategy (main side touched README.md, SPECS.md, agents/*, skills/se-llm-team/SKILL.md, src/orchestrator.ts and src/orchestrator.test.ts, no overlap with the fix files), no conflicts, so the test suites were skipped per the merge procedure. Step 2 merged the branch into main in the project root as a fast-forward to 42b6e50 (src/kanban.ts, src/webui.ts, src/webui.test.ts). No fixes needed; nothing to resolve.

## Live test (2026-10-12)

Result: PASS for the merged code in a fresh process. One finding on the long-running hub. The unit suites were not run.

Setup:
- The production hub at http://localhost:4242 (pid 3381383, started 13:31:13) is older than the merge into main (42b6e50 at 13:37:07). The production daemon owns this live-test session as a child process, so a restart would kill the live tester and the sibling agents. I did not restart it.
- I ran the merged checkout in an isolated daemon instead. Root /tmp/live157/board (git repo, 2 scratch cards), project config `.kanban/se-llm-team.json` with `webUi` on 127.0.0.1:4399, isolated HOME=/tmp/live157/home (own hub registry and lock), and `agent=/tmp/live157/fake-pi` (a sleep wrapper, so the test spends no LLM tokens). The change touches only the webui layout, so agent identity does not affect the result.
- The browser flow used real Chromium through Playwright on the real dashboard. The cards moved through the real daemon transitions: to-review spawned a reviewer and set reviewing, to-merge spawned a merger and set merging, and to-live-test spawned a live tester and set live-testing.

Checks on the fresh daemon (merged code):
- Rendered headers, left to right: backlog | to-do/doing | to-review/reviewing | to-merge/merging | to-live-test/live-testing | done. Each pair shares one x. x(to-merge)=948 is less than x(to-live-test)=1258, so the order is the new pipeline order.
- Served LAYOUT: `["backlog",["to-do","doing"],["to-review","reviewing"],["to-merge","merging"],["to-live-test","live-testing"],"done"]`.
- Card movement: the scratch card moved reviewing (x=638) -> merging (x=948) -> live-testing (x=1258). Every step moves the card to the right. With the old order the to-merge step would have moved it to the left. Screenshots: /tmp/live157/board-initial.png and /tmp/live157/board-livetesting.png.

Finding on the production hub (new task for the Project manager):
- The running hub still serves the old order after the merge. A user who opens http://localhost:4242 now sees to-live-test/live-testing (x=948) before to-merge/merging (x=1258), and the served LAYOUT is the old one. A card that goes reviewing -> to-merge -> to-live-test still moves backwards on the live dashboard. Screenshot: /tmp/live157/production-board.png.
- Cause: the served CSS accents ARE in the new order (`.c-to-merge` before `.c-to-live-test`), so the hub webui hot reload from #134 DID re-import src/webui.ts. However, the static import of src/kanban.ts stayed in the Node module cache with the pre-merge STATES, so the reloaded webui.ts computed the old LAYOUT. #134 reloads only webui.ts, and its review note that a webui.ts mtime bump re-imports "the real module graph" does not hold for kanban.ts.
- Impact: a STATES or pipeline-order change that lands while a daemon runs stays invisible in the live dashboard until the daemon restarts. I left the production daemon running: it is the parent of this live-test session, and in this environment several leaked daemons from earlier live tests still use the global webUi port 4242, so a hub restart races them for the global hub lock and one of them can bind 4242 with old code before the production daemon returns.
- Correction (2026-10-12): an earlier draft said a daemon restart kills in-flight child agents (developer, reviewer, live-tester, merger). That is wrong. spawnAgent spawns role agents detached and unref'd (src/orchestrator.ts:277-286), and the exit handler SIGKILLs only in-flight git push children (src/orchestrator.ts:1361-1364), so role agents survive a daemon stop.

Assumptions for the usage tests:
- The pipeline order under test is reviewing -> to-merge/merging -> to-live-test/live-testing (from the Summary and #155), so to-merge/merging must be the pair directly after reviewing.
- A fresh daemon on the merged checkout is equivalent to what a user gets after a daemon restart, so it is a valid place to verify the fix.
- Observed behavior that contradicts the stated task assumptions: on a long-running daemon the STATES reorder alone does not change the served layout (see the finding above).

# Open questions

None.