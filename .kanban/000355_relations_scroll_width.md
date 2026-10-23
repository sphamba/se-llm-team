---
name: "fix: keep relation curves out of the board scroll width"
priority: "medium"
state: "done"
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
## What changed
- `src/webui/page.ts`: `drawRelations` sets `width` to the card extent (`w`, was `w + 40`); `#relations` gains `overflow: visible`; the `drawRelations` comment now says the box is the card extent and the bow paints outside it.
- `tests/webui/page.test.ts`: new pin, `#relations` includes `overflow: visible` (mirrors the `#agent-relations` check at :617).
- `tests/webui/board.test.ts`: the :282 pin quoted the whole `#relations` rule, so it moves with the rule (one line). The Specs' "diff stays in page.ts and page.test.ts" is a should; that pin cannot stay green otherwise.
- `curve()`, `relationPaths()`, the 40px bow, path style, z-index, pointer-events, board padding, column widths and `LAYOUT` are untouched.

## Acceptance
- `node tests/webui/page.test.ts` -> exit 0 (red first on the new pin).
- `node tests/webui/board.test.ts` -> exit 0 (red first on the moved rule pin).
- `tests/webui/logpane.test.ts`, `tests/webui/agentlog.test.ts`, `tests/webui/hub.test.ts` (webui callers) -> exit 0.
- Specs `pnpm test` replaced by that webui suite set, per the no-full-suite rule.
- `git status --short` pre-commit: 3 modified files. `git show --stat` post-commit: commit `fix: size the relations overlay to the card extent, paint its bow outside the box`, 3 files, 7 insertions, 5 deletions, worktree clean.
- Mechanical facts, pre-commit: `grep -n 'setAttribute("width"' src/webui/page.ts` -> `width`, `w` with no `+ 40` anywhere in the file; the width source is `w = Math.max(w, r.x + r.w)` from board-relative `cardBox`, so it now ends at the last card's right edge, inside the board's 18px right padding instead of 11px past the 29px inset.
- Headless browser live check at 1920x1080 not run: `tests/` has no HTTP-serving harness (only `src/hub.ts` builds a server) and no Playwright module is installed, so the check needs a hand-built server plus a CDP driver, i.e. a second test harness. The `#board.scrollWidth == #board.clientWidth` equality, the past-SVG-box `getBBox()` and the computed `overflow: visible` at 1920 are left to the reviewer, per the manual-acceptance rule.

## Live test: #relations overlay width and bow at 1920x1080

- Merged tree: `/home/phamba/repos/se-llm-team/.worktrees/fix/355-relations-scroll-width`
- Control tree: `/tmp/355-pre` (HEAD^)
- Driver: `/tmp/355/driver.mjs`; wrapper: `/tmp/355/run.sh`; runs: merged 3, control 1.
- Fixtures: `wide` = one task per state, `integration-testing` blocked by `to-do`; `bow` = the same 11 non-done states, no `done` card. Each run uses its own root under `/tmp/355-runs`.
- Assumptions: headless Chromium at 1920x1080 with `reducedMotion: "reduce"`, default light theme; the board has no vertical scrollbar, so `clientWidth` is 1920. `drawRelations` sizes the overlay to the rightmost rendered card, so the blocked card is the rightmost card only in the `bow` fixture; there a path's bow can pass the SVG width. `getBBox()` reports geometry and ignores clipping, so the ink is proven by the bbox reaching past the SVG box plus the computed `overflow` row.
- Not exercised: the acceptance suites (`node tests/webui/page.test.ts`, `node tests/webui/board.test.ts`, `pnpm test`), because this lane runs live usage only; no screenshot and no other viewport.

| # | Claim | Expected | Control | Merged | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | wide board at 1920: #board has no horizontal scroll range | range=0 | range=11 | range=0 | green |
| 2 | wide board: the #relations width attribute is at most #board clientWidth | inside=true | inside=false | inside=true | green |
| 3 | wide board: at least one relation path is rendered | paths=1 | paths=1 | paths=1 | green |
| 4 | bow board: a relation path's getBBox() x-extent passes the SVG width | past=true | past=true | past=true | green |
| 5 | bow board: getComputedStyle(#relations).overflow | visible | hidden | visible | green |

- Absolute values, merged run 1: wide scrollWidth 1920, clientWidth 1920, width attr 1891, max card right 1891, paths 1 (000011_task_integration_testing.md -> 000002_task_to_do.md); bow width attr 1575.328125, bbox right 1634.11, max card right 1575.33, overflow visible.
- Control values, run 1: wide scrollWidth 1931, clientWidth 1920, width attr 1931, overflow hidden; bow width attr 1615.328125, bbox right 1634.11, overflow hidden.
- Guards: rows 3, 4 read the same in both trees, so they prove that the width check uses a real path and that the curve geometry is unchanged; the change itself is measured by row 1 (scroll range), row 2 (width attribute) and row 5 (computed overflow, `hidden` on the control).

Verdict: 5/5 claims green, 0 red.
