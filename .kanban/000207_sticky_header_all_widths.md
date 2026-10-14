---
name: "fix: sticky task popup header at all widths, not only mobile"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "sticky-header-all-widths"
---

# Summary
Move the #206 sticky #m-head treatment out of the mobile media query into the base rules, so the task details popup header pins at the top while content scrolls on desktop too. The base #m-box drops its top padding; the mobile block loses the redundant duplicate.

# Specs
## Need

Following #206 (sticky close header on mobile): the task details popup header (#m-head) is sticky in non-mobile mode too, so Close stays reachable at any scroll position on desktop.

Facts (verified):
- Desktop rules (src/webui/page.ts:240-241): `#m-box { background: var(--panel); border-radius: 10px; padding: 18px; width: min(760px, calc(100vw - 32px)); max-height: 82vh; overflow: auto; }` and `#m-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }` — the header is not sticky on desktop.
- The mobile block (src/webui/page.ts:276) holds the #206 sticky rule: `#m-head { position: sticky; top: 0; margin-bottom: 0; padding: 18px 0 10px; background: var(--panel); z-index: 1; }`, with the mobile #m-box rule (line 272) dropping the top padding (`padding: 0 18px 18px`). The #206 comment explains the containing-block clamp: the box's top padding must move to the header, else the header pins 18px down and scrolled text peeks through above it.
- No test in tests/webui.test.ts asserts sticky behavior; no test changes are expected.

## Changes

- Apply the #206 treatment at all widths: the sticky #m-head rule (position: sticky, top: 0, margin-bottom: 0, padding: 18px 0 10px, background: var(--panel), z-index: 1) moves out of the mobile media query into the base #m-head rule, so one rule applies everywhere.
- The base #m-box rule (line 240) drops its top padding the same way: `padding: 0 18px 18px`, so the pinned header sits flush at the top and no text peeks above it.
- The mobile media query drops the now-redundant #m-head rule and the now-redundant padding override; keep the mobile full-screen geometry (width 100vw, margin 0, border-radius 0, 100dvh height, max-height none).
- The header's square top corners clip to the box's 10px rounding via overflow: auto; no extra handling needed.
- No change to the close button, the #194 close animations, the overlay tap-to-close handler, or Esc.

## Acceptance criteria

- `rg -n "#m-head \\{" src/webui/page.ts` shows position: sticky in the base rule (outside any @media line).
- `rg -n "600px\\) \\{ #m-head" src/webui/page.ts` finds no #m-head rule inside the mobile block.
- The base #m-box rule carries `padding: 0 18px 18px` (top padding dropped).
- `npm test` passes (five suites).
- Live browser check at a desktop viewport: with the popup scrolled to the end, the header row with Close stays pinned at the top and tapping Close closes the popup.

# Notes
