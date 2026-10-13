---
name: "fix: seamless shimmer loop; flat gradient shoulders"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "shimmer-flat-shoulders"
---

# Summary
The shimmer loop shows a visible discontinuity: the 300%-wide gradient interpolates continuously, so a partial-bright tail stays visible at an element edge at both loop endpoints and teleports on the wrap. Fix: flat shoulders on both shimmer gradients, keyframes unchanged.

# Specs
Reported by the user: the log shine has a visible discontinuity at the loop wrap.

Facts (verified in code):
- src/webui/page.ts:212-216: the shine rules use background-size: 300% 100% (three times the element width), background-repeat: no-repeat, background-clip: text, color: transparent, and animation ... shimmer var(--pulse) linear infinite (2s), with @keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }.
- The shine gradient: linear-gradient(90deg, var(--shine-base) 0%, color-mix(in srgb, #fff var(--shine), var(--shine-base)) 50%, var(--shine-base) 100%), with --shine-base: var(--fg) and a --shine-base: var(--muted) override for details.lg-think/.lg-tool blocks. Knob --shine: 45%.
- The #191 pulse gradient (commit 0e5b620): same keyframes and background-size 300%, but linear-gradient(90deg, transparent, color-mix(in srgb, var(--link) 14%, transparent) 50%, transparent) painted over the text (no background-clip).
- Both gradients interpolate continuously, so at both loop endpoints a partial-bright tail is visible at an element edge (about 66% intensity) and teleports to the other edge on the loop wrap: the reported discontinuity.
- tests/webui.test.ts:573 pins the exact keyframes string; :575 pins gradient/background-size/clip/animation; :576, :577, :581, :583 pin the muted base, knobs and reduced-motion rules. JS wiring: markLiveLine() at page.ts:537-556, tests :891-893, :900-955, :1015.

Decision (user, 2026-10-13): gradient shoulders on both gradients. The keyframes stay exactly as they are. Each gradient gets flat shoulders: base (or transparent for the pulse) from 0% to 33% and from 67% to 100%, with the bright band in the middle third (33%-67%), bright core at 50%. Concretely:
- Shine: linear-gradient(90deg, var(--shine-base) 0%, var(--shine-base) 33%, color-mix(in srgb, #fff var(--shine), var(--shine-base)) 50%, var(--shine-base) 67%, var(--shine-base) 100%).
- Pulse: linear-gradient(90deg, transparent 0%, transparent 33%, color-mix(in srgb, var(--link) 14%, transparent) 50%, transparent 67%, transparent 100%).
- Do not widen the position range: animating to 150%/-50% leaves glyphs uncovered under no-repeat and blinks the text out. Do not change background-size, background-repeat, background-clip, the knobs, the .pulse application logic, or the reduced-motion rules.
- The sweep direction stays left to right.

Constraints:
- At both loop endpoints the element must show only the flat base (or transparent) color: no partial-bright tail visible anywhere at the from/to positions.
- The keyframes string stays byte-identical (test :573).
- The text stays visible at every position during the whole loop.

Acceptance:
- node tests/webui.test.ts passes; update any test line that pins the exact old gradient strings (e.g. :575) in the same fix; the keyframes test (:573) must pass unchanged.
- Browser check: open the task detail card and a live agent log pane with a pulsed block, watch at least one full 2s loop: the bright band enters and exits fully, with no jump or flash at the wrap, in both themes.

# Notes
