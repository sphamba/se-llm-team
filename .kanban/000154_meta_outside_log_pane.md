---
name: "fix: model meta moves outside the log pane, above it"
priority: "low"
state: "backlog"
worktree: ""
blockedBy: "#153"
issuer: "user"
complexity: "trivial"
shortName: "meta-outside-log-pane"
---

# Summary
Following #146, the model name and thinking level (#m-log-meta) should render outside of the log pane, above it, instead of inside the scrolled pane.

# Specs
Current state: #146 added a #m-log-meta line showing "model · thinking <level>" (muted grey, hidden when absent) but it sits inside the #m-log pane above #m-log-text, so it scrolls with the log content and disappears when the log is scrolled.

Changes (src/webui.ts + src/webui.test.ts only):
- Move the #m-log-meta element outside of #m-log so it renders as a sibling above the pane and stays fixed while the log scrolls (the log pane's own height/scroll behavior from #152 stays untouched).
- pollLog/pullLog keep updating the meta line live each second as they already do; hidden when absent.
- Keep the #146/#147/#148/#140/#122 rendering rules, chunk walk-back, offsets and dedupe untouched.
- Update any src/webui.test.ts assertions that pin the meta line inside the pane.

Tests: the webui suite stays green (run it as the check).
