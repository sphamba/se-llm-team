---
name: "fix: log pane text at card text size; log height 70vh"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: "#151"
issuer: "user"
complexity: "simple"
shortName: "log-text-size-log-height"
---

# Summary
The agent log text renders too small next to the rest of the task card, and the log pane is too short. Make the log text the same size as the card's other text and grow the log pane height to 70vh.

# Specs
Changes (src/webui.ts + src/webui.test.ts only):
- The log pane text (#m-log-text and its pre/code children) renders at a smaller size than the card's body text today; drop the smaller font-size so the log text matches the card text size exactly (line-height may stay tuned for logs, only the size must match).
- The log pane height (#m-log or its scroll container, currently capped well below the viewport) grows to 70vh so long logs show more content.
- Keep markdown rendering, the Inter/monospace font rules from #147, the #122/#140 collapsed-block rules, the model meta line from #146, chunk walk-back, offsets, dedupe and live streaming untouched.
- Update any src/webui.test.ts assertions that pin the old font-size or height values.

Tests: the webui suite stays green (run it as the check); assert the new height value and the absence of a smaller log font-size where the existing CSS regexes are.
