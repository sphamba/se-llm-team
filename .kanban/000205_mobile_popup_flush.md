---
name: "feat: mobile task details popup flush with the screen sides"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "mobile-popup-flush"
blockedBy: "#204"
---

# Summary
In the mobile media query from #204, make the task details popup (#m-box) full-screen: flush with all four screen sides, margin 0, border-radius 0, full viewport height (dvh with a vh fallback). Desktop geometry stays unchanged.

# Specs
## Need

Following #204: in mobile mode (the same @media (max-width: 600px) query #204 adds to src/webui/page.ts), the task details popup (#m-box) is flush with all screen sides — a full-screen sheet.

Facts (verified):
- #m-box today: `width: min(760px, calc(100vw - 32px))` (src/webui/page.ts:260), centered with a 16px inset per side.
- No test in tests/webui.test.ts pins #m-box geometry, so no test changes are expected.
- The popup opens above the #modal overlay; the #194 close animations and the #121 in-place refresh stay.

## Changes

In the @media (max-width: 600px) block (added by #204), add #m-box rules:

- Fill the viewport: full width and full height. Prefer `height: 100dvh` so mobile browser toolbars leave no gap; declare a `100vh` fallback before the dvh line for older browsers.
- `margin: 0` and `border-radius: 0`.
- No changes to the popup's inner layout, paddings, the close button, the #194 close animations, or the desktop geometry outside the media query (the `min(760px, ...)` rule stays for desktop).

## Acceptance criteria

- The `@media (max-width: 600px)` block in src/webui/page.ts contains the #m-box full-bleed rules: `rg -n -A 20 "max-width: 600px" src/webui/page.ts` shows a #m-box rule with a full-height declaration (100dvh with a 100vh fallback), margin 0 and border-radius 0.
- Desktop geometry unchanged: the `min(760px, ...)` #m-box width rule is still present outside the media query.
- `npm test` passes (five suites).
- Live browser check at a viewport under 600px: the task details popup touches all four screen edges.

# Notes
