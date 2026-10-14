---
name: "fix: sticky task popup header at all widths, not only mobile"
priority: "medium"
state: "done"
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

- `rg -n "#m-head \{" src/webui/page.ts` shows position: sticky in the base rule (outside any @media line).
- `rg -n "600px\) \{ #m-head" src/webui/page.ts` finds no #m-head rule inside the mobile block.
- The base #m-box rule carries `padding: 0 18px 18px` (top padding dropped).
- `npm test` passes (five suites).
- Live browser check at a desktop viewport: with the popup scrolled to the end, the header row with Close stays pinned at the top and tapping Close closes the popup.

# Notes

- 2026-10-14, developer: implemented the Specs. One CSS change in src/webui/page.ts, committed 47ddade in the worktree.
  - The sticky #m-head rule moved out of the mobile media query into the base rule: `display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; margin-bottom: 0; padding: 18px 0 10px; background: var(--panel); z-index: 1;`. The base #m-box drops its top padding (`padding: 0 18px 18px`), so the sticky containing block starts at 0 and the header pins flush at every width. The #206 comment moved with the rule and now reads 206/207.
  - The mobile media query keeps only the full-screen geometry (width 100vw, margin 0, border-radius 0, height 100vh/100dvh, max-height none); its now-redundant #m-head rule and its padding override are gone, as the Specs asked. The base rules stay before the mobile block, so the mobile geometry still wins under 600px.
  - Desktop geometry is unchanged at rest: the header now carries the 18px top and 10px bottom padding that the box padding and the header margin-bottom supplied before, so the popup looks the same until it scrolls, and now the header pins on scroll.
  - Static acceptance checks: `rg -n "#m-head \{" src/webui/page.ts` shows position: sticky in the base rule (line 245, outside any @media); `rg -n "600px\) \{ #m-head"` finds nothing; the base #m-box rule (line 244) carries `padding: 0 18px 18px`. `npm test` passes (five suites: kanban, orchestrator, webui, extension, index), exit 0. No test changes, per the Specs.
  - Live check: Playwright (paseo install) against a temp-root daemon (src/orchestrator.ts from this worktree, webui on 127.0.0.1:4321 from the temp root's .kanban/se-llm-team.json, probe task seeded in state done so no agent spawns, isolated HOME=/tmp/t207live/home so the probe did not stand down on the production hub lock, production UI on 4242 untouched). 15 checks, ALL PASS. Desktop 1280x800, popup scrolled to the end (scrollTop 4177, scrollHeight 4833, clientHeight 656): #m-head y 72 before and after the scroll, equal to #m-box y 72, so the header is pinned; elementFromPoint at the box top returns #m-head, so nothing peeks above it; the Close button stays fully on screen; the header background is opaque; a click on Close closes the popup. Mobile 390x844: header pinned at y=0, close button on screen, full-bleed geometry intact. No page errors. Screenshots /tmp/t207live/desktop-scrolled.png and /tmp/t207live/mobile-scrolled.png, script /tmp/t207live/check.mjs.
  - AGENTS.md live-check recipe updated: a probe daemon under the real HOME stands down on the production hub lock, so it needs HOME=/tmp/<name>/home.
- 2026-10-14, live-tester: independent live check of the merged commit 47ddade. Hub-only fixture (no daemon needed): one done task with 60 paragraphs, served from this worktree by `startHub` on 127.0.0.1:4610 with an isolated HOME; the pre-change page e21e4fe served the same fixture on 4611 for the differential; Playwright chromium (paseo install). 37/37 checks passed, plus a pixel probe.
  - Static acceptance: `rg -n "#m-head \{" src/webui/page.ts` finds line 245 with `position: sticky` in the base rule; `rg -n "600px\) \{ #m-head"` finds nothing; the base `#m-box` rule carries `padding: 0 18px 18px` (line 244). `rg -n "position: sticky"` finds only line 245. `npm test` left to the developer/reviewer gate, not run here.
  - Desktop 1280x800: at rest the box is 760x656 at (260,72) with radius 10px; `#m-body` top is 312 and the `#m-close` rect is 90..117 on BOTH merged and baseline, so the at-rest spacing is unchanged. Scrolled to the end (scrollTop 1890 of 2546): the header is pinned (head top 72 == box top 72) at the end and at half scroll, Close is fully in the 800px viewport, nothing peeks above the header (`elementFromPoint` at the box top returns `#m-head`; the top 18px middle-column pixel band is pure panel color on merged, while the baseline paints glyph pixels from row ~6), and both a raw `page.mouse.click` and a `locator.click` on Close close the popup.
  - Baseline e21e4fe desktop: `position: static`, scrolled header top -1800, Close off screen. Differential confirms the new desktop behavior.
  - Mobile 390x844 and widths 600 and 320: full-bleed geometry unchanged (x 0, radius 0, 100dvh), header sticky and pinned, Close closes. Width 601: desktop geometry (569 wide at x 16), sticky and pinned. Baseline mobile still sticky, so no regression of #206.
  - Mobile, boundary and desktop runs: no console or page errors.
  - Technical difficulties: none. One workaround: an element screenshot of the popup includes the rounded-corner page background, so the panel-color pixel probe samples the middle columns only.
  - Assumption: the page is a static module served by the hub, so no daemon was needed to exercise the popup; the served HTML was checked to carry the expected base sticky rule on 4610 and the mobile-only rule on 4611.

# Open questions

None. Assumptions the PM or user can correct:
- Scope: CSS-only, one sticky #m-head rule shared by desktop and mobile. No change to the close button, the #194 close animations, the overlay tap-to-close handler, or Esc.
- The 18px top inset moves from the base popup box to the sticky header, so the popup keeps the same visual spacing at rest while the header now pins on scroll.
- The header is sticky even when the content is short and the box does not scroll; sticky then has no visible effect.
