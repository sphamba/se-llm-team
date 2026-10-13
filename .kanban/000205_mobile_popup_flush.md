---
name: "feat: mobile task details popup flush with the screen sides"
priority: "medium"
state: "live-testing"
worktree: "feat/205-mobile-popup-flush"
issuer: "user"
complexity: "trivial"
shortName: "mobile-popup-flush"
blockedBy: ""
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

- Added the #m-box full-bleed rules as a second one-line `@media (max-width: 600px)` block in src/webui/page.ts: `width: 100vw; margin: 0; border-radius: 0; height: 100vh; height: 100dvh; max-height: none`. The `max-height: none` line lifts the base 82vh cap, so the popup truly fills the viewport. The #204 one-liner stays untouched, so the pinned query text in tests/webui.test.ts:822 needs no change. Desktop keeps the `min(760px, ...)` rule. Committed as 5ce5f36.
- The spec fact said no test pins #m-box geometry, true, but a test pins the exact #204 query text. A merged block would fail that test, so the #m-box rules sit in their own one-line block with the same query.
- `npm test` passes: five suites, all assertions.
- Live browser check (playwright-core, cached Chromium headless shell) at 390x844 against a throwaway daemon on 127.0.0.1:4243 (project-level webUi override on a temp root, production port 4242 untouched): #m-box bounding box is 0,0 to 390x844, margin 0, radius 0. Desktop at 1280x800: 760px wide, radius 10px, centered, max-height 82vh. Screenshots: /tmp/pw-205/mobile.png, /tmp/pw-205/desktop.png.
- The throwaway daemon spawned a real developer agent on its demo task before the first poll; killed it (pid 266530) and added an open question to the demo task so the failsafe could not respawn it. Temp root removed, daemon stopped.
- Live test (hub-only recipe, Playwright Chromium, fixture task with a 5.5 KB body, hubs on 127.0.0.1:4321 merged / 4322 pre-change 16cc9de, isolated HOMEs): all geometry checks pass. Mobile 390x844: #m-box bounding box 0,0 to 390x844, flush on all four edges; computed margin 0, border-radius 0, height 844px (the dvh line wins), max-height none; no horizontal overflow in the box or the page; 4150 px of content scrolls to the end inside the sheet; Esc closes; reopen is full-bleed again; no console or page errors. Desktop 1280x800 unchanged: width 760, centered (x=260), radius 10px, 82vh cap 656px. Screenshot: /tmp/t205lt/mobile.png.
- Finding (regression, reported to a PM subagent): on mobile the full-bleed sheet removes every tap-to-close affordance while the content is scrolled. The #modal tap-to-close handler (page.ts:754, fires only when e.target is #modal) can never fire because the sheet covers the whole viewport. The Close button sits in #m-head at the top of the scrolling #m-box, so it scrolls out of view with long content (off-screen while scrolled on the old page too, so that part is pre-existing). Before the change, the 16px overlay strips plus the bottom 18vh strip (82vh cap) closed the popup from anywhere. Differential evidence: old page, a tap at (5,700) hits #modal and closes the popup; merged page, the same tap hits #m-box and the popup stays open. Esc is not reachable on phone keyboards. Net: on a phone, a user who scrolls long task details must scroll back to the top to close.
- Assumptions: (1) headless Chromium has no dynamic browser toolbars, so 100dvh is verified as "computed height equals the full viewport" plus the source-level fallback order (100vh declared before 100dvh); real-device toolbar-gap behavior is not testable headless. (2) Overlay tap-to-close was a pre-existing mobile close path (verified against the pre-change page). (3) The base #m-box has no margin (flex centering on #modal), so the mobile `margin: 0` is redundant but harmless, exactly as the spec asked. My first-pass desktop check wrongly asserted a non-zero base margin; not a finding.

# Open questions

(none)
