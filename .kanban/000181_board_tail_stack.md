---
name: "feat: board stacks to-live-test, live-testing and done in one column group"
priority: "medium"
state: "live-testing"
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
- Review (2026-10-13): implementation matches the specs. The diff touches only pairLayout, its doc comment and the webui.test.ts assertions; buildShell already renders any-length stacked groups and .pair is a flex column, so the triple needs no CSS change. Verified against the code, the developer's three assumptions all hold: the tail slice keeps STATE_NAMES order and .pair renders first-on-top (to-live-test, live-testing, done); nothing outside pairLayout/tests changed; no CHANGELOG.md or version scheme exists to bump. Reviewer fix (commit 46d695b): removed the provably dead `pair.length > 1 ? pair : pair[0]` guard in the pairing loop (tail.length - i > 3 always leaves a full pair); webui.test.ts and index.test.ts re-passed.
- Merge (2026-10-13): both steps clean, nothing to resolve. Step 1 (merge main into feat/181-board-tail-stack in the worktree) was already up to date (merge-base == main tip 8ea9467), so no test suites ran per the clean-merge rule. Step 2 (merge feat/181-board-tail-stack into main in the project root) fast-forwarded main 8ea9467 -> 46d695b (src/webui.ts, src/webui.test.ts). No conflicts, no fix commits.

# Open questions

None.
