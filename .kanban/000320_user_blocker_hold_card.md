---
name: "feat: mark a user-held task card with a dashed border"
priority: "medium"
state: "to-live-test"
worktree: "feat/320-user-blocker-hold-card"
issuer: "#318"
complexity: "moderate"
shortName: "user-blocker-hold-card"
---

# Summary
Toggle a `user-hold` class on the card of a task whose blockedBy carries the `user` token, live on every poll, and give that card a 6-on/4-off dashed top/right/bottom border while the 3px left accent, the 6px radius and the sizes stay.

# Specs
## Behaviour

A ref whose trimmed value equals `user` (case-insensitive, one comma part of `blockedBy`, mixed with task refs is fine) marks its task as held. This subtask is the web UI only: token parsing, the daemon gates and the orchestrator tests belong to the sibling subtask.

`syncBoard` (`src/webui/board.ts:439-490`) toggles a `user-hold` class on the card element of every shown task, so a poll adds and removes the border live. Preserve the one-shot `enter` class: it is added on a genuinely new card and dropped on animationend, and a reorder or a poll must neither replay nor lose it.

The check runs in the browser: `src/webui/page.ts` ships the tested helpers by interpolating their source, so anything `syncBoard` calls must also be shipped. Keep the token test inline inside `syncBoard` (one expression, no new interpolation site) rather than adding a helper.

`makeCard` in `src/webui/page.ts` (label region `:449`) keeps `el.className = "card"`; the class comes from `syncBoard`, so `makeCard` and `cardBaseHtml` need no change.

## CSS

In `src/webui/page.ts`: the held card's 1px top, right and bottom border becomes dashed with the same rhythm as `#relations path` (`stroke-dasharray: 6 4`, `page.ts:134`), that is 6px on and 4px off. Keep the 3px `border-left: 3px solid var(--ac)`, the 1px border color, the 6px radius and the sizes. The dashed border is static, with no animation.

A plain `border-style: dashed` does not meet the 6/4 rhythm: use a pseudo-element with `repeating-linear-gradient` or an SVG, clipped by the 6px radius. The `.card:hover { background: ... }` shorthand must not wipe the dashed layers, which is why the dashes belong on a pseudo-element and not on the card background.

## Unchanged

- `relationPaths` (`src/webui/board.ts:237-257`) keeps drawing no line for `user`.
- The detail dialog `blockedBy` row (`blockedRow`, `src/webui/page.ts:698-706`) keeps printing `user` as plain escaped text with no link.

Do not touch `src/kanban.ts`, `src/orchestrator/*` or `tests/kanban/*`, `tests/orchestrator/*`: the sibling subtask owns them.

## Tests

- `tests/webui/board.test.ts`: `syncBoard` adds `user-hold` to a card whose `blockedBy` is `user` and to one with `user, #42`, leaves an unheld card without it, removes the class on the next pass once the token is gone, and keeps `enter` one-shot. `relationPaths` draws nothing for a `user` ref, and `blockedRow` prints it plain.
- `tests/webui/page.test.ts`: the page ships the `.card.user-hold` rule with the 6/4 dash pattern (assert the rule text the way the existing `stroke-dasharray: 6 4` assertion does) and keeps `border-left: 3px solid var(--ac)`.
- Run the touched suites only, never the full suite: `node scripts/test-changed.mjs`, plus `node tests/webui/board.test.ts` and `node tests/webui/page.test.ts`.
- The user checks the dashed border by hand in the browser: no browser test.

## Split scope

Do not split further. The class toggle, the CSS rule and their tests land together in one worktree.

# Notes
- 2026-10-21 Splitter (no split, #320): No split. The "Split scope" section forbids it, and the code agrees. The `user-hold` class toggle in `syncBoard` (`src/webui/board.ts`) and the dashed pseudo-element rule in `src/webui/page.ts` are one UI change. The two suites pin the same class and the same style block, so no test goes green before both parts exist. A cut between the class and the CSS would add one review, one merge and one live test for no parallel gain. The sibling #319 owns the daemon half, so the work is already parallelized.
## Splitter pass: no split (verified)

The decision above stands after a code check. Complexity stays moderate and the task stays in to-do.

- `relationPaths` (`src/webui/board.ts:241`) already skips `user`: `parseInt("user", 10)` is `NaN`, so the blocker lookup finds no task. No edit.
- `blockedRow` (`src/webui/page.ts:698`) already prints `user` as plain escaped text: `taskByNum` returns `undefined` for it. No edit.
- `.card` (`src/webui/page.ts:145`) carries the base border, the radius and the size, and `.card:hover` (`:146`) is a `background` shorthand. The dashes must sit on a pseudo-element so the hover shorthand cannot wipe them.
- `syncBoard` (`src/webui/board.ts:439`) sets no `className` after creation, so `classList.toggle("user-hold", ...)` keeps the one-shot `enter` class safe.

Guidance for the next Splitter pass: keep the token test inline in `syncBoard`. A new helper in `board.ts` needs a new source-interpolation site in `page.ts`, and an unshipped helper throws in the browser on the first poll.

- Durable guidance for future Splitter agents: read the `## Split scope` section first, because a parent Splitter that already sliced the work makes a second split duplicate work. The root `SPECS.md` symlink is shared by root-cwd spawns, so edit the `.kanban/<file>.md` path directly and pass that file name to the kanban tools.

Review of 84a0c8c (first pass): there is no work to review. `git diff b7596fc...HEAD` is empty and `git status --short` is clean, so the worktree sits on the base commit, and this task file carried no reviewer block before this pass.

- `rg -n 'user-hold' src tests` has no match, and `src/webui/board.ts:439` `syncBoard` is unchanged, so no card ever gets the class.
- `src/webui/page.ts:145` `.card` is unchanged: no `.card.user-hold` rule and no dashed pseudo-element. `page.ts:134` still holds the only `stroke-dasharray: 6 4`.
- `tests/webui/board.test.ts` and `tests/webui/page.test.ts` hold no `user-hold` assertion, so neither item of the `## Tests` section exists.
- Tests: start/exit=0 `tests/webui/board.test.ts`, start/exit=0 `tests/webui/page.test.ts`, `node scripts/test-changed.mjs` printed "no modifications, nothing to run". The tree is green at base, so this is missing work and not a red suite.
- Nothing for #320 exists on any branch: `git grep -c 'user-hold'` returns no match on `main`, `feat/318-user-blocker-hold`, `feat/319-user-blocker-hold-daemon` and `feat/320-user-blocker-hold-card`. The Developer pass ended before its first commit, so the redo starts from the Specs and there is no partial diff to keep.

## Splitter pass 3: no split after the failed Developer pass (2026-10-21)

No split. State, complexity and worktree stay as they are, and the task stays in to-do.

The first Developer run added no code (see the review note above), so this pass checked if the redo should fan out. It must not:

- `## Split scope` says "Do not split further". The class toggle and the CSS rule are one UI change in one worktree.
- The two halves do not parallelize. `rg -n 'user-hold' src tests` finds no match, so both halves start from zero. The `syncBoard` toggle (`src/webui/board.ts:439`) and the `.card.user-hold` rule (`src/webui/page.ts:145`) are about 10 lines in total. Two subtasks would add one review, one merge and one live test for no gain in wall-clock time.
- The tests do not separate. `tests/webui/board.test.ts` asserts the class, `tests/webui/page.test.ts` asserts the rule text, but the page test needs the class name that the board toggle emits. A green suite needs both halves.
- The work is already parallel with #319 (daemon, now in reviewing), and the parent #318 waits on #319 and #320 together.

Code check for the Developer redo:

- `src/webui/page.ts:145` `.card` has `border: 1px solid var(--border); border-left: 3px solid var(--ac); border-radius: 6px`. `:146` `.card:hover` sets only `background`, so a pseudo-element keeps the dashes safe. The base rule has no dashed style yet.
- `src/webui/page.ts:134` `#relations path` still holds the only `stroke-dasharray: 6 4`. Use that rhythm for the 6/4 dashes.
- `src/webui/board.ts:439` `syncBoard` sets no `className` after creation, so `el.classList.toggle("user-hold", ...)` leaves the one-shot `enter` class alone.
- `relationPaths` (`board.ts:241`) and `blockedRow` (`page.ts:698`) already handle `user` as plain text. No edit there.

Guidance for future Splitter agents on this repo: read `## Split scope` before you weigh a split, then run the code check. A yes-split here must also name the worktree of each subtask, because the parent worktree stays with the parent.

## Developer pass (#320, feat, moderate)

Worktree `feat/320-user-blocker-hold-card`, fast-forwarded to base `b7596fc` first (HEAD was `84a0c8c`, whose tree already equalled main).

- `src/webui/board.ts` `syncBoard`: one `el.classList.toggle("user-hold", ...)` after the creation branch, token test inline (`String(t.blockedBy || "").split(",").some((r) => r.trim().toLowerCase() === "user")`). No new helper and no new interpolation site, so nothing unshipped can run in the browser. `classList.toggle` leaves `enter` alone: the pin asserts the exact `card enter` string on the pass after the token goes.
- `src/webui/page.ts`: `.card.user-hold` turns the 1px top/right/bottom border transparent (box size, the solid 3px left accent and the 6px radius stay), and `.card.user-hold::after` paints three `repeating-linear-gradient` layers, 6px on and 4px off, on the border box (`inset: -1px -1px -1px -3px`, because an absolute child is placed from the padding box), `pointer-events: none`, clipped by `border-radius: 6px`. The dashes sit on the pseudo-element, so `.card:hover`'s `background` shorthand cannot wipe them. Static, no animation.
- `relationPaths` and `blockedRow` are untouched; both now carry a `user` pin.
- Tests written first and seen red (`a \`user\` blockedBy marks the card held`, `the held card's top and bottom edges dash 6px on and 4px off`), then green: `tests/webui/board.test.ts` (add, remove on the next pass, `user, #42`, case-insensitive token, unheld card, one-shot `enter`, `relationPaths` draws nothing for `user`, `blockedRow` prints it plain) and `tests/webui/page.test.ts` (the 6/4 layers, the transparent top and bottom border, the kept 3px left accent and 6px radius).
- The `El` stub in `tests/webui/board.test.ts` gained `classList.toggle` over `className` (Set-based, so class order is stable and the existing exact `card enter` asserts still hold). `page.test.ts` never runs `syncBoard` on its stub, so its stub is unchanged.
- Suites: `node tests/webui/board.test.ts` exit=0, `node tests/webui/page.test.ts` exit=0, `node scripts/test-changed.mjs` exit=0 (5 suites: agentlog, board, hub, logpane, page). The full suite stays the live tester's gate. The dashed border itself is a by-hand browser check after a daemon restart, as the Specs say.

Durable finding for future Developer passes on this repo: a backtick inside a CSS comment in `page.ts` closes the `PAGE` template literal, and every import of the module then dies with `ERR_INVALID_TYPESCRIPT_SYNTAX` pointing at the comment word. Keep `PAGE` comments backtick-free.

Re-review of f90f233 (the earlier pass had no work; this pass reviews the feature commit):
- `src/webui/board.ts:462` runs the token test inline on every pass, `String(t.blockedBy || "").split(",").some((r) => r.trim().toLowerCase() === "user")`, so no new helper and no new interpolation site beside `page.ts:398`. `src/webui/page.ts:463` drops only `enter` on animationend, so the held class survives the one-shot entrance.
- `src/webui/page.ts:152` turns the three 1px border colours transparent and `:153` paints top, right and bottom on `::after` at the 6-on/4-off rhythm, `inset: -1px -1px -1px -3px` reaching the border box from the padding box an absolute child is placed in, so `.card:hover`'s background shorthand cannot wipe it. `src/webui/page.ts:145` `.card` is untouched: the 3px `--ac` left accent, the 6px radius, the 1px size and the padding stay. Static, no animation.
- `relationPaths` (`src/webui/board.ts:241`) and `blockedRow` (`src/webui/page.ts:698`) are unchanged and both now carry a `user` pin. The diff touches only the four in-scope files, never `src/kanban.ts`, `src/orchestrator/*`, `tests/kanban/*` or `tests/orchestrator/*`.
- Tests: start/exit=0 `tests/webui/board.test.ts`, start/exit=0 `tests/webui/page.test.ts`, start/exit=0 `node scripts/test-changed.mjs` (5 suites: agentlog, board, hub, logpane, page), log at `/tmp/rv-*.log`.
- Nit (non-blocking): `tests/webui/page.test.ts:594` pins the left accent and the radius on the base `.card` rule only, so an override added to `.card.user-hold` would not fail, and the `border-right-color: transparent` half of `page.ts:152` is unpinned. Upgrade path: assert that the `.card.user-hold` rule carries no `border-left` or `border-radius`, and pin the right colour too.
- Nit (non-blocking): `page.ts:153` hardcodes the base border widths in `inset`, so a later `.card` border-width change drifts the dashes off the edges. Upgrade path: restate the insets from the border widths with `calc()`.
- No unvoiced assumption: the developer's Notes name the transparent border colours and the `El` stub's `classList.toggle`, and the Specs' `## Split scope` and `## Unchanged` items hold.

