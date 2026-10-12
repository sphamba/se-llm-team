---
name: "fix: log block bodies wrap to fit the container width"
priority: "medium"
state: "merging"
worktree: "fix/175-log-blocks-wrap"
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

# Open questions
