---
name: "feat: wider agent card gaps and longer sub/doctor curves in the task detail dialog"
priority: "medium"
state: "backlog"
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
