---
name: "fix: log block bodies wrap to fit the container width"
priority: "medium"
state: "backlog"
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

# Open questions
