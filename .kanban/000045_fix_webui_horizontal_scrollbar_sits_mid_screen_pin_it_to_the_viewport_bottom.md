---
name: "fix: webui horizontal scrollbar sits mid-screen; pin it to the viewport bottom"
priority: "medium"
state: "to-do"
worktree: ""
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
