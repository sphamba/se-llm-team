---
name: "feat: wider agent card gaps and longer sub/doctor curves in the task detail dialog"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "webui-agent-card-gaps"
---

# Summary
In the task detail dialog's agent view, widen the card gaps to 16px horizontal and 8px vertical, and triple the left-approach control distance of the sub and doctor connectors, rounded to the nearest 5px. Only that view changes: the board relation lines and the run-chain connectors keep their current geometry.

# Specs
## Goal

Widen the spacing of the card tree in the task detail dialog and lengthen the approach curves that reach the left edge of subagent and doctor cards. Cosmetic only. No behaviour, data or API change.

## Gaps

All in `src/webui/page.ts`, in the agent view CSS block. Change exactly these four declarations:

| Selector | Line | Today | New | Reads as |
| --- | --- | --- | --- | --- |
| `#m-agent-btns` | 191 | `gap: 8px` | `gap: 16px` | horizontal gap between run columns |
| `.agent-col` | 188 | `gap: 4px` | `gap: 8px` | vertical gap between a run card, its `.agent-subs` box and its doctor cards |
| `.agent-subs` | 189 | `gap: 4px` | `gap: 8px` | vertical gap between sub cards |
| `#m-doctor` | 192 | `gap: 8px` | `gap: 16px` | horizontal gap in the residual doctor row |

- Leave every other spacing value unchanged, including `#m-doctor`'s `margin-top: 8px`, `#m-agent`'s `margin-bottom: 12px`, the card padding and the card border radius.
- No other selector, no other view. The board, the feed and the log pane keep their layout.

## Curves

Only `dropCurve` changes (`src/webui/page.ts:742-749`). It draws exactly two connectors: the drop from a run card's bottom edge into the left edge of each sub card (`:775`) and into the left edge of each doctor card (`:781`).

Replace the horizontal control distance with:

```js
const v = Math.max(8, Math.min((y2 - y1) * 0.5, 60));
const base = Math.max(8, Math.min(Math.abs(x1 - x2) * 0.35, 60));
const d = Math.min(5 * Math.round((3 * base) / 5), x2);
```

Constraints:

- `v`, the downward departure control distance, stays exactly as today. Only the left approach triples.
- The free space left of the card (`x2`) caps the result last, so the control point never lands left of the svg area and the approach never clips. The current code folds `x2` into the inner clamp and then applies the 8px floor after it, which can push `d` past `x2`; the new order removes that.
- `curve()` in `src/webui/board.ts:215` is shared with the board's blocking-relation lines. Do not touch it. The run-chain connectors in the detail view keep calling `curve()`.
- No stroke change: `#agent-relations path` keeps `stroke-dasharray: 6 4`, the butt default caps and the miter default joins. There is no rounding of anything but the computed distance.
- Update the comment above `dropCurve` so it states the tripled, 5px-rounded distance and the final `x2` cap.

Values the formula must produce (pin them in the test):

| `base` | today `d` | new `d` |
| --- | --- | --- |
| 8 | 8 | 25 |
| 20 | 20 | 60 |
| 35 | 35 | 105 |
| 60 | 60 | 180 |
| 60, `x2` = 40 | 40 | 40 |
| 8, `x2` = 6 | 8 (clips) | 6 |

## Tests

- `tests/webui/page.test.ts:786-793` pins the current `dropCurve` geometry. Update those assertions to the new formula and cover the six cases in the table, including the two `x2`-capped ones.
- Update any assertion that pins the four gap declarations (check the agent view pins around `tests/webui/page.test.ts:277` and `:289-290`) to the new 16px and 8px values.
- Do not add a browser check. The user tests the dialog by hand.

## Acceptance criteria

Run in the worktree:

- `node tests/webui/page.test.ts` exits 0.
- `node tests/webui/board.test.ts` exits 0.

At live test, in the repo root: `pnpm test` exits 0, and the user opens a task detail dialog that has sub cards and doctor cards, and confirms the wider gaps and the longer left approach.

## Non-goals

- No rounded stroke caps or joins, no change to the dash pattern.
- No change to `curve()` and so none to the board relation lines.
- No layout change outside the agent view.
- No new config key.

# Notes
- Implemented in `src/webui/page.ts`: `.agent-col` and `.agent-subs` gap 4px -> 8px, `#m-agent-btns` and `#m-doctor` gap 8px -> 16px. All other spacing kept.
- `dropCurve` now splits the old inline clamp into `base` (8..60 as today) and `d = min(5 * round(3 * base / 5), x2)`, so the tripled, 5px-rounded left approach is capped by `x2` last and can no longer fall back to the 8px floor past the card edge. `v` unchanged, `curve()` untouched.
- Comment above `dropCurve` rewritten to state the tripled 5px-rounded distance and the final `x2` cap.
- Tests in `tests/webui/page.test.ts`: updated the three exact-path pins (base-capped 180px case, the flush-card control now on the edge instead of past it, and the two stub-draw paths) and added a table of the six pinned spans. No test pinned the four gap declarations (`grep -n 'gap:' tests/webui/page.test.ts` is empty), so none changed.
- Assumption: no integer span yields base exactly 8 or base 60 with 6px left, so those two rows are pinned through equivalent spans (23px span -> base 8.05 -> 25px, and 100px span into 6px of space -> 6px). The 5px rounding makes both outcomes exact.
- Red-first: `node tests/webui/page.test.ts` failed on the flush-card assertion before the `dropCurve` change. After it, `node tests/webui/page.test.ts` and `node tests/webui/board.test.ts` both exit 0.

## Review (first review of bfb03c1)

Mode: first review. Claims: the four gap declarations, the `dropCurve` formula and its comment, six pinned spans, `curve()` and the stroke untouched. Test union: `tests/webui/page.test.ts` plus `tests/webui/board.test.ts`.

- Gaps: PASS. Exactly the four declarations changed. `src/webui/page.ts:188` `.agent-col` 8px, `:189` `.agent-subs` 8px, `:191` `#m-agent-btns` 16px, `:192` `#m-doctor` 16px. `#m-doctor` keeps `margin-top: 8px`, and no other spacing rule is in the diff.
- Curves: PASS. `src/webui/page.ts:747-749` are the spec lines. `v` is unchanged, and `:749` caps `x2` last. The comment at `:738-741` names the tripled, 5px-rounded distance and the final cap.
- Scope: PASS. `git diff main...HEAD --stat` lists only `src/webui/page.ts` and `tests/webui/page.test.ts`. So `src/webui/board.ts:215` `curve()` is untouched, and `#agent-relations path` at `src/webui/page.ts:228` keeps `stroke-dasharray: 6 4` with no cap or join rule. `rg -n 'dropCurve' src/` shows only the two detail-view connectors, at `:776` and `:782`.
- Tests: PASS. `tests/webui/page.test.ts:787-799` pins the departure, the flush card, the 180px span and the six-row table. No assertion pinned the four gap declarations, so no gap edit was needed. `tests/webui/page.test.ts:277` and `:289-290` pin the flex direction only.
- Red proof: reverted `src/webui/page.ts` with `git apply -R`, then `node tests/webui/page.test.ts` exit=1, class `AssertionError: the x2 cap lands last, so a card flush with the area's left edge takes no run-in`. Restore applied, `git status --short` clean.
- Tests run: `node tests/webui/page.test.ts` exit=0. `node tests/webui/board.test.ts` exit=0.
- Non-blocking: the table rows for base 8 and for base 60 with 6px of space go through equivalent spans (23px and 94px), because no integer span gives base exactly 8. The outcomes stay exact, and both rows still fail on the old 8px floor. A fractional span would pin base 8 literally if that ever matters.
- Non-blocking: the served helper measures the boxes on each draw, so the 16px column gap and the tripled approach move together. The live test is the first place that shows the rendering, as the Specs intend.
## Live test (2026-10-21)

Lane: hub-only root (`.kanban` fixture with 2 task files, 2 developer run logs, 3 doctor logs, no git, no daemon), `GET /` served by `startHub`, driven by Playwright Chromium at 1400x900. One driver with one root parameter ran on the merged tree `bfb03c1` and on the control `f04cfb9` (`git archive HEAD~1`). Dialog opened like a user: click the board card, then measure the served DOM. All 14 checks met their per-tree expectation (`SUMMARY merged_rc=0 pre_fix_rc=0 compare_rc=0`).

| claim | printed proof (merged) | control f04cfb9 |
| --- | --- | --- |
| `#m-agent-btns` gap | computed columnGap `16px` | `8px` |
| `.agent-col` gap | computed rowGap `8px` | `4px` |
| `.agent-subs` gap | computed rowGap `8px` | `4px` |
| `#m-doctor` gap | computed columnGap `16px` | `8px` |
| run columns, measured | `134.73 - 118.73 = 16px` | `126.73 - 118.73 = 8px` |
| sub cards in one column, measured | `107 - (56 + 43) = 8px` | `99 - (52 + 43) = 4px` |
| run card to its `.agent-subs` box, measured | `G7 actual 8px` (subs box top `56px`) | `G7 actual 4px` (subs box top `52px`) |
| residual doctor cards in `#m-doctor`, measured | `92.06 - 76.06 = 16px` | `84.06 - 76.06 = 8px` |
| drop connector follows `d = min(5 * round(3 * base / 5), x2)` | 4 paths, max deviation `0px` from the formula | deviation `39.22px`, old formula deviation `0px` |
| left approach triples where `x2` does not cap | `60px` rendered vs `20.78px` old, ratio `2.888` | `20.78px`, ratio `1.0` |
| `x2` caps the control point last | min control x `0px`, 3 paths with `d == x2` | min control x `-8px` (control lands left of the svg) |
| `v` unchanged | max deviation of `cy1` vs `y1 + v` = `0px` | `0px` |
| run-chain connector still follows `curve()` | 1 path, deviation `0px` | `0px` |
| stroke unchanged | `6px, 4px` dash, `butt` caps, `miter` joins | same |
| board relation lines | 1 path, `d` byte-identical to the control | `M 617 169.625 C 822.8 169.625, -176.79999999999998 83.625, 29 83.625` |

Assumptions that shaped the checks:
- Two developer runs on one `doing` task give two columns, and every card in a column stretches to the column width (`118.73px`), so `|x1 - x2| = w / 2` and `base = 20.78px` for every drop.
- Column 1 starts at the `#m-agent` left edge (`x2 = 0px`), so the `x2` cap binds there and only column 2 (`x2 = 134.73px`) can show the triple. Both cases are in the table above.
- Sub cards come from `tool_execution_end` records that name an `Agent ID` and an `Output file` under `/tmp/pi-subagents-1000/`. The three doctor logs give one card slotted into run 1's column and two residual cards in `#m-doctor`.
- Residual doctor cards for run handles 7 and 8 have no column, so the page draws no connector for them (printed `relationsPaths=5`). Only the slotted doctor card carries a doctor path. `#m-doctor` card spacing is still measured on the two residual cards.
- The fixture is byte-identical on both trees and the viewport is fixed. A `setViewportSize` round trip before sampling uses the page's own resize redraw, so the drawn geometry matches the settled layout after the modal's arrival growth.

Observed, against the task wording (not a defect, the Specs pin it):
- The Summary says the left approach triples and the acceptance asks for "the longer left approach". Measured, a drop into a card at the area's left edge (first column, and the residual `#m-doctor` row) gets `d = 0px`, a perpendicular approach with no hook. The control tree gets `d = 8px` there, but its control point sits at `x = -8px`, outside the svg viewport, so it is clipped. A dialog with one run (the common case) therefore shows the wider gaps and an unchanged approach. The longer approach is visible only in columns to the right of the first (`60px` vs `20.78px`). This follows from `d = min(..., x2)` and the pinned `8, x2 = 6 -> 6` row.

Not exercised:
- `#m-doctor` `margin-top: 8px`, `#m-agent` `margin-bottom: 12px`, the card padding and the card radius. They are outside the frozen scope; the review checked them as untouched in the diff.
- The unit suites named in the Specs. The live test must not run a `*.test.ts` suite.

Checker notes (fixed before the tally was final):
- The first wait required `subs + doctors` paths, but a residual doctor card has no connector. The wait now requires `subs + 1`.
- A sub path carries the parent run handle as `data-to`, so it was first classified as a run chain. The sub match now runs on `to == from` before the chain test.
- The capped and uncapped filters first used the already-capped `d`. They now compare against the pre-cap `5 * round(3 * base / 5)`.

Cleanup: `RESULT tag=merged pass=14 fail=0`, `RESULT tag=pre-fix pass=14 fail=0`, `B1-board-relations-identical` PASS. No node process stays anchored on `/tmp/lt302`, `/tmp/pi-subagents-1000` holds 0 `lt302` files, and `git status --short` in the worktree is empty.
