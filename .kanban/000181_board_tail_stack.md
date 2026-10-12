---
name: "feat: board stacks to-live-test, live-testing and done in one column group"
priority: "medium"
state: "reviewing"
worktree: "feat/181-board-tail-stack"
issuer: "user"
complexity: "simple"
shortName: "board-tail-stack"
blockedBy: ""
---

# Summary
In the webui board, stack the to-live-test, live-testing and done states together as one stacked column group (they are all non-blocking for the backlog), keeping the current per-state accent colors.

# Specs

## Change
- pairLayout (src/webui.ts:921) currently leaves the first state (backlog) and last state (done) single and pairs the middle two by two, so the layout is backlog | [to-do,doing] | [to-review,reviewing] | [to-merge,merging] | [to-live-test,live-testing] | done.
- Change pairLayout so the final three states stack together as one group: first state single, pair the middle states two by two while more than three states remain, then stack the remaining tail (here to-live-test over live-testing over done) as the final group. Generic on the state list, no state-specific wiring (the pairLayout(STATE_NAMES) === LAYOUT test contract stays).
- buildShell already renders any stacked group as one .pair wrapper with the columns inside (src/webui.ts:1068-1077), and the CSS .pair is a flex column, so a triple needs no CSS change; each column keeps its .col c-<state> accent color, so the current colors stay.
- syncBoard, cardHtml, the #157 pipeline order (to-merge/merging before to-live-test/live-testing), relation lines, spinner markup and all existing rendering rules stay unchanged.

## Tests
- src/webui.test.ts: update the LAYOUT assertion (:488) to expect ["backlog", ["to-do", "doing"], ["to-review", "reviewing"], ["to-merge", "merging"], ["to-live-test", "live-testing", "done"]]; pairLayout(STATE_NAMES) === LAYOUT and the every-state-gets-a-column assertions must still pass.

# Notes
- Filed by the PM (user request, 2026-10-12). Runs parallel to the in-flight #178 (cardHtml) and #179 (src/kanban.ts): different functions/regions of src/webui.ts, so real merge-conflict risk is low per the standing parallelism order.
- The number 000180 was taken by a concurrently filed finding task (race unit test rescan path), so this file took the next free number.
- Implemented in the worktree (commit c5d7d6f): pairLayout now pairs two by two while more than three states remain after backlog, then stacks the remaining tail (to-live-test over live-testing over done) as the last group. No state-specific wiring, no CSS change (.pair is a flex column, columns keep their .col c-<state> accent colors).
- Updated the webui.test.ts assertions: LAYOUT, the boardEl children structure (done no longer a side column) and the pair wrappers test. Both webui.test.ts and index.test.ts pass.

# Open questions

None. Assumptions made (confirm or correct before live-test):
- The stacked tail group keeps pipeline order top to bottom: to-live-test above live-testing above done.
- All existing webui behavior beyond the column layout (syncBoard, cardHtml, relations, spinner, fold toggles) stays unchanged.
- No webui version bump or changelog entry is needed for this visual layout change.
