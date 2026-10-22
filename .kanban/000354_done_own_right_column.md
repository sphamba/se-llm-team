---
name: "feat: move the done column to its own rightmost group"
priority: "medium"
state: "to-do"
worktree: "feat/354-done-own-right-column"
issuer: "user"
complexity: "simple"
shortName: "done-own-right-column"
---

# Summary
Move done out of the five-state tail into its own single rightmost column. The board gets six groups: backlog, three stage pairs, a four-state live-test and integration stack, and done. Keep the 300px minimum width, which totals 1886px and fits a 1920px screen without horizontal scrolling.

# Specs
## Needs

### Layout

The board must have six groups, left to right:

| # | Group | States |
| --- | --- | --- |
| 1 | backlog, single | `backlog` |
| 2 | pair | `to-do`, `doing` |
| 3 | pair | `to-review`, `reviewing` |
| 4 | pair | `to-merge`, `merging` |
| 5 | stack of four | `to-live-test`, `live-testing`, `to-integration-test`, `integration-testing` |
| 6 | done, single rightmost | `done` |

- `LAYOUT` (`src/webui/board.ts:163`) must produce exactly:
  `["backlog", ["to-do","doing"], ["to-review","reviewing"], ["to-merge","merging"], ["to-live-test","live-testing","to-integration-test","integration-testing"], "done"]`
- `buildShell` (`src/webui/board.ts:261-292`) already renders a string as a single `section.col` and an array as a `div.pair`. No markup change is needed. The direct children of `#board` become:
  `["col c-backlog", "pair", "pair", "pair", "pair", "col c-done"]`.
- Keep the layout derived from `STATES`. Do not hardcode state names. The minimal change: set the tail pairing rule to 4 (`TAIL_STATES` at `src/webui/board.ts:148`) and append the last state as a single column, for example `export const LAYOUT = [...pairLayout(STATES.slice(0, -1)), STATES[STATES.length - 1]]`. Keep `pairLayout` exported.
- Backlog stays the leftmost single column. The integration stack stays one four-state group. Do not split it into a pair, because that would make seven groups.
- Update the layout comments that describe the old five-state tail: `src/webui/board.ts:141-147` and `:259-260`, and `src/webui/page.ts:132-136` if needed.

### Width

- Keep the existing width rule and value exactly: `.col` and `.pair` use `min-width: 300px; flex: 1 0 300px` (`src/webui/page.ts:133-134`). Do not change the CSS.
- Six groups total `6*300 + 5*10 + 36 = 1886px`. That fits `#board` at a 1920px viewport with 34px to spare, and 17px after a classic 17px vertical scrollbar. Flex-grow still makes each group about 305px wide at 1920.
- Below 1920 the board may scroll horizontally. That is accepted.

### Tests (`tests/webui/board.test.ts`)

- Update the shell children assertion at `:106` to the six class names above.
- Update the pair children assertions at `:107-110`. The fifth group has the four live-test and integration states. `done` is a separate sixth child.
- Update the `LAYOUT` deep-equal at `:112`, the last-group assertions at `:115-116`, and the `pairLayout` wiring assertion at `:117`. Assert that the last state is the single rightmost column.
- Keep the "every state gets a column" and "page ships `JSON.stringify(LAYOUT)`" cases green.
- Add a width guard near the layout cases: pin `.col` and `.pair` at `min-width: 300px` and `flex: 1 0 300px` in the shipped page source, and assert `6 * 300 + 5 * 10 + 36 <= 1920` with a message that the six groups fit a 1920px screen. This is the regression check for the requirement.
- Keep the fade, fold, `user-hold`, card markup and relation cases green.

### Docs

- Update `docs/architecture.md:44`. It says the last column stacks five states. State the new layout: backlog, three stage pairs, one group of the four live-test and integration states, and done as the rightmost single column. One sentence, no other docs change.

## Constraints

- Do not change any width CSS value. 300px stays.
- Do not create a seventh group and do not split the integration stack.
- Do not change board behavior: state sorting, the five-card fold, the stage fade, the `to-integration-test` card dim, `user-hold`, payload or markup.
- Do not change `STATES` order. `done` stays last.
- Do not touch `README.md`.
- Keep the diff to `src/webui/board.ts`, `tests/webui/board.test.ts` and the one `docs/architecture.md` sentence, plus comments.

## Acceptance

- `node tests/webui/board.test.ts` exits 0.
- `pnpm test` exits 0.
- Manual check at 1920x1080 with browser zoom at 100%: all six groups show, `#board` has no horizontal scrollbar, and done is the rightmost single column. The board totals 1886px, so it fits.

# Notes
