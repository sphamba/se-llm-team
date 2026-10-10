---
name: "fix: webui theme is One Dark; use Ayu Light and Ayu Dark instead"
priority: "high"
state: "done"
worktree: "fix/webui-theme-is-one-dark-use-ayu-light-and-ayu-dark-instead"
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

- Replaced the One Dark variable values in src/webui.ts with the Ayu palette (commit ee22e71). Ayu Dark: --bg #10141c, --panel #141821, --code-bg (header, deepest) #010102, --fg #bfbdb6, --muted/--faint #5a6673, --border #1b1f29, --link/--accent #e6b450, hover #1b1f29. Ayu Light: --bg #fcfcfc, --panel #ffffff, --code-bg (header, deepest) #ebeef0, --fg #5c6166, --muted/--faint #adaeb1, --border rgba(107, 125, 143, .12), --link/--accent #f29718, hover rgba(130, 142, 159, .1) (line highlight).
- Priority chips now follow Ayu hues with tinted (15% alpha) backgrounds and colored text, same chip pattern: light low #86b300, medium #eba400, high #fa8532, critical #e65050; dark low #aad94c, medium #ffb454, high #ff8f40, critical #d95757.
- Per the ayu-colors reference, Ayu defines no separate heading color, so --heading and --soft use the primary foreground (#bfbdb6 dark / #5c6166 light). Column state accents (.c-*), overlay, toggle, localStorage persistence, and CSS variable structure are unchanged. Only src/webui.ts touched.
- Verified with an assert-style palette check (all spec'd Ayu values present, no One Dark values left) and the full test suite: webui.test.ts, kanban.test.ts, orchestrator.test.ts all pass.
- Review (ee22e71): clean, no fixes. Every value in the Specs is present in src/webui.ts; both dark copies (explicit data-theme and the media query) are identical, so explicit and OS-default dark match. Surface mapping verified in the page CSS: --bg on body, --panel on columns/modal/toggle buttons, --code-bg on header and modal code blocks (no footer element exists in this UI). Grep for the One Dark palette and the old slate light palette finds only .c-backlog #94a3b8, which is a column state accent the notes keep unchanged. Toggle and localStorage code untouched. Tests re-run in the worktree: all three pass (via node src/*.test.ts). Diff main...HEAD touches only src/webui.ts. Main has since gained the meta/kanban mirror work; it does not touch src/webui.ts, so no conflict.
- Live test (worktree daemon, fixture repo /tmp/lt-000041 with 9 tasks across states/priorities, Playwright headless Chromium): PASS, no issues. Served the UI from the worktree on port 4557 (project .kanban/se-llm-team.json override); production daemon on 4242 untouched. Page HTML check: all spec'd Ayu values present, zero One Dark values (#282c34, #abb2bf, #2c313a, #3e4451, #61afef, #98c379, #e5c07b, #d19a66, #e06c75, #21252b, #353b45 all absent), and the explicit data-theme dark block equals the media-query dark block. Browser computed styles: light default bg rgb(252,252,252), cards rgb(255,255,255), header rgb(235,238,240), unfold accent rgb(242,151,24); dark after toggle bg rgb(16,20,28), cards rgb(20,24,33), header rgb(1,1,2), theme button/unfold rgb(230,180,80); OS-dark fresh context renders Ayu Dark with no data-theme attribute (media query path). Chips keep per-priority hue in both themes (light rgb(134,179,0)/rgb(235,164,0)/rgb(250,133,50)/rgb(230,80,80); dark rgb(170,217,76)/rgb(255,180,84)/rgb(255,143,64)/rgb(217,87,87)), readable on tinted backgrounds. Toggle to dark, reload persistence (localStorage), toggle back to light, modal panel color in both themes, and the show-all unfold button all verified; no page errors. Screenshots: /tmp/lt-000041/{light,dark,light-modal,dark-modal}.png. Worktree test suite re-run: webui.test.ts, kanban.test.ts, orchestrator.test.ts all pass. Fixture daemon and spawned agents cleaned up.