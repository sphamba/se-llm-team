---
name: "fix: light theme hover too dark"
priority: "medium"
state: "done"
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
- Changed light `--hover` in `:root` of `src/webui/page.ts` from `rgba(130, 142, 159, .95)` to `rgba(233, 237, 242, .95)`. All light hover states (`.card`, `.agent-card`, `#theme`, `.tab`, `.toggle`, `#m-close`) pick it up through the variable. Both dark blocks still hold `--hover: #1b1f29;`.
- `tests/webui.test.ts`: the #239 alpha-only check is replaced by an exact pin of `rgba(233, 237, 242, .95)`, so the tone cannot regress to a dark slate. Red run failed on the old value, then passed after the source edit.
- Deviation: only the scoped suite `node tests/webui.test.ts` ran (passes). The `pnpm test` acceptance line is covered by it, per the developer prompt's scoped-suite rule.
- Review: checks pass. Light `:root` holds `--hover: rgba(233, 237, 242, .95)`; both dark blocks keep `--hover: #1b1f29`; the hover rules pick the value up through `var(--hover)` with no structural changes and the `.card:hover` 85% mix intact. Scoped suite `node tests/webui.test.ts` passes (exit 0). The diff touches only `src/webui/page.ts` and `tests/webui.test.ts`, both mapped to that suite. No fixes, no open questions.

## Live test (2026-10-16, merged 1b10b6c)
Ran the hub from the worktree over a fixture board (one live `doing` card with a run log, six backlog cards, a second registered project for tabs). 22 Playwright checks, 0 failed.
- Light page: the served `:root` pins `--hover: rgba(233, 237, 242, .95);`; the computed value matches; the #239 dark slate string is gone.
- Hovered render over the white panel: task card rgb(237, 240, 244); theme button rgb(233, 238, 243); column toggle, project tab, modal Close and run agent card all rgb(234, 238, 243). All light and near-opaque, none is the old dark slate.
- Rest card and rest agent card are unchanged (`color(srgb 1 1 1 / 0.85)`, pixel white).
- Dark unchanged: the explicit theme toggle and prefers-color-scheme dark both keep `--hover: #1b1f29` with the old hovered card background.
- No page errors.
Differential control: the #239 code on a second hub over the same fixture still renders the old dark hovered card (pixel rgb(154, 164, 177)), so the harness detects the change.
Assumptions: "clear and almost opaque" is tested as measured hovered pixels with all channels >= 225, plus the computed background alpha (0.806667 on `.card:hover`, 0.95 on the direct `var(--hover)` rules). The accepted relation-line hiding under an opaque hovered card is not re-tested. No observed behavior contradicts the task's stated assumptions. No open questions.
