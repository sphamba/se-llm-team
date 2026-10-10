---
name: "feat: webui spinner on cards being worked on"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
In the webui, show a spinner on task cards while an agent works on the task: states doing (Developer), reviewing (Reviewer), and live-testing (Live-tester).

# Specs
Add a spinner to task cards in the active-work states.

Changes (src/webui.ts):
- In render(), add a spinner element to cards whose state is an active-work state: doing (Developer), reviewing (Reviewer), live-testing (Live-tester). Other states show no spinner.
- CSS-only spinner: a small rotating circle with @keyframes, no assets, no dependencies. Place it inline before the name. Use the theme CSS variables so it works in light and dark mode (000025 adds dark mode).

Acceptance:
- Cards in doing, reviewing, and live-testing show a spinner; backlog, to-do, to-review, to-live-test, and done do not.
- Existing tests pass.

Constraints:
- Only src/webui.ts changes.
- HOLD until 000025 merges: it rewrites render() and the styles in the same file. Apply this on top of its merge.

# Notes
