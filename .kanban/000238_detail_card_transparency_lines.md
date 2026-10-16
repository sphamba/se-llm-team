---
name: "fix: detail card rest transparency and perpendicular sub-line entries"
priority: "medium"
state: "done"
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
- Done in commit 20c4c7c. `src/webui/page.ts`: `.agent-card` rest background is now `color-mix(in srgb, var(--panel) 85%, transparent)`, the main view `.card` rest value (rule applies to run, sub and doctor cards; hover, active and the doctor active rule unchanged). `dropCurve` now takes the horizontal run-in `d = max(8, min(|x1 - x2| * 0.35, 60, x2))`: scaled from the run-center to card-left span, capped at 60px like the vertical control, clamped to the card's room left of the canvas edge, with the old 8px floor so flush first-column cards keep the short hook. Vertical control unchanged.
- Tests: `tests/webui.test.ts` line 944 pins the new background; the dropCurve block keeps the flush-card asserts and adds two exact-path cases (span-scaled cap at 60px, near-card clamp). Red first at line 944, then green: `node tests/webui.test.ts` all assertions passed.
- Review: checks 4/4 pass. (1) `.agent-card` (page.ts:185) sets the exact main-view `.card` value (page.ts:151) `color-mix(in srgb, var(--panel) 85%, transparent)`; hover rule, active rules and z-index 2 untouched in the diff. (2) dropCurve's run-in `max(8, min(|x1 - x2| * 0.35, 60, x2))` mirrors the board sBend factor (board.ts:220), cp2's y equals the endpoint y, anchors and the vertical control unchanged. (3) The run chain still calls board curve() (page.ts:649); board.ts untouched. (4) No other test pins the old values (grep over tests/ for `x2 - 8` and the old agentCardCss panel assert: no hits). Tests: `node tests/webui.test.ts` exit=0, all assertions passed, including the two new exact-path cases. Open questions closed: the specs answer the clamp semantics (flush card keeps the short hook, no visible length lost to the canvas clip) and grant the factor/floor/cap tuning to the developer.

## Live test (live-tester agent, 2026-10-16)

Fixture: hub-only at /tmp/238lt (task + 4 run logs + 1 doctor log + 2 subagent transcripts; the developer run has no timestamp records, so its card is shorter and the adjacent chain curve bends). Hub on port 4351, isolated HOME, merged worktree code. Script /tmp/238lt/check.mjs: 38 checks, 0 failed.

- Rest transparency (both themes): the 4 run cards, the 2 sub cards and the doctor card all compute the exact board card value: light `color(srgb 1 1 1 / 0.85)`, dark `color(srgb 0.0784314 0.0941176 0.129412 / 0.85)`; alpha 0.85, below 1, in every case.
- Hover unchanged: the hovered run card computes `var(--hover)` (`rgba(130, 142, 159, 0.1)` in light), different from its rest value. The selected/open rules were not exercised (the diff does not touch them; #232 covered the doctor active state).
- Lines show through, measured as pixels: with the dash animation paused for a deterministic frame, hiding `#agent-relations` changes pixels strictly inside the run card along the chain path (sum -39 over 10 pixels, max 3), while two identical frames differ by 0 and pixels far from every path differ by -4 over 1 pixel. So the line under the card is visible through the 85% fill.
- Drop lines: 6 paths (3 run chain + 2 sub drops + 1 doctor drop). Every drop starts at its run card bottom-center, ends at the target card's left edge at its vertical middle, has cp2.y equal to the end y (horizontal arrival tangent) and a vertical departure control below the bottom edge. Run-ins: flush first-column sub (x2=0) d=8.00 (floor kept, cp2.x=-8, the old short hook), second-column sub (x2=128) d=19.25, third-column doctor (x2=246) d=19.20; both spaced values are above the old fixed 8px and cp2.x stays inside the canvas (108.75 / 226.80).
- Run chain untouched: all 3 chain paths keep the board curve's symmetric bend (dev->rev d=(40,40) because the shorter developer card breaks the y-center equality; the two same-height pairs keep the same-row clamp d=(4,4)).
- No page or console errors.

Assumptions: the pixel check measures the run chain only, since the sub and doctor drops enter at the card edge and do not pass under any card in this layout. The dash animation is paused and the dash array removed only for the pixel probe (injected style), the card CSS under test is untouched. The two check-script bugs hit were harness bugs (`:not(.agent-doctor)` needed in run-card selectors, and an undefined `pts` in the pixel helper), not product findings.
