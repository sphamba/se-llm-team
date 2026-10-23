---
name: "fix: keep relation curves out of the board scroll width"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#354"
complexity: "simple"
shortName: "relations-scroll-width"
---

# Summary
Size the #relations SVG to the rendered card extent instead of card +40px, and set overflow: visible so the curves still paint past the SVG box. The six groups then fit #board at 1920 with no horizontal scroll range, while the curves are not clipped by the SVG edge and may run off-screen.

# Specs
## Problem

#354's live test found `#board` still scrolls 11px at 1920 even though the six column groups fit exactly. `drawRelations` sizes the `#relations` SVG to the last card's right edge plus 40px (`svg.setAttribute("width", w + 40)` at `src/webui/page.ts:496`). The board's right inset is 29px (18px board padding plus 11px column padding and border), so the extra 11px becomes scrollable width.

The user decided: the relation curves must not be clipped at the SVG edge, but must not count toward the board scroll width. A curve that leaves the screen may be cut by the viewport. Do not shrink the curve bow.

## Change

- In `src/webui/page.ts:127`, add `overflow: visible` to the `#relations` rule. The same rule already exists on `#agent-relations` at `:239` and is pinned by `tests/webui/page.test.ts:617`.
- In `drawRelations` (`src/webui/page.ts:496`), set `svg.setAttribute("width", w)` instead of `w + 40`. Keep the height as `h`.
- Update the `drawRelations` comment at `:483`: the SVG box is the rendered card extent, and the bow paints outside the box through `overflow: visible`, so the overlay adds no scroll width.
- Do not change `curve()`, `relationPaths()`, the 40px bow, the path style, the z-index, `pointer-events`, the board padding, the column widths or `LAYOUT`.

Why this works, verified in headless Chrome with a 700px board and the last card at 656px: width 696 gives `scrollWidth` 696, so 11px overflow. Width 656 with `overflow: visible` gives `scrollWidth` 685, equal to `clientWidth`, while the curve's bounding box reaches 659 and still paints. The curve ink does not add layout overflow.

## Tests

- `tests/webui/page.test.ts`: assert the `#relations` rule includes `overflow: visible`, mirroring the `#agent-relations` check at `:617` ("the connector svg no longer clips its own strokes at the agent area box").
- Live test at a 1920 viewport with one `blockedBy` relation between two non-done tasks:
  - `#board.scrollWidth === #board.clientWidth`.
  - The `#relations` width attribute is at most the board `clientWidth`.
  - A relation path's `getBBox()` extends past the SVG width.
  - `getComputedStyle(svg).overflow` is `visible`.
  - At least one path is rendered, so the width check uses a real relation.
- Keep the existing board layout, curve geometry and page tests green.

## Constraints

- Do not touch `src/webui/board.ts`, the six-group layout, the 300px column rule, or the board padding.
- Do not reduce the bow or clip curves by trimming the SVG width.
- The board still scrolls horizontally at narrow widths because the columns do not fit. That is correct and out of scope.
- No README or docs change.
- The diff should stay in `src/webui/page.ts` and `tests/webui/page.test.ts`.

## Acceptance

- `node tests/webui/page.test.ts` exits 0.
- `node tests/webui/board.test.ts` exits 0.
- `pnpm test` exits 0.
- Live check at 1920x1080: `#board.scrollWidth == #board.clientWidth`, no horizontal scroll range, and a relation curve still reaches the right edge. A screenshot or the path bounding box proves the curve is not clipped at the SVG box.

# Notes
