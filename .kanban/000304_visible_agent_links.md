---
name: "fix: keep agent card links visible when they curve outside the agent area"
priority: "medium"
state: "live-testing"
worktree: "fix/304-visible-agent-links"
issuer: "user"
complexity: "simple"
shortName: "visible-agent-links"
blockedBy: ""
---

# Summary
The dialog's connector SVG clips its own strokes at the agent area box, so run-chain bows and left-edge drops are cut. Let the SVG paint outside its box, keep it under the log pane, drop the x2 cap in dropCurve so left-edge cards get the long approach, and stop the dialog card from growing a horizontal scrollbar.

# Specs
## Problem

The connectors in the task detail dialog are drawn in `#agent-relations`, an absolutely positioned SVG sized to `#m-agent` (`src/webui/page.ts:230`). That SVG rule has no `overflow` declaration, so the SVG root's default `overflow: hidden` cuts every stroke at the `#m-agent` box. Two connectors leave that box today:

- The run-chain bow from `curve()` (`src/webui/board.ts:215`) when a run pair wraps to a second line: its control point can sit left of the box (for example `x1=200, x2=0` puts a control at `-70`), so the stroke swings outside the left edge.
- The sub and doctor drops from `dropCurve()` (`src/webui/page.ts:748`) once the `x2` cap is dropped: a card near the area's left edge then gets a full-length approach that sweeps left of the box.

`#m-agent` and `#modal` never clip. The next clipper above the SVG is `#m-box` (`overflow: auto`, `border-radius: 10px`, `padding: 0 18px 18px`), which is the dialog card itself.

## Change

### 1. Let the SVG paint outside its box

Add `overflow: visible` to the `#agent-relations` rule. Nothing else in that rule changes. The SVG keeps `position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none`, and it keeps its host-relative coordinate math (no `viewBox`, no width/height attributes).

Update the 000237 comment above the rule so it states that the layer paints outside the area and is bounded by the dialog card.

### 2. Keep the strokes under the log pane

The log pane `#m-log` sits inside `#m-agent` (`page.ts:347`) after the SVG and is static, so the z-index-1 SVG paints over it. Give the pane its own layer above the SVG: add `position: relative; z-index: 2;` to the `#m-log` rule. The cards keep `z-index: 2`, and the sticky `#m-head` (`z-index: 1`, outside the `#m-agent` stacking context) keeps covering the whole area from above.

Leave `#m-log-meta`, `#m-attrs`, `#m-body` and `#m-head` unchanged.

### 3. Keep the card from growing a horizontal scrollbar

Once the strokes paint outside the SVG box, they count toward `#m-box`'s scrollable overflow on the right. Change the card rule from `overflow: auto` to `overflow-y: auto; overflow-x: hidden`. The card then clips the strokes at its border, which is the agreed boundary: lines stay inside the dialog card, and no horizontal scrollbar appears.

### 4. Drop the `x2` cap in `dropCurve`

After #303 the function reads (around `src/webui/page.ts:748-755`):

```js
const v = Math.max(8, Math.min((y2 - y1) * 0.5, 60));
const base = Math.max(8, Math.min(Math.abs(x1 - x2) * 0.35, 60));
const d = Math.min(5 * Math.round((2.5 * base) / 5), x2);
```

Remove the `x2` cap, so the last line becomes:

```js
const d = 5 * Math.round((2.5 * base) / 5);
```

- `base` keeps its 8px floor, so the smallest `d` is 20px and the path stays valid.
- A card at the area's left edge now gets the same long approach as any other card, and the stroke sweeps outside the box where the dialog card clips it.
- `v` stays as today.
- `curve()` in `src/webui/board.ts` stays untouched, so the board relation lines are unaffected.
- Rewrite the `dropCurve` comment: it no longer "clamps to the space left of the card"; it state that the left approach is `2.5` times the span, rounded to 5px, uncapped, and that the SVG paints it outside the area.

Values the formula must produce:

| `|x1-x2|` | `base` | `d` | control x for `x2 = 6` |
| --- | --- | --- | --- |
| 100 | 35 | 90 | -84 |
| 100 (`x2=300`) | 35 | 90 | 210 |
| 171 | 59.85 | 150 | 144 |
| 200 | 60 | 150 | 144 |
| 23 | 8.05 | 20 | -14 |

## Tests

`tests/webui/page.test.ts`:

- `:794-808` pins `dropCurve` verbatim. The capped 60px base case (`x1=100, x2=300`) keeps `d = 150`; the six-row table changes its two `x2`-capped rows to uncapped: `[240, 40, 40]` becomes `[240, 40, 150]`, and `[100, 6, 6]` becomes `[100, 6, 80]`.
- `:867-868` pins two stub paths ending at `x = 0`. The drop path `M 100 40 C 100 49.5, 0 59, 0 59` becomes the uncapped shape `M 100 40 C 100 49.5, -80 59, 0 59`; the run-chain path keeps `curve()` and does not change.
- Add an assertion that the `#agent-relations` box rule contains `overflow: visible`, and one that the `#m-log` rule carries `position: relative; z-index: 2`.
- Add an assertion that the `#m-box` rule carries `overflow-y: auto; overflow-x: hidden`.
- Do not touch the `#agent-relations path` rule or the reduced-motion rule: `:773-776` byte-mirrors the path rule against the board's `#relations path`.

`tests/webui/board.test.ts` needs no change. Run it to prove `curve()` is untouched.

## Acceptance criteria

Run in the worktree:

- `node tests/webui/page.test.ts` exits 0.
- `node tests/webui/board.test.ts` exits 0.

At live test, in the repo root: `pnpm test` exits 0. Then, by hand in the dialog:

- A dialog with a single run shows the sub card's connector sweeping outside the agent area and staying fully visible.
- A dialog with several runs keeps every connector visible where a wrapped pair curves outside the area.
- No connector is cut at the `#m-agent` boundary. Strokes stop only at the dialog card's border.
- No horizontal scrollbar appears in the dialog, and the connector never paints over the log pane or the sticky header.

## Out of scope

- The card gaps and the 2.5 multiplier (#302, #303).
- Any change to `curve()`, to the dash pattern, or to stroke caps.
- Any layout change outside the dialog card.
- The modal's own scroll behaviour beyond the horizontal guard above.

# Notes
- Checked the four strokes sites in `src/webui/page.ts` and updated them: added `overflow: visible` to `#agent-relations` (000237 comment now states the layer paints outside the area, bounded by the dialog card), added `position: relative; z-index: 2;` to `#m-log`, changed `#m-box` to `overflow-y: auto; overflow-x: hidden`, and removed the `x2` cap from `dropCurve` with a rewritten comment.
- Pinned the CSS claims with a small `cssRule(sel)` extraction helper in `tests/webui/page.test.ts`, next to the 000246 `#m-box.grow` pins. The `#agent-relations path` and reduced-motion rules are untouched.
- Red first: the `#agent-relations` overflow pin failed (`the connector svg no longer clips its own strokes at the agent area box`), then green.
- Conflict, one line: the Specs give `M 100 40 C 100 49.5, -80 59, 0 59` for the stub drop, but the Specs table says a 100px span gives `d = 90`, so the uncapped control x is `-90`. The code and the table agree, so I pinned `-90` for the stub sub path and for the doctor path at `:869` (same `dropCurve`, same 100px span, also `x2 = 0`, also changed by the uncap).
- `tests/webui/page.test.ts` and `tests/webui/board.test.ts` both exit 0. `board.test.ts` proves `curve()` is untouched. Visual checks (no cut strokes, no horizontal scrollbar, log pane stays above the strokes) are live-test only; a page change needs a daemon restart.

Review of e893eec (first pass): pass.
- src/webui/page.ts:231 ends the #agent-relations box rule with `overflow: visible` only, and the 000237 comment now states the layer paints outside the area, bounded by the dialog card.
- src/webui/page.ts:236 puts `position: relative; z-index: 2;` on #m-log, which outranks the z-index-1 SVG; #m-log-meta, #m-attrs, #m-body and #m-head are untouched.
- src/webui/page.ts:292 carries `overflow-y: auto; overflow-x: hidden` on #m-box, the agreed clip boundary.
- src/webui/page.ts:757 drops the x2 cap: base 35 on a 100px span gives d 90 and control x -90 (tests/webui/page.test.ts:805), which matches the Specs table, so the Specs' `-80` stub value is a typo, not a code defect; src/webui/board.ts is absent from the diff and the run-chain pin at tests/webui/page.test.ts:869-871 is unchanged.
- Tests: node tests/webui/page.test.ts exit=0, node tests/webui/board.test.ts exit=0.
- Non-blocking: tests/webui/page.test.ts:873 re-pins the doctor drop to `-90 215` as well; the Specs named only the sub path, but the same uncap reaches it and the pin is right.
- Non-blocking: cssRule() returns the first line-anchored match, so a future second `#m-box {` earlier in PAGE would make that pin read the wrong rule; anchor the selector to its whole line then.
- Durable: the 000304 CSS pins sit next to the 000246 grow pins in tests/webui/page.test.ts; extend cssRule() there instead of adding a second matcher.
- Answered and removed from # Open questions: the Specs table fixes d = 90 for a 100px span, so -90 is settled and the -80 stub value is a typo.

# Open questions
