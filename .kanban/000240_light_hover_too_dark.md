---
name: "fix: light theme hover too dark"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#239"
complexity: "simple"
shortName: "light-hover-too-dark"
---

# Summary
Replace the dark slate light-theme hover of #239 with an almost-opaque very light grey: light --hover becomes rgba(233, 237, 242, .95), so hovered cards, tabs and buttons stay clear in light mode instead of going dark.

# Specs
# Problem
#239 (commit bfb79c9, merged and live-tested) set light `--hover: rgba(130, 142, 159, .95)` — 95%-opaque medium slate grey. On hover in light theme, task cards, agent cards and every other element sharing `--hover` (theme button, tabs, toggles, modal close) turn dark grey against the `#fcfcfc`/white palette. The user rejected the result: hovered cards must be clear and almost opaque, not dark.

# History
- Original bug (fixed by #239): light hover was `rgba(130, 142, 159, .1)`; `.card:hover` mixed it at 85% (~8.5% effective alpha) and the card vanished against the white panel.
- #239's acceptance criterion only required alpha >= .9, which the dark slate tone also satisfied. The live test's pixel check (`rgb(154, 164, 177)` on hover) shows the tone is the problem, not the opacity.

# Decided fix (user decision)
Clear and almost opaque, light tone:
- Change light `--hover` from `rgba(130, 142, 159, .95)` to `rgba(233, 237, 242, .95)` (~#e9edf2, a very light grey at 95% alpha) in the `:root` light block of `src/webui/page.ts`.
- Apply to all light-theme hover states by changing the `--hover` variable itself: `.card:hover`, `.agent-card:hover`, `#theme:hover`, `.tab:hover`, `.toggle:hover`, `#m-close:hover` all pick it up. No structural changes to the hover rules.
- Dark theme unchanged: `--hover` stays `#1b1f29` in both dark blocks (explicit and prefers-color-scheme).
- Non-hovered backgrounds unchanged: `.card` / `.agent-card` keep their 85% panel `color-mix`.
- Opaque hover hides relation lines under a hovered card (trade-off accepted by the user, see #124/#239).

# Acceptance criteria
- `tests/webui.test.ts`: update the light `--hover` assertion from #239 to pin `rgba(233, 237, 242, .95)` exactly (alpha alone is not enough; also require the RGB channels to be light). Both dark blocks keep `--hover: #1b1f29;`.
- `node tests/webui.test.ts` passes.
- `pnpm test` passes.

# Notes
