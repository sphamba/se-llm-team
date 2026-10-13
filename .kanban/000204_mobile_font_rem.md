---
name: "feat: mobile font size 15% smaller via rem; block zooming"
priority: "medium"
state: "done"
worktree: ""
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

## Developer log

- Implemented per the Specs (worktree commit 16cc9de).
- src/webui/page.ts: all 22 font-size declarations converted from integer px to rem against the 16px base (12->0.75rem, 13->0.8125rem, 14->0.875rem, 15->0.9375rem, 17->1.0625rem, 18->1.125rem). The replace was scoped to `font-size:` so padding/margin px values (header padding, #m-box padding, #m-log-text details padding-left) stayed untouched. No other CSS property changed.
- Added `@media (max-width: 600px) { html { font-size: 85%; } }` as the last rule in the style block, after the column accent colors. 85% of 16px is 13.6px, 15% smaller, and every rem-based size scales with it.
- Viewport meta extended to `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`.
- tests/webui.test.ts updated in the same change: the .card-stats/.agent-stats/#m-log-meta rules now assert 0.75rem, .agent-card asserts 0.875rem, the #m-log-text rule asserts 0.9375rem with the no-smaller-size check reworked to `0\.(75|8125|875)rem`, and the count test deep-equals the rem mapping {0.75:4, 0.8125:1, 0.875:11, 0.9375:4, 1.0625:1, 1.125:1}. Added two assertions: the served page carries maximum-scale=1 and user-scalable=no in the viewport meta, and carries the `@media (max-width: 600px) { html { font-size: 85%; } }` rule.
- Acceptance criteria verified: no px font sizes remain (`rg "font-size: \d+px"` exits 1), exactly 22 rem declarations (4x 0.75rem, 1x 0.8125rem, 11x 0.875rem, 4x 0.9375rem, 1x 1.0625rem, 1x 1.125rem), the viewport meta and the mobile query match. `npm test` passes, five suites.
- No open questions: the Specs were complete and verified against the code before the change.

## Live-tester log

- Tested the merged worktree (16cc9de) as a user, against the pre-change page (16cc9de^) served side by side: two hub-only fixtures (ports 4461/4462, isolated HOMEs, staleMs raised) sharing one probe task with a live pid and a synthetic usage log (session + text pairs + a tool pair + `turn_end` with model/usage), plus a second registered project so `.tab` renders. Playwright (real Chromium) drove both pages.
- Served page (the real interface): no `font-size: Npx` remains, exactly 22 rem declarations, the viewport meta carries `maximum-scale=1, user-scalable=no`, and the `@media (max-width: 600px) { html { font-size: 85%; } }` rule is present.
- Desktop (1280px): computed font sizes are identical to the pre-change page on every measured element (h1 18px, #hub 13px, .name/#m-log-text/#m-body 15px, the rest 12-14px) — no user-visible size change on desktop; html stays 16px.
- Mobile (390px): html computes 13.6px and every measured element is exactly 85% of its desktop size: h1 15.3px, .tab/.col h2/#theme/#updated/.empty/.toggle/#m-close/#m-attrs 11.9px, #hub 11.05px, .name/#m-log-text/#m-body/#m-body h1 12.75px, .chip/.card-stats/#m-log-meta/.agent-stats 10.2px, #m-head h2 14.45px, #m-body pre/code 11.9px. 20 board + 12 modal selectors checked; zero console errors; no horizontal overflow on html, #m-box, #m-body, #m-log or the log pres (details expanded).
- `#m-log-text pre.lg-out` computes 12.75px = 0.9375rem scaled: the `font: inherit` constraint holds.
- Boundary: at 600px width the query applies (13.6px), at 601px it does not (16px).
- Differential control: the pre-change page at 390px keeps html 16px and desktop sizes — the media query is the only scaling source.
- Assumptions: (1) "under 600px" follows the Specs' own `max-width: 600px` semantics, so exactly 600px scales down; (2) pinch zoom is not exercisable in headless Chromium, so the viewport meta in the served HTML and DOM is the verification (the Specs' documented standard mechanism, iOS caveat accepted per Specs); (3) board/modal data came from a synthetic fixture, font rendering is data-independent.
- No issues found; no open questions. No contradictions with the task's stated assumptions.
