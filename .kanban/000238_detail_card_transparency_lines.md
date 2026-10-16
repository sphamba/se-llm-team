---
name: "fix: detail card rest transparency and perpendicular sub-line entries"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "detail-card-transparency-lines"
---

# Summary
Two polish corrections to #237's shipped detail view: the agent cards (run, subagent, doctor) keep their fully opaque panel background at rest; give them the main view task cards' semi-transparent rest background so the link lines show through faintly there too, and dropCurve's fixed 8px horizontal hook makes the sub and doctor line approaches read as angled; scale the run-in so the lines enter the left edges perpendicular.

# Specs
# Specs

Two corrections to the shipped #237 detail view. Both changes touch only src/webui/page.ts (plus the pinned assertions in tests/webui.test.ts). Facts verified against main HEAD: the CSS block in page.ts, dropCurve at page.ts:616-623, the board curve() at src/webui/board.ts:215-232, and tests/webui.test.ts:944 and 1223-1234.

## 1. Rest transparency on the detail view's agent cards (match the main view)

- Current: `.agent-card` (page.ts:183) sets `background: var(--panel)`, fully opaque at rest, so the #agent-relations lines behind the cards never show through. Hovered and selected/open cards already carry translucent looks (`--hover`, `--medium-bg`).
- Needed: at rest - not `.agent-card-active`, not hovered - the agent cards get the exact rest background of the main view's task cards (page.ts:150, comment cites 000124): `background: color-mix(in srgb, var(--panel) 85%, transparent);`
- Applies to run cards, subagent cards and doctor cards (all carry `.agent-card`, so one rule change covers all three), in both themes.
- Unchanged: the hover rule (`.agent-card:hover { background: var(--hover); }`), the selected/open rules (`.agent-card-active`, `.agent-doctor.agent-card-active`), the doctor rest state (#232: only blue text and checkmark at rest - the translucent panel background is not a tint), borders, and the z-index stacking (cards at z-index 2 above the svg at z-index 1).
- Out of scope, not requested: the dark-theme hover `--hover: #1b1f29` stays opaque there.

## 2. Perpendicular left-side entries for the subagent and doctor lines

- Current: `dropCurve` (page.ts:616-623) exits the run card's bottom-edge center and enters the sub/doctor card's left side at its vertical middle, but cp2 is `(x2 - 8, y2)` - a fixed 8px horizontal hook - so the visible approach is dominated by the diagonal and reads as angled.
- Needed: the approach into the card's outside left edge must read as perpendicular: a horizontal run-in scaled from the horizontal span, mirroring the board curve()'s sBend pattern (board.ts:215-232: `Math.max(40, Math.min(Math.abs(b - a) * 0.35, 480))`); the exact factor, floor and cap are the developer's to tune for the detail view.
- Constraints:
  - The start anchor stays the run card's bottom-edge center; the endpoint stays the card's left side at its vertical middle.
  - The terminal tangent stays horizontal: cp2's y equals the endpoint's y.
  - Clamp the run-in to the space available left of the card so a card flush with the area's left edge (first-column subs and doctors) keeps the current short-hook look and loses no visible length to the canvas clip (the intent of the comment at page.ts:613-615).
- The run-chain lines keep calling the board curve() unchanged; board.ts and the board's own relation lines stay untouched.

## Tests

- Update tests/webui.test.ts in the same change where it pins the old values: the `.agent-card` background assertion (line 944) and the dropCurve behavior block (lines 1223-1234: starts "M 100 40 C", ends ", 0 59", departure control below the bottom edge, arrival control left of the left edge at the same y - the scaled run-in keeps all of these true).
- The other #237 assertions stay green unchanged: the run chain keeps `curve(`, the html-gated rewrite, the hover re-apply, the 3 hover bindings, the z-index 2 stacking.

## Acceptance

- Runnable: `npm test` passes (all suites; at minimum `node tests/webui.test.ts`).
- Visual, in the pipeline's live-test stage on the merged commit: at rest, the detail view's agent cards match the main view task cards' translucency in both themes and the lines show through faintly; the subagent and doctor line approaches read as perpendicular horizontal entries wherever there is space to the card's left.

# Notes
