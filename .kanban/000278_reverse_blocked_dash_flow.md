---
name: "feat: reverse dash flow on blocked-task board links"
priority: "low"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "reverse-blocked-dash-flow"
---

# Summary
On the web dashboard board, dashed connector lines between blocked task cards currently animate flowing towards the blocker card. Reverse the animation so the dashes flow in the other direction (away from the blocker, towards the blocked card). The agent-card connectors in the task details dialog must keep their current direction.

# Specs
## Need

On the web dashboard board, the dashed lines linking a blocked task card to its blocker cards animate their dashes flowing towards the blocker. The user wants the animation to run in the opposite direction: dashes flow away from the blocker, towards the blocked card. The dashed lines linking the agents' cards in the task details dialog must NOT change.

## Facts (from code inspection)

- All dashboard UI is one template literal: `PAGE` in `src/webui/page.ts` (CSS+JS inline, no build step).
- Board task-card connectors: CSS rule `#relations path` at `src/webui/page.ts:134`, `stroke-dasharray: 6 4; animation: dashflow 1s linear infinite`. Keyframes `@keyframes dashflow { to { stroke-dashoffset: -10; } }` at `src/webui/page.ts:136`. Hover class `#relations path.relations-hot` (line 135) changes opacity only.
- Paths are drawn from the blocked card's right edge to the blocker's left edge by `curve()` at `src/webui/board.ts:210-226` (comment says the dash animation flows towards the blocker), so dashoffset 0 -> -10 flows towards the blocker.
- Agent-card connectors in the task details dialog: rule `#agent-relations path` at `src/webui/page.ts:228`, drawn by `drawAgentRelations()` at `src/webui/page.ts:749-777` into `#agent-relations` inside modal pane `#m-agent`. They reuse the SAME `@keyframes dashflow` and the same `curve()`.
- A reduced-motion rule at `src/webui/page.ts:157` disables the animation for both selectors in one rule.
- Tests: `tests/webui/board.test.ts:234-237` asserts exact strings `"stroke-dasharray: 6 4"` and `"@keyframes dashflow { to { stroke-dashoffset: -10; } }"`. `tests/webui/page.test.ts:35` fetches the served page and asserts CSS.

## Constraints

- Do NOT edit `@keyframes dashflow` or its -10 value: the dialog's `#agent-relations path` shares it.
- Do NOT flip path geometry in `curve()` in `src/webui/board.ts`: the dialog reuses it.
- Do NOT touch the `#agent-relations path` rule (page.ts:228) or the reduced-motion rule (page.ts:157).

## Implementation (decided)

Add `animation-direction: reverse;` to the `#relations path` rule at `src/webui/page.ts:134` only. The dash pattern is `6 4` (period 10, same as the keyframe offset delta), so the reversed loop stays seamless, and only board links reverse.

Fallback (only if reverse direction proves visually wrong, which is not expected): a new board-only keyframes `to { stroke-dashoffset: 10; }` referenced only by `#relations path`. Do not take this path without cause.

## Acceptance criteria

1. `pnpm test` passes.
2. Update the assertions in `tests/webui/board.test.ts` around lines 234-237: the existing exact-string assertions for `stroke-dasharray: 6 4` and `@keyframes dashflow { to { stroke-dashoffset: -10; } }` still hold, and add assertions that the `#relations path` rule contains `animation-direction: reverse` while the `#agent-relations path` rule does not contain it.
3. Manual visual check (when the dashboard is served with webUi enabled): dashes on blocked-task links drift from the blocker card towards the blocked card; agent-card links in the task details dialog keep the old direction.

# Notes
