---
name: "fix: webui dark mode colors are not liked; use the One Dark palette"
priority: "high"
state: "live-testing"
worktree: "fix/webui-dark-mode-colors-are-not-liked-use-the-one-dark-palette"
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
- HOLD check: 000028 and 000029 are done and merged into the branch base. 000030 was still in backlog when the PM set this task to doing, so I started with no merge risk.
- Replaced the dark palette in DARK_VARS (src/webui.ts) with One Dark: bg #282c34, panel #2c313a, border #3e4451, code bg #21252b, text #abb2bf, muted and faint #5c6370, heading and soft #d7dae0, hover #353b45, link #61afef. Variable names unchanged.
- Priority chips in dark mode: One Dark hues as text (low #98c379, medium #e5c07b, high #d19a66, critical #e06c75) on 15% tints of the same hue. Chip pattern from 000029 kept.
- The theme toggle button gets the #61afef accent in dark mode only (dark-scoped #theme rule). The header band uses var(--code-bg), so it renders #21252b in dark and stays identical in light.
- Toggle JS and localStorage behavior unchanged. Light theme unchanged.
- Commit 04cab3a in the worktree. kanban, orchestrator, and webui tests pass.
- Visual check with Playwright (dark color scheme) confirms: body #282c34, columns #2c313a, header #21252b, all four chip hues with tinted backgrounds, toggle color #61afef, and the toggle cycle light → dark → light works.
- Review pass: no fixes needed. Diff (commit 04cab3a) matches the specs: One Dark values in both DARK_VARS blocks, variable names and toggle JS unchanged, only src/webui.ts touched. Dark-scoped #theme rules (1,2,0 specificity) override base and hover color/border without touching background, so #theme:hover still applies. Light theme stays visually identical: the new header background uses var(--code-bg), and light --code-bg (#f1f5f9) equals light --bg (#f1f5f9). HOLD respected: 000028 and 000029 merged in base, 000030 still not merged (no conflict). Re-ran node --test on webui, kanban, and orchestrator tests: 3 files, all pass.
