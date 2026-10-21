---
name: "feat: mark a user-held task card with a dashed border"
priority: "medium"
state: "backlog"
worktree: ""
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
