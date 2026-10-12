---
name: "fix: log block bodies wrap to fit the container width"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "log-blocks-wrap"
---

# Summary
Expanded tool and thinking blocks in the log UI do not wrap: `#m-log-text pre` (src/webui.ts:1268) carries no white-space declaration, so the UA `pre { white-space: pre }` applies and long lines overflow the pane. The block bodies must wrap to fit the container width.

# Specs

## Change
- Extend the existing rule at src/webui.ts:1268 to `#m-log-text pre { font: inherit; margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: break-word; }`, covering the expanded thinking and tool block bodies (details.lg-think / details.lg-tool pres) and nested fenced code emitted by md(); collapsed summaries are unaffected, expanded ones wrap.
- Keep everything else untouched: the #147 Inter/monospace rules, the pane's own pre-wrap (:1267), the #122/#140 collapsed blocks, the #146 meta line, streaming and the chunk walk-back.

## Tests
- src/webui.test.ts: the existing assertion at :836 (page includes "#m-log-text pre { font: inherit;") must still pass; add an assertion that the rule carries white-space: pre-wrap and overflow-wrap: break-word.

# Notes
- Extended the rule in src/webui.ts to `#m-log-text pre { font: inherit; margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: break-word; }` as specified.
- Added the test assertion for the full rule (white-space: pre-wrap and overflow-wrap: break-word) after the existing "#m-log-text pre { font: inherit;" assertion in src/webui.test.ts.
- Committed as 7c9d25f in the worktree. All test files pass (webui, index, extension, kanban, orchestrator). One orchestrator smoke failed once on a timing-sensitive reconcile assertion; it passes on re-run on the clean base and with the change, so it is flaky and unrelated.
- Assumptions: the fix targets only the expanded block bodies (collapsed summaries already wrap via #m-log-text) and no selector or behaviour outside the one rule changes.
- Review: the diff is exactly the spec (one rule, one test line). Coverage verified in src/webui.ts: tool args/output pres (:387-390), thinking pres (:395, :519) and md() fenced code (:350) are all pres inside #m-log-text; the #147 monospace rules (:1290), the details > pre indent (:1272) and the pane pre-wrap (:1267) are untouched. Assumption is already stated in Notes, not silent.
- Reviewer merged main (c38a37b: the #176 chip-spacing fix and a docs commit) into the branch as 4f8f2ea; main had moved past the merge-base 7b392511. Clean auto-merge, no conflicts; npm test passes on all five suites after the merge.
- No fixes needed beyond the base merge.
- Merge: step 1 (base main into the branch in the worktree) was already up to date; the reviewer's 4f8f2ea had merged main at c38a37b and main had not moved since. No conflicts, so no test suites re-ran per the clean-merge rule. Step 2 (branch into base main at the project root) was a clean fast-forward c38a37b..4f8f2ea. Verified on main: the full rule at src/webui.ts:1268 and the test assertion at src/webui.test.ts:838.
- Live test (pass, no findings): ran the merged commit 4f8f2ea served by a hub-only fixture (isolated root + HOME, port 5499, real src/webui.ts) with a synthetic developer log: a thinking block (prose, a 320-char unbroken token, a fenced code line of a 320-char token) and a tool block (300-char args, 700-char result), all unbroken tokens. Real user flow in Chromium: board, task card, developer agent card, click the Thinking and tool summaries to expand.
- Expanded blocks: all four pres (thinking body, nested fenced-code pre, pre.lg-args, pre.lg-out) computed white-space: pre-wrap and overflow-wrap: break-word, scrollWidth == clientWidth, and fit inside the pane; #m-log had no horizontal overflow. Same result at 1200 px and 420 px viewport width. The screenshot shows the long tokens wrapped over multiple lines.
- Positive control: re-injecting the pre-fix rule (`#m-log-text pre { white-space: pre; overflow-wrap: normal; }`) made every pre overflow by 1845-8454 px and the pane by 8444 px; removing the injected rule restored wrapping. The test therefore detects the bug the fix removes.
- Collapsed state unaffected: both details still default closed and their summaries render (Thinking, and the tool one-liner). No git-tracked file was touched; fixture and processes cleaned up.
- Live-test assumptions: the change is CSS-only, so the dashboard modal with a synthetic log is the user-visible surface; wrap is measured as no overflow of each pre and of the pane at two widths. Test-method note: Chromium keeps layout geometry for a closed details' children (paint-skipped), so the collapsed check asserts details closed + summary visible, not zero-size children.
- No open questions; nothing contradicted the task's assumptions.

# Open questions
