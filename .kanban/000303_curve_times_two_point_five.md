---
name: "fix: cut the sub and doctor curve multiplier from 3 to 2.5"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#302"
complexity: "simple"
shortName: "curve-times-two-point-five"
---

# Summary
In the task detail dialog, change the sub and doctor curve multiplier from 3 to 2.5, so the largest left approach is 150px instead of 180px. The nearest-5px rounding, the 8px floor, the 0.35 span ratio and the x2 cap stay as they are.

# Specs
## Goal

The tripled left approach of the sub and doctor curves reads too long. Change the multiplier from 3 to 2.5. Keep the nearest-5px rounding and the last-position `x2` cap. Nothing else changes.

## Change

In `dropCurve` (`src/webui/page.ts:748`), one line:

```js
const base = Math.max(8, Math.min(Math.abs(x1 - x2) * 0.35, 60));   // unchanged
const d = Math.min(5 * Math.round((2.5 * base) / 5), x2);           // was 3 * base
```

- `v`, the departure control, stays as today.
- The `base` clamp (8px floor, 60px cap, 0.35 span ratio) stays as today, so the largest reach becomes 150px instead of 180px.
- The `x2` cap stays last.
- `curve()` in `src/webui/board.ts` stays untouched. No stroke style change.
- Rewrite the comment above `dropCurve` (`src/webui/page.ts:744-747`) to say "2.5 times, rounded to 5px", not three times.

Values the formula must produce:

| `base` | today `d` | new `d` |
| --- | --- | --- |
| 8 | 25 | 20 |
| 20 | 60 | 50 |
| 35 | 105 | 90 (87.5 rounds up) |
| 60 | 180 | 150 |
| 60, `x2` = 40 | 40 | 40 |
| 8, `x2` = 6 | 6 | 6 |

## Tests

`tests/webui/page.test.ts` pins the old multiplier:

- `:801`, the exact-path pin for a capped 60px base: the control point moves from `300 - 180 = 120` to `300 - 150 = 150`, so the expected path becomes `M 100 40 C 100 49.5, 150 59, 300 59`. Update the assertion text with it.
- `:807`, the six-row table: rows change to `[100, 123, 20]`, `[100, 157, 50]`, `[100, 200, 90]`, `[100, 300, 150]`, and the two `x2`-capped rows `[240, 40, 40]` and `[100, 6, 6]` stay.
- `tests/webui/board.test.ts` needs no change; run it to prove `curve()` is untouched.

## Acceptance criteria

Run in the worktree:

- `node tests/webui/page.test.ts` exits 0.
- `node tests/webui/board.test.ts` exits 0.

At live test, in the repo root: `pnpm test` exits 0, and the user opens a task detail dialog with more than one run column and judges the approach length.

## Out of scope

- The live-test observation of #302: a single-run dialog puts its only column at the area's left edge, so `x2 = 0` and the run-in is perpendicular. This task does not change that.
- The card gaps from #302. They stay at 16px and 8px.
- No rounded stroke caps, no dash change, no config key.

# Notes
