---
name: "feat: mobile font size 15% smaller via rem; block zooming"
priority: "medium"
state: "doing"
worktree: "feat/204-mobile-font-rem"
issuer: "user"
complexity: "trivial"
shortName: "mobile-font-rem"
---

# Summary
Convert all 22 webui font-size declarations from px to rem, add a 600px mobile media query that shrinks the root font size by 15% (85% of the 16px base), and block zooming via the viewport meta. Update the px-pinning assertions in tests/webui.test.ts in the same change.

# Specs
## Need

Mobile handling for the web dashboard: under a 600px screen width, every font size renders 15% smaller than now, achieved by making all font sizes relative to one global size and shrinking that global size. Zooming is blocked on mobile.

Facts (verified):
- All 22 font-size declarations are integer px in the one style block in src/webui/page.ts (h1 18px; #theme/#updated/#m-close 14px; #hub 13px; .tab 14px; .col h2 14px; .name 15px; .chip 12px; .card-stats 12px; .empty 14px; .toggle 14px; .agent-card 14px; .agent-stats 12px; #m-log-meta 12px; #m-log-text 15px; #m-head h2 17px; #m-attrs 14px; #m-body 15px; #m-body h1,h2,h3 15px; #m-body pre 14px; #m-body code 14px). No rem/em/% and no font-size var today; html has no font-size; :root holds color/animation custom properties only.
- Viewport meta exists at src/webui/page.ts:100: `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- No width-based media query exists in the CSS.
- tests/webui.test.ts pins the px values: the count test (~line 815-820) deep-equals the mapping {12:4, 13:1, 14:11, 15:4, 17:1, 18:1}; px includes-checks at ~470-471 (.card-stats/.agent-stats 12px), ~810 (.agent-card 14px), ~814 (#m-log-text 15px and no 10-14px), ~799 (#m-log-meta full rule). The test file must change in the same task.

## Changes

1. Convert all 22 font-size declarations in src/webui/page.ts to rem, relative to the browser default 16px base: 12px -> 0.75rem, 13px -> 0.8125rem, 14px -> 0.875rem, 15px -> 0.9375rem, 17px -> 1.0625rem, 18px -> 1.125rem. No other CSS property changes.
2. Add the mobile media query at the end of the style block: `@media (max-width: 600px) { html { font-size: 85%; } }` — 85% of the 16px base is 13.6px, 15% smaller, and every rem-based size scales with it. No layout changes beyond the font size.
3. Extend the viewport meta to block zooming: `content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"`.
4. Update tests/webui.test.ts in the same task: the count test asserts the rem mapping {0.75:4, 0.8125:1, 0.875:11, 0.9375:4, 1.0625:1, 1.125:1}; the px includes-checks (.card-stats, .agent-stats, .agent-card, #m-log-text, #m-log-meta) assert the corresponding rem values; add assertions that the served page carries maximum-scale=1 and user-scalable=no in the viewport meta and the @media (max-width: 600px) html font-size rule.

## Constraints and edge cases

- Deliberate shortcut, named: the viewport meta is the standard zoom-blocking mechanism. iOS Safari may still allow pinch zoom (it overrides user-scalable=no for accessibility). If iOS zoom must also die, the upgrade path is a JS gesturestart preventDefault. Not in scope now.
- The accessibility trade-off of blocking zoom is accepted per the user's explicit request.
- `#m-log-text pre { font: inherit }` keeps working: the font shorthand inherits the rem-based size.
- No JS font handling exists; none is added.
- Dark theme vars, animations, and the three reduced-motion media queries stay untouched.

## Acceptance criteria

- `rg -n "font-size: \\d+px" src/webui/page.ts` exits 1 (no px font sizes remain).
- `rg -o "font-size: [\\d.]+rem" src/webui/page.ts | wc -l` prints 22.
- `rg -c "font-size: 0.75rem" src/webui/page.ts` prints 4 and `rg -c "font-size: 0.875rem" src/webui/page.ts` prints 11.
- `rg -n "maximum-scale=1, user-scalable=no" src/webui/page.ts` matches the viewport meta.
- `rg -n "max-width: 600px" src/webui/page.ts` matches the mobile query, whose block sets the html font size 15% smaller than the base.
- `npm test` passes (five suites), including the updated count test.

# Notes
