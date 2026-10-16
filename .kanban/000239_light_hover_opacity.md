---
name: "fix: light theme hovered cards too transparent"
priority: "medium"
state: "done"
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
- Changed light `--hover` in `src/webui/page.ts` from `rgba(130, 142, 159, .1)` to `rgba(130, 142, 159, .95)`. `.card:hover` (85% `color-mix`) and `.agent-card:hover` (raw var) are untouched, dark `--hover` stays `#1b1f29`.
- Added to `tests/webui.test.ts` after the doctor theme-var block: the light `--hover` alpha parsed from the `:root` block must be >= .9, and both dark blocks (explicit and prefers-color-scheme) keep `--hover: #1b1f29;`.
- Red run before the source edit: `the light hover is near-opaque (alpha 0.1)`. Green: `node tests/webui.test.ts` all assertions passed. Commit bfb79c9. `pnpm test` (full suite) was not run per the developer role rule to run only scoped suites. `tests/webui.test.ts` is the only suite that pins page.ts.
- Review pass on bfb79c9: the diff matches the decided fix one-for-one. Checks: light `--hover` is `rgba(130, 142, 159, .95)` (src/webui/page.ts:109), both dark blocks keep `--hover: #1b1f29` (lines 82, 88), `.card:hover` keeps the 85% `color-mix` (line 152), `.agent-card:hover` keeps the raw var (line 186). No source or test pins the old `.1` value. The new assertions match the acceptance criteria: light alpha >= 0.9 parsed from lightVars, dark and prefers-dark blocks keep `--hover: #1b1f29;`.
- Review tests: `node tests/webui.test.ts` exit 0, all assertions passed. `pnpm test` not run (reviewer rule: scoped suites only); page.ts has no other covering suite.

## Live test (merged bfb79c9, hub-only)
Fixture: a scratch board (`/tmp/t239/repo`, one backlog task plus one past developer run log) served by `startHub` from the merged worktree on port 4350. Browser: headless Chromium, light and dark color scheme, viewport 1280x900. The unit suites named in the acceptance criteria belong to the developer gate and are not part of this live test.

Result: 19 checks, 0 failed.

Served page (`curl /`):
- The light `--hover` is `rgba(130, 142, 159, .95)` (1 occurrence). The old `rgba(130, 142, 159, .1)` is gone (0 occurrences).
- `--hover: #1b1f29` stays in both dark blocks (2 occurrences).
- `.card:hover` keeps `color-mix(in srgb, var(--hover) 85%, transparent)`; `.agent-card:hover` keeps `background: var(--hover)`.

Light theme (computed styles and pixels):
- `--hover` alpha is .95.
- The rest `.card` and `.agent-card` backgrounds stay the 85% panel mix (`color(srgb 1 1 1 / 0.85)`).
- The hovered `.card` background is `color(srgb 0.509804 0.556863 0.623529 / 0.806667)`, that is alpha ~.807 (near-opaque). Chromium quantizes alpha to 8 bits, thus .95 * .85 computes as .8067, not .8075.
- The hovered `.agent-card` background is `rgba(130, 142, 159, 0.95)`.
- Pixel proof: the hovered `.card` pixel is `rgb(154, 164, 177)`, the rest pixel is white, delta 101. The hovered `.agent-card` pixel is `rgb(136, 148, 164)`, delta 119. The hover is clearly visible against the white panel.
- Both hovered pixels match the composite of the hover fill over the rest pixel within 1 unit.

Dark theme (unchanged):
- `--hover` stays `#1b1f29`. The hovered `.card` is the 85% mix of it (alpha .85), the hovered `.agent-card` is opaque `rgb(27, 31, 41)`.

Accepted trade-off: the near-opaque hover hides relation lines under a hovered card. The Specs accept this trade-off, so it is not a finding.

Assumptions: light color scheme is the default context; the fixture has no git repo (the hub serves the board only); one fixture task gives the board card and its past developer run gives the modal agent card.
