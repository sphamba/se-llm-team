---
name: "feat: hold a task on a user blocker at every stage start"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "user-blocker-hold"
---

# Summary
Allow `blockedBy` to carry the literal token `user` in addition to task refs. A task with the token does not start any stage: backlog to to-do, to-do (splitter and developer), to-review, to-merge, to-live-test, to-integration-test. A running agent finishes its current stage; the next gate stops it. The PM adds and removes the token on the user's request, and the board card of a held task gets a 6-on/4-off dashed top/right/bottom border with the solid 3px left accent kept.</summary>
<specs" string="true">## Token

`Task.blockedBy` stays a comma-joined string (`src/kanban.ts:37`, parsed at `:191`, serialized at `:286-289`). A ref whose trimmed value equals `user` (case-insensitive) is a hold. It may mix with task refs (`user, #42`): the task waits for the user AND for every ref, and the refs keep their old meaning. `user` alone is valid.

Only the PM writes or removes `user`; no code adds it. `dropDoneBlockers` (`src/orchestrator/pipeline.ts:630-663`) must keep it (it already does, because `parseInt("user")` is NaN and the filter keeps the ref); pin that with a test. `blockedNums` (`src/kanban.ts:370-377`) and `assertNoBlockCycle` (`:383-392`) already ignore it; leave them alone. Other non-numeric refs stay ignored as today (ghost refs); do not add validation that rejects them.

## Gates

Add one shared predicate for the daemon (for example `hasUserHold(blockedBy)` in `src/kanban.ts`). Skip a held task at each site below. The task stays in its source state and the scan considers the next eligible task, so one hold does not stall the lane. Do not kill a running agent and do not revert its state.

- backlog to to-do: `blockedByUndone` (`src/orchestrator/pipeline.ts:614-621`) returns true when `user` is present; `promoteBacklog` (`:679`, gate calls `:723` and `:730`).
- to-do (splitter and developer): `startTodo` (`src/orchestrator/pipeline.ts:137`) re-reads at `:144-145`; put the check right after `:145`, before the splitter branch at `:146`. This blocks both the Splitter (`:152`) and the developer fallthrough (`:155-157`) and writes no splitter marker, so removing the token restarts the path cleanly with the splitter first.
- to-review to reviewing: the reviewer spawn at `src/orchestrator/pipeline.ts:514` (after `ensureWorktree` `:498`, before `:519`).
- to-merge to merging: `sweepToMerge` before the worktree/rebase side effects at `:267`/`:278` (the guard region is `:238-248`; the merge spawn is `:293`). Do not guard inside `spawnAgent` alone, or a stopped rebase stays without a merger.
- to-live-test to live-testing: the live-tester spawn at `src/orchestrator/pipeline.ts:536`.
- to-integration-test to integration-testing: the integration-tester spawn at `src/orchestrator/pipeline.ts:331`, before `writeMergerSlug` at `:338`.
- Do NOT hold `spawnRunAnalysis` (`src/orchestrator/spawn.ts:274`, called from `liveness.ts:200`, `:229`, `pipeline.ts:235`): it analyses a finished run log, writes no board state, and holding it would lose the analysis.

## UI

`src/webui/board.ts` `syncBoard` (`:440-490`) toggles a `user-hold` class on the card element for every shown task when the token is present, so a poll adds and removes the border live. Preserve the one-shot `enter` class. `cardBaseHtml` needs no change; the outer element class is set in `src/webui/page.ts:449`.

CSS in `src/webui/page.ts`: the held card's 1px top/right/bottom border becomes dashed with the `#relations path` pattern (`stroke-dasharray: 6 4`, `page.ts:134`; test `tests/webui/board.test.ts:246`), 6px on and 4px off. Keep the 3px `border-left: 3px solid var(--ac)`, the 1px border color, the 6px radius and the sizes. The dashed border is static (no animation). A plain `border-style: dashed` does not meet the 6/4 requirement; use a pseudo-element with repeating-linear-gradient or an SVG, clipped by the 6px radius. The `.card:hover { background: ... }` shorthand must not wipe the dashed layers.

The detail dialog `blockedBy` row (`src/webui/page.ts:698-706`) already prints `user` as plain escaped text with no link and must stay that way. `relationPaths` (`src/webui/board.ts:237-257`) must keep drawing no line for `user`.

## PM workflow and docs

The PM adds `user` with `kanban_update`, preserving the existing refs (for example `user, #42`), and on release removes only the `user` token and keeps the refs. The PM may use the grill-me interview when the request is ambiguous; no code path is needed.

Reword `skills/se-llm-team/SKILL.md:18` (state order), `:33` ("blockedBy only gates promotion"), `:37` ("never edit blockedBy after creation"), `docs/architecture.md:19-20` (promotion/auto-drop and the to-do splitter bullet), `docs/agents-and-tools.md:7` and `:13` (splitter at the root), and `agents/splitter.md:9-11` (the splitter must not run on a held task; the hold check is before the splitter branch).

## Tests

- `tests/kanban/blockedby.test.ts`: a `user` ref parses and round-trips; `user, #42` is kept verbatim; the cycle guard ignores it.
- `tests/orchestrator/promote.test.ts`: a backlog task with `user` stays; with `user, #42` stays; `dropDoneBlockers` keeps `user` while dropping a done `#42`; after `kanban_update` removes `user`, the task promotes.
- One case per gate: splitter/developer (`tests/orchestrator/split.test.ts:13`, `:40`, fixtures in `tests/helpers.ts:70-85`), reviewer, merger, live-tester, integration-tester. Each asserts the source state is kept and no agent pid/marker is written, and for the single-slot merger and integration lanes that the next eligible task still runs.
- Web UI: the `user-hold` class and the 6/4 CSS rule in `tests/webui/page.test.ts`; `relationPaths` ignores `user` and `blockedRow` prints it plain in `tests/webui/board.test.ts`. The user checks the dashed border by hand; no browser test.

## Out of scope

No migration of existing task files. No auto-removal of `user`. No kill of a running agent. No relation line for `user`. No change to issuer, priority or complexity. No new validation of other non-numeric refs.

# Specs


# Notes
