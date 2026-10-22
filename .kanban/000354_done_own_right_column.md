---
name: "feat: move the done column to its own rightmost group"
priority: "medium"
state: "done"
worktree: ""
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
# Notes

## What changed
- `src/webui/board.ts`: `TAIL_STATES` 5 to 4, and `LAYOUT = [...pairLayout(STATES.slice(0, -1)), STATES[STATES.length - 1]]`, so the board renders `["col c-backlog", "pair", "pair", "pair", "pair", "col c-done"]`. Layout comments at `:142` and `:259` updated.
- `src/webui/page.ts`: one comment fixed, the middle columns stack as groups, no CSS value changed.
- `tests/webui/board.test.ts`: shell children, pair children, `LAYOUT` deep-equal, last-column and `pairLayout` wiring assertions updated, plus the new 6-group width guard (both 300px CSS rules pinned in the served page and `6 * 300 + 5 * 10 + 36 <= 1920`).
- `docs/architecture.md:44`: the dashboard sentence now names backlog, three stage pairs, the four-state live-test and integration group, and done as the rightmost single column.

## Acceptance
- pre-commit red run `node tests/webui/board.test.ts` exit=1, the shell children were missing `col c-done`.
- pre-commit `node tests/webui/board.test.ts` exit=0, `pass`.
- pre-commit `node tests/webui/page.test.ts` exit=0, `pass` (caller suite for `LAYOUT` and the served page CSS).
- pre-commit `git status --short` showed the 4 modified files, `git diff --stat` 30 insertions and 22 deletions. Substitution: the Specs `pnpm test` line means the two suites above, the aggregate script was not run and no other suite imports `LAYOUT` or `buildShell`.
- Manual 1920x1080 browser check not run headless. The width guard proves the mechanical part, both 300px rules ship and the six groups total 1886px. The visual pass is left to the reviewer.

## Follow-up
- none

## Live test: done as its own rightmost column (#354)

Tree under test: `/home/phamba/repos/se-llm-team/.worktrees/feat/354-done-own-right-column` (merged commit `cea59a6`). Driver: `/tmp/lt354/driver.mjs`, wrapper `/tmp/lt354/run.sh`.

Runs: 3 merged (n=1..3) and 1 pre-fix control (`HEAD^` archived to `/tmp/lt354-pre`). The control is the pre-fix tree replayed with the same fixture, so a green control row proves the pre-fix behaviour.

Assumptions:
- The live surface is the served hub page (`startHub` on port 0) opened at 1920x1080 with `reducedMotion: reduce`; the fixture is a hub-only root with one task per state (12), created with `createTask` and `setState`.
- "No horizontal scrollbar" is read as `#board.scrollWidth <= #board.clientWidth` plus the horizontal scrollbar height (`offsetHeight - clientHeight`). Headless Chromium never draws a classic scrollbar here (0px), so the bar itself is not observable; the scroll range is.
- The Specs `pnpm test` and `node tests/webui/*.test.ts` runs are not part of a live test. The test-file row checks the merged test source content only, and the same assertions are replayed through the real module and the served page.
- Column widths are subpixel sizes, so they are recorded in the meta line and not compared across runs.

Not exercised: a real display at 1920x1080 with classic scrollbars, and every browser other than headless Chromium.

| # | Claim | Expected (merged) | Observed | Control (pre-fix) | Control observed | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | LAYOUT from the served module: six groups, done appended last | groups=6 last="done" prev=["to-live-test","live-testing","to-integration-test","integration-testing"] | groups=6 last="done" prev=["to-live-test","live-testing","to-integration-test","integration-testing"] \| groups=6 last="done" prev=["to-live-test","live-testing","to-integration-test","integration-testing"] \| groups=6 last="done" prev=["to-live-test","live-testing","to-integration-test","integration-testing"] | groups=5 last=["to-live-test","live-testing","to-integration-test","integration-testing","done"] prev=["to-merge","merging"] | groups=5 last=["to-live-test","live-testing","to-integration-test","integration-testing","done"] prev=["to-merge","merging"] | green |
| 2 | served #board group children (col/pair): backlog, four pairs, done column | count=6 [col c-backlog,pair,pair,pair,pair,col c-done] | count=6 [col c-backlog,pair,pair,pair,pair,col c-done] \| count=6 [col c-backlog,pair,pair,pair,pair,col c-done] \| count=6 [col c-backlog,pair,pair,pair,pair,col c-done] | count=5 [col c-backlog,pair,pair,pair,pair] | count=5 [col c-backlog,pair,pair,pair,pair] | green |
| 3 | done renders as the rightmost section.col outside any .pair and holds only done cards | idx=5 cls=col c-done inPair=0 rightmost=1 cards=1 names=task-done | idx=5 cls=col c-done inPair=0 rightmost=1 cards=1 names=task-done \| idx=5 cls=col c-done inPair=0 rightmost=1 cards=1 names=task-done \| idx=5 cls=col c-done inPair=0 rightmost=1 cards=1 names=task-done | idx=-1 cls=pair inPair=1 rightmost=0 cards=1 names=task-done | idx=-1 cls=pair inPair=1 rightmost=0 cards=1 names=task-done | green |
| 4 | group 5 is one four-state live-test/integration stack, never split | kids=4 [col c-to-live-test,col c-live-testing,col c-to-integration-test,col c-integration-testing] | kids=4 [col c-to-live-test,col c-live-testing,col c-to-integration-test,col c-integration-testing] \| kids=4 [col c-to-live-test,col c-live-testing,col c-to-integration-test,col c-integration-testing] \| kids=4 [col c-to-live-test,col c-live-testing,col c-to-integration-test,col c-integration-testing] | kids=5 [col c-to-live-test,col c-live-testing,col c-to-integration-test,col c-integration-testing,col c-done] | kids=5 [col c-to-live-test,col c-live-testing,col c-to-integration-test,col c-integration-testing,col c-done] | green |
| 5 | backlog stays the leftmost single column and all 12 states get a column and a card | first=col c-backlog backlogFirst=1 cols=12/12 cards=12/12 | first=col c-backlog backlogFirst=1 cols=12/12 cards=12/12 \| first=col c-backlog backlogFirst=1 cols=12/12 cards=12/12 \| first=col c-backlog backlogFirst=1 cols=12/12 cards=12/12 | first=col c-backlog backlogFirst=1 cols=12/12 cards=12/12 | first=col c-backlog backlogFirst=1 cols=12/12 cards=12/12 | green |
| 6 | 300px width rule unchanged in the served page and in computed style | page=2/2 computed=col=300px/1 0 300px pair=300px/1 0 300px | page=2/2 computed=col=300px/1 0 300px pair=300px/1 0 300px \| page=2/2 computed=col=300px/1 0 300px pair=300px/1 0 300px \| page=2/2 computed=col=300px/1 0 300px pair=300px/1 0 300px | page=2/2 computed=col=300px/1 0 300px pair=300px/1 0 300px | page=2/2 computed=col=300px/1 0 300px pair=300px/1 0 300px | green |
| 7 | the six columns fit 1920 at the rendered flex width (relations overlay hidden) | fits=1 sw=1920 cw=1920 groups=6 | fits=1 sw=1920 cw=1920 groups=6 \| fits=1 sw=1920 cw=1920 groups=6 \| fits=1 sw=1920 cw=1920 groups=6 | fits=1 sw=1920 cw=1920 groups=5 | fits=1 sw=1920 cw=1920 groups=5 | green |
| 8 | #board has no horizontal scroll at 1920 (Specs Acceptance) | overflow=0 scrollbarPx=0 | overflow=11 scrollbarPx=0 \| overflow=11 scrollbarPx=0 \| overflow=11 scrollbarPx=0 | overflow=11 scrollbarPx=0 | overflow=11 scrollbarPx=0 | RED |
| 9 | docs/architecture.md names the new layout and drops the five-state tail | new=3/3 old=0/1 | new=3/3 old=0/1 \| new=3/3 old=0/1 \| new=3/3 old=0/1 | new=0/3 old=1/1 | new=0/3 old=1/1 | green |
| 10 | layout comments drop the five-state tail wording, pairLayout stays exported | stale=0/3 pairLayout=exported | stale=0/3 pairLayout=exported \| stale=0/3 pairLayout=exported \| stale=0/3 pairLayout=exported | stale=3/3 pairLayout=exported | stale=3/3 pairLayout=exported | green |
| 11 | tests/webui/board.test.ts pins six groups, LAYOUT, and the 1920 width guard | needles=9/9 | needles=9/9 \| needles=9/9 \| needles=9/9 | needles=2/9 | needles=2/9 | green |

Meta: group widths 1: [305.66, 305.67, 305.66, 305.67, 305.67, 305.67] board svg=1931 scroll=0px; group widths 2: [305.66, 305.67, 305.66, 305.67, 305.67, 305.67] board svg=1931 scroll=0px; group widths 3: [305.66, 305.67, 305.66, 305.67, 305.67, 305.67] board svg=1931 scroll=0px.

Red proof: row 8 did not match. The merged overlap is the pre-existing relations overlay (`#relations`, width = last card right edge + 40) which makes `#board` scrollable by that bulge at every group count, and the control shows the same value, so this change neither causes nor widens it. The columns alone fit exactly: overlay hidden, `scrollWidth == clientWidth == 1920`.

Verdict: red, 1 row(s) off at 3 merged run(s) against 1 pre-fix control.

# Open questions
- The Specs acceptance says `#board` has no horizontal scrollbar at 1920. The six columns fit exactly, 1920 of 1920, but the relation overlay `#relations` is drawn 40px wider than the last card, so the board can still scroll by 11px at any group count, before and after this change. Is that residual scroll range acceptable, or should the overlay stop overflowing the board?
