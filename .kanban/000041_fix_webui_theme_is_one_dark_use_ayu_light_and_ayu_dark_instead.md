---
name: "fix: webui theme is One Dark; use Ayu Light and Ayu Dark instead"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Replace the One Dark colors (000032) with the Ayu palette: dark mode becomes Ayu Dark, the light theme becomes Ayu Light, from the official ayu-colors values.

# Specs
Restyle both themes with Ayu (correction of 000032, which used One Dark).

Facts: the exact palette was researched from the official ayu-theme/ayu-colors repo (cross-checked against dempfi/ayu). See Hindsight doc "Ayu palette reference (Light, Dark, Mirage)".

Changes (src/webui.ts, both theme variable sets):
- Dark mode becomes Ayu Dark:
  - page background #10141c; elevated surfaces (cards, modal) #141821; deepest (header/footer) #010102
  - primary text #bfbdb6; muted/secondary text #5a6673
  - borders/dividers #1b1f29
  - accents/links/toggle #e6b450
- Light mode becomes Ayu Light:
  - page background #fcfcfc; elevated surfaces (cards, modal) #ffffff; deepest (header/footer) #ebeef0
  - primary text #5c6166; muted/secondary text #adaeb1
  - borders/dividers #6b7d8f at 12% alpha (rgba)
  - accents/links/toggle #f29718
- Priority chips follow Ayu hues, readable on their theme (colored text, tinted background, chip pattern unchanged):
  - light: low #86b300, medium #eba400, high #fa8532, critical #e65050
  - dark: low #aad94c, medium #ffb454, high #ff8f40, critical #d95757
- Keep the CSS variable structure, toggle, and localStorage behavior unchanged. Opaque card backgrounds (000036) keep matching the column palette per theme.

Acceptance:
- Dark mode renders Ayu Dark; light mode renders Ayu Light (the palettes above).
- Chips are readable and keep their per-priority hue in both themes.
- The toggle and theme persistence still work.
- Existing tests pass.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000030 (cap/unfold, reviewing) → 000033 (agent view) → 000039 (hub frontend) → 000036 (sibling FLIP), all in src/webui.ts. Priority high: it promotes first after 000030 merges.

# Notes
