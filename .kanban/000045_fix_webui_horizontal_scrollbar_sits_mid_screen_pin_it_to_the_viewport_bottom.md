---
name: "fix: webui horizontal scrollbar sits mid-screen; pin it to the viewport bottom"
priority: "medium"
state: "live-testing"
worktree: "fix/webui-horizontal-scrollbar-sits-mid-screen-pin-it-to-the-viewport-bottom"
---

# Summary
The #board scroll container is content-height, so its horizontal scrollbar renders mid-screen. Make the board fill the viewport below the header so the scrollbar sits at the bottom edge.

# Specs
FILE: src/webui.ts — CSS inside the PAGE template literal (const PAGE at line 86; <style> block lines 92-148; markup lines 150-155).

BEHAVIOR: the horizontal scrollbar appears in the middle of the screen instead of at the viewport bottom.

ROOT CAUSE (explored): #board (styled at line 103: `display: flex; gap: 10px; padding: 10px 18px 18px; overflow-x: auto; align-items: flex-start;`) is the horizontal scroll container (8 columns, min-width 200px each => min board width ~1706px). body (line 97) has only `margin: 0` — no height — so #board is content-height (columns don't stretch due to align-items: flex-start). A scroll container's horizontal scrollbar draws at its own bottom edge, which with a short board is mid-screen. scrollbar-gutter would NOT fix this (reserves space, does not reposition).

SUGGESTED FIX (dev to confirm): make the scrolling element span the viewport:
  html, body { height: 100%; }
  body { display: flex; flex-direction: column; margin: 0; /* keep existing props */ }
  #board { flex: 1 1 auto; min-height: 0; }  /* extend the existing rule at line 103 */
So #board fills the space below <header> and its overflow-x scrollbar sits at the viewport bottom.

ACCEPTANCE CRITERIA:
1. With columns overflowing horizontally (window narrower than ~1706px), the horizontal scrollbar renders at the bottom edge of the viewport, directly above the browser window edge, not mid-screen.
2. With a short board, no large empty gap change: header stays at top, board fills the remaining height, vertical page scroll behavior unchanged (page itself still scrolls vertically when content exceeds viewport, unless the dev adds column-internal scroll — optional, kanban-style `.col { max-height: 100%; overflow-y: auto; }`; do it only if it does not regress the 5-card cap / unfold-all button from 000030).
3. Modal (#m-box, #m-body pre, position: fixed) unaffected.
4. Light/dark themes both unaffected structurally.

CONSTRAINTS:
- The CSS lives inside a JS template literal in TS: backticks and ${} must stay escaped (see ${DARK_VARS} at line 96).
- Verify the FLIP card animation in render() (getBoundingClientRect measurements) still behaves with the taller scroll container.
- Coordinate with backlog tasks 000036 (FLIP sibling animation) and 000044 (spinner across refresh): both also touch the webui render area — merge order matters, hold if a lane rewrites the same region. Task 000039 (hub frontend) will restructure the page into tabs later; keep the fix in the shared CSS so it survives.

# Notes

- Implemented the suggested fix as spec'd: `html, body { height: 100%; }`, body gets `display: flex; flex-direction: column;` (existing props kept), #board rule extended with `flex: 1 1 auto; min-height: 0;`. Three-line diff in the PAGE template literal, shared CSS (survives the 000039 tab restructure), no backticks/`${}` added so the template literal stays safe.
- Chose board-internal vertical scroll over the optional `.col` scroll: with the fix, overflow-y computes to auto on #board (forced by overflow-x: auto), so tall boards scroll inside #board and the page itself no longer scrolls; header stays pinned and the horizontal scrollbar sits at the viewport bottom in all cases (a min-height approach would push it below the fold on tall boards). Did not touch .col, so no risk to the 000030 5-card cap / unfold-all button.
- Verified with node tests (webui.test.ts, kanban.test.ts pass) and a headless Chromium script run by a subagent, 6/6 checks: at 1280x800 board scrollWidth 1706 > clientWidth 1280, board bottom 800 = innerHeight, doc scrollHeight = clientHeight (no page vscroll), header top 0; 5-card cap + "show all (7)" click still work; modal opens/closes; dark theme toggle changes bg and layout inequalities hold; at 1280x300 board scrolls internally (scrollHeight 859 > 258) with scrollbar still at viewport bottom and header pinned; FLIP settle across a state-change refresh ends with the card in .c-to-do, inline transform cleared, zero console errors. Screenshots: /tmp/webui-narrow.png, /tmp/webui-tall.png.
- FLIP measurements unaffected: getBoundingClientRect deltas are taken with unchanged scroll state around the innerHTML replace, and the taller container adds no scroll between the two measurements.
- No conflicts with 000036/000044: this branch touches only the two CSS rules (body, #board) plus one new rule; render() JS untouched.
- Committed 9aa26e2 on fix/webui-horizontal-scrollbar-sits-mid-screen-pin-it-to-the-viewport-bottom.
- Review (2nd pass, clean): diff matches the spec's suggested fix exactly, 3-line CSS change inside the PAGE template literal, no backticks or ${} added, render() JS untouched. Re-ran node --test (webui.test.ts, kanban.test.ts pass) and an independent headless Chromium check with playwright, 16/16: at 1280x800 scrollW 1706 > clientW 1280, board bottom 800 = innerHeight, no page vscroll, header top 0; modal opens/closes; dark bg rgb(16, 20, 28); at 1280x300 board scrolls internally (scrollH 441 > 258) with board bottom = innerHeight and header pinned; 5-card cap -> show all (7) -> refold to 5; at 1280x900 board bottom = innerHeight and content fits so no internal scroll; zero console errors. Screenshot /tmp/kb-review-045/tall.png confirms header pinned and board filling the viewport. One note: the dev's Notes claim scrollHeight 859 > 258 at 1280x300; I measured 441 > 258 (taller filler content in my fixture), same conclusion. No fixes needed, moving to to-live-test.
- Live test (done): served the dashboard from the fix worktree on port 4250 against the real 16-task board (port 4242 was the running daemon's) and drove it with Playwright headless Chromium, 26/26 checks after removing 3 environment artifacts. All acceptance criteria pass: (1) at 1280x800 with classic scrollbars visible (playwright's default --hide-scrollbars removed), the h-scrollbar occupies 15px inside #board whose bottom edge is flush with the viewport bottom (board bottom 800 = innerHeight 800), screenshot /tmp/lt45-chrome-narrow.png shows it pinned at the window edge; no page-level h-scroll (doc 1280/1280), header pinned, 8 columns, no page vscroll. (2) At 1280x300 the board scrolls internally (scrollH 757 > 258), mouse wheel scrolls the content (scrollTop 200), header pinned, h-scrollbar still at viewport bottom, page itself does not scroll; at 1280x800 the board fills the remaining height with no gap regression. (3) Modal opens on card click with attributes and rendered markdown body, closes on Close and on backdrop click. (4) Theme toggle light->dark->light works (bg rgb(252,252,252) -> rgb(16,20,28)), layout inequalities hold in dark; prefers-color-scheme: dark emulation applies the dark palette on a fresh profile. 000030 cap flow verified live: 5 cards -> show all -> refold to 5. Auto-refresh (5 s) updates the timestamp, zero console errors across the whole run. FLIP not re-triggered live (no task state change made): render() measures with unchanged scroll state around the innerHTML replace, so the taller container cannot affect the deltas, per code inspection. Three initial FAILs were artifacts, not product bugs: bar 0px was playwright's default --hide-scrollbars (re-verified 15px with it removed), and two hardcoded "show all (8)" expectations hit live data that grew to 9 done tasks mid-test (cap flow itself passed 5 -> 9 -> 5). No product issues found; no new tasks needed. Screenshots: /tmp/lt45-narrow.png, /tmp/lt45-tall.png, /tmp/lt45-modal.png, /tmp/lt45-dark.png, /tmp/lt45-chrome-narrow.png.
