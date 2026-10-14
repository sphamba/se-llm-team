---
name: "fix: mobile full-screen task popup has no close affordance while scrolled"
priority: "medium"
state: "done"
worktree: ""
issuer: "#205"
complexity: "simple"
shortName: "mobile-popup-close-affordance"
---

# Summary
On mobile (<600px) the task details popup #m-box is a full-screen sheet flush with all edges (task #205, commit 5ce5f36 in src/webui/page.ts), which removes every way to close it once the user scrolls: the overlay tap-to-close can never fire and the Close button scrolls away. Restore a close affordance reachable from any scroll position on mobile.

# Specs
Usability regression found in the live test of #205 (feat: mobile task details popup flush with the screen sides).

On mobile viewports (under 600px) the task details popup #m-box is now a full-screen sheet flush with all four screen edges (added by #205, commit 5ce5f36 in src/webui/page.ts). This removes every way to close the popup once the user scrolls the content:

- The popup covers the whole viewport, so the #modal overlay tap-to-close handler (src/webui/page.ts:754, fires only when e.target is #modal) can never fire on mobile.
- The Close button sits in #m-head at the top of the scrolling #m-box (overflow: auto is on #m-box), so it scrolls out of view with long content. The scrolled-away Close button alone is pre-existing behavior (the old page shows it too), but the old page also kept tappable overlay strips (16px side margins plus the bottom 18vh strip from the 82vh cap) that closed the popup from any scroll position.
- Esc is not reachable on phone keyboards.

Verified by a differential live test with Playwright at 390x844, popup scrolled to the end: on the pre-change page (commit 16cc9de) a tap at (5,700) hits #modal and closes the popup; on the merged page the same tap hits #m-box and the popup stays open. Screenshot /tmp/t205lt/mobile.png shows the scrolled sheet with no close affordance on screen.

## Decision (user, 2026-10-14)

A sticky Close header: the existing header row (#m-head, title + Close) stays pinned at the top of the sheet while the content scrolls under it, so Close is reachable from any scroll position.

## Implementation

- In the mobile @media (max-width: 600px) block, make #m-head sticky within the scrolling #m-box: position: sticky, top: 0, with the sheet background and a z-index above the scrolled content so text does not show through under it.
- #m-box keeps overflow: auto and stays the scroll container.
- No change to the overlay tap-to-close handler, the Esc handler, or the close animations (#194).

Desktop behavior stays unchanged: #m-head keeps its current (non-sticky) behavior outside the media query.

## Acceptance criteria

- The @media (max-width: 600px) block in src/webui/page.ts contains a sticky #m-head rule: `rg -n -A 40 "max-width: 600px" src/webui/page.ts` shows #m-head with position: sticky and top: 0.
- Desktop unchanged: #m-head has no sticky rule outside the media query.
- `npm test` passes (five suites).
- Live browser check at a viewport under 600px: with the popup scrolled to the end, the header row with Close stays visible and tapping Close closes the popup.

# Notes

- 2026-10-14, developer: implemented the sticky Close header per the Decision. One CSS change in the mobile media query of src/webui/page.ts, committed e21e4fe in the worktree.
  - #m-head is now position: sticky, top: 0, with the sheet background (var(--panel)) and z-index 1, so the header row (title + Close) pins at the top of the scrolling #m-box while the content scrolls under it. Its own padding keeps the 18px top and 10px bottom spacing, and margin-bottom drops to 0 on mobile (the padding carries the gap).
  - Checked a sticky pitfall first with a headless Chromium probe: sticky clamps the element to its containing block, which is the #m-box content box (inset by the 18px padding), so a plain top: 0 pins the header 18px down and scrolled text peeks above it. The negative-margin workaround is clamped the same way. Fix: the mobile #m-box drops its top padding (padding: 0 18px 18px) and #m-head carries it (padding: 18px 0 10px), so the header's containing block starts at 0 and top: 0 pins it flush. The header background equals the sheet background, so the side strips read as one surface.
  - Live check with Playwright at 390x844 against a temp-root daemon (src/orchestrator.ts, webui on 127.0.0.1:4321 from the temp root's .kanban/se-llm-team.json, production UI not touched, probe task in done state so no agent spawns): 11 checks, ALL PASS. Popup scrolled to the end, #m-head at y=0, Close fully on screen, tap on Close closes the popup, header pinned mid-scroll too. Desktop at 1280x800: #m-head not sticky, box still 760px wide, radius 10px, 82vh cap, centered. Screenshots /tmp/t206lt/mobile-scrolled.png and /tmp/t206lt/mobile.png, check script /tmp/t206lt/check.mjs, daemon log /tmp/t206lt/root/.kanban/.logs/orchestrator.log.
  - npm test passes (five suites: kanban, orchestrator, webui, extension, index). The rg acceptance checks above pass.
- 2026-10-14, reviewer: reviewed e21e4fe against the Specs. No fixes needed. Verified against the code: the base #m-head rule (src/webui/page.ts:241, no background or padding) is overridden by the later mobile media rule (line 276, same specificity, later wins); #m-head is a direct child of the scrolling #m-box, and the mobile #m-box drops its top padding so the sticky containing block starts at 0 and top: 0 pins the header flush (the clamp pitfall the developer probed). box-sizing: border-box keeps the 100dvh sheet flush with the padding included; the gap moved into header padding (not margin) is correct, since a margin would let scrolled text show through below the sticky header; modal content cannot scroll #m-box horizontally (#m-log scrolls in its own box, text uses pre-wrap and overflow-wrap: break-word), so the vertical-only sticky is safe. Desktop has no sticky rule outside the media query. npm test re-run by the reviewer: all five suites pass, exit 0. The developer's live-check artifacts in /tmp/t206lt/ check out: the scrolled screenshot shows the header row with Close pinned at the top with the popup deep-scrolled. No silent assumptions: the padding move and the header background choice are stated in the code comment, the Notes, and the Open questions section.
- 2026-10-14, live-tester: live browser test of e21e4fe, 20 checks, ALL PASS. No findings.
  - Setup: served the merged page with `startHub` only (no daemon, no agents, production UI untouched): isolated HOME, port 4601, fixture root /tmp/t206lt2/repo with one done task of 60 paragraphs (.kanban/000001_probe.md). Differential baseline: `git archive 5ce5f36` served the same fixture as a second hub (second isolated HOME, port 4602). Playwright (paseo install), viewports 390x844, 320x568, 1280x800. Scripts /tmp/t206lt2/check.mjs and check-edge.mjs; logs new.log/old.log.
  - Mobile 390x844 (the fix): popup scrolled to the end, `#m-head` computed `position: sticky` and `top: 0px`, header rect y=0 at the sheet top, Close rect y=18 fully on screen, `elementFromPoint` at the Close center returns `#m-close`, a real mouse tap and a Playwright locator click both close the popup. Header stays pinned at mid-scroll. No page errors.
  - Baseline 5ce5f36, same flow: `#m-head` is `static`, Close rect y=-2555 (off screen), a tap at (5,700) hits `#m-box` and the popup stays open. This is the regression the fix removes.
  - Desktop 1280x800 (unchanged): `#m-head` static, `top: auto`, box 760px wide centered at x=260, radius 10px, max-height 656px, header scrolls away with the content (y 90 -> -1875).
  - Extra narrow probe 320x568: at scroll top the first content starts at the header bottom (53) with no overlap, at end-scroll Close is fully on screen and a tap closes.
  - Static acceptance checks: `rg -n -A 40 "max-width: 600px" src/webui/page.ts` shows the `#m-head` rule at line 276 inside the media block (position: sticky, top: 0), `rg -n "position: sticky"` finds that single line and no sticky rule outside the media query.
  - Assumptions: a CSS-only served-page change needs no daemon, so the hub-only serving recipe was enough, with one done probe task and no agent spawns. `npm test` was not run (developer and reviewer own the suites).

# Open questions

None. Assumptions the PM or user can correct:
- Scope: CSS-only fix in the mobile media query, per the Decision. No new close controls, no change to the overlay tap-to-close, Esc, or the close animations (#194).
- The 18px top inset moves from the sheet to the sticky header, so the pinned header sits flush at the sheet top with the same visual spacing as before.
- The header background equals the sheet background (var(--panel)), so the 18px side strips beside the pinned header read as one surface on both themes.

