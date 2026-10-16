---
name: "chore: drop the browser notifications feature"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "drop-notifications"
---

# Summary
Remove the #244 browser notifications feature entirely: the state-change notification diffing, the header opt-in control, and the webUi.notifications persistence, on top of current HEAD.

# Specs
Decision (user, 2026-10-16): drop the #244 browser notifications feature. The user's complaint batch made the webui unusable and the notifications are part of what goes.

Requirements:
1. Remove the notification diffing, the header opt-in control and the webUi.notifications persistence from src/webui/page.ts (the feature shipped in commit 41d8073; remove it on top of current HEAD, which also carries #245/#247 follow-ups).
2. No notification UI, no Notification permission prompt, and no webUi.notifications config key remain.
3. Keep the rest of the page unchanged: theme toggle, staleness wake check (#235), and all #242-#245 features stay.

Acceptance:
- node tests/webui.test.ts passes.
- Live test: no notification control remains in the header and no browser notification fires on task state changes.

# Notes
