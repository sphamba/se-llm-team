---
name: "fix: webui dark mode colors are not liked; use the One Dark palette"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
In the webui dark theme, replace the current dark colors with the One Dark palette (bg #282c34, text #abb2bf, accent #61afef and related hues), keeping the CSS variable structure from the dark mode toggle.

# Specs
Restyle the dark theme with One Dark.

Changes (src/webui.ts, dark theme CSS variables added by 000025):
- Replace the dark palette values with the One Dark theme:
  - page background: #282c34; elevated surfaces (cards, modal): #2c313a; deepest (header/footer): #21252b
  - primary text: #abb2bf; muted/secondary text: #5c6370
  - borders/dividers: #3e4451
  - accents/links/toggle: #61afef (blue)
- Map the priority chips in dark mode to One Dark hues, readable on dark: low #98c379 (green), medium #e5c07b (yellow), high #d19a66 (orange), critical #e06c75 (red). Keep the existing chip pattern (colored text, tinted background) and the chip fix from 000029.
- Keep the variable names, the toggle, and the localStorage behavior unchanged.
- Light theme unchanged.

Acceptance:
- Dark mode renders with the One Dark palette above.
- Priority chips are readable and keep their per-priority hue.
- The toggle and theme persistence still work.
- Existing tests pass.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000028 (animation) → 000029 (chip fix) → 000030 (cap/unfold), all in src/webui.ts.

# Notes
