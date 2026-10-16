---
name: "fix: light theme hovered cards too transparent"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "light-hover-opacity"
---

# Summary
Make hovered cards (task and agent cards) readable in light theme: the light hover color becomes near-opaque like the dark theme, instead of ~10% alpha grey that lets the card vanish against the white panel.

# Specs
# Problem
In light theme, hovering a task card or an agent card makes the card too transparent against the white panel:
- Light `--hover` is `rgba(130, 142, 159, .1)` (10% alpha grey) in the `:root` light block of the `PAGE` template in `src/webui/page.ts` (~line 109).
- `.card:hover` (~line 152) mixes it: `background: color-mix(in srgb, var(--hover) 85%, transparent)` → ~8.5% effective alpha.
- `.agent-card:hover` (~line 186) uses `var(--hover)` raw → 10% alpha.
The hovered card nearly vanishes. Dark theme is unaffected (`--hover: #1b1f29`, opaque).

# Decided fix (user decision)
Make the light hover opaque, matching the dark theme's solid look:
- Change light `--hover` from `rgba(130, 142, 159, .1)` to `rgba(130, 142, 159, .95)`.
- Keep `.card:hover`'s existing 85% `color-mix` (→ ~81% effective alpha, near solid).
- Keep `.agent-card:hover` using `var(--hover)` raw (95% alpha).
- Dark theme unchanged: `--hover` stays `#1b1f29`.
- Non-hovered card backgrounds unchanged: `.card` / `.agent-card` keep their 85% panel `color-mix`.
- Note: task #124 made card backgrounds translucent so relation lines stay visible under hovered cards. With an opaque hover, relation lines under a hovered card are hidden. The user accepted this trade-off.

# Acceptance criteria
- `tests/webui.test.ts` gains/updates an assertion that the light theme `--hover` alpha is >= .9 (near-opaque), and that the dark `--hover` is still `#1b1f29`. Update any existing assertion that pins the old light hover value.
- `node tests/webui.test.ts` passes.
- `pnpm test` passes.

# Notes
