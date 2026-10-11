---
name: "fix: the blockedBy relation lines are too visible; make them subtle"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The blockedBy relation lines on the board draw at full opacity and stand out too much behind the task cards. Make them less opaque and subtle while keeping the dash animation and the layering from #124.

# Specs
# Fix

#relations path (src/webui.ts ~:746) draws stroke: var(--muted) at full opacity, stroke-width 1.5. Add transparency so the lines read as subtle hints behind the semi-transparent cards, not a dominant overlay:

- Add stroke-opacity around 0.3 (0.25-0.35, pick what reads subtle in both themes), or use a color-mix with transparent - one approach, no new variables.
- Keep the dash animation (dashflow), stroke-dasharray, pointer-events: none, the z-index layering from #124 (lines above column containers, below cards, modal on top), and the prefers-reduced-motion static-dash rule intact.
- src/webui.test.ts: assert the path rule carries the reduced opacity (e.g. stroke-opacity set and below 1).

# Complexity

simple (user-ordered 2026-10-12). Files: src/webui.ts and src/webui.test.ts only.

# Notes
