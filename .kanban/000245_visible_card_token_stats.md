---
name: "feat: token stats on visible board cards with done-task caching"
priority: "medium"
state: "reviewing"
worktree: "feat/245-visible-card-token-stats"
issuer: "user"
complexity: "moderate"
shortName: "visible-card-token-stats"
blockedBy: ""
---

# Summary
Follow-up to #242: the shipped light rows carry no stat data, so board cards lost their token stat line. Restore it on the visible cards only (before "show more"), with done-task stats cached and invalidated when a task leaves done. Doctor data stays in the detail endpoint.

# Specs
## Goal
Restore the token stat line on the board cards, as decided after #242 shipped. #242 split the webui payload into light rows and a per-task detail endpoint, but the shipped light rows (commit 95843be) carry no agent or doctor data, so the cards' token stat line renders empty. Decided shape: stats back on visible cards, cached for done.

## Facts (current state)
- Shipped (#242, commit 95843be): GET /api/tasks serves light rows only (file, num, name, shortName, state, priority, complexity, issuer, blockedBy, worktree, updated, summary). No body, no agent history, no log parsing. GET /api/task-detail?num=N returns the light row plus body, specs, notes, openQuestions, the agent history, and the doctor entries; unknown, non-integer or missing num answers 404 with a JSON error body.
- The card renderer reads t.agents and t.doctors and degrades gracefully (t.agents || [], t.doctors || []), so the stat line is empty today.
- The card stats previously came from logStats (statsCache, payload.ts:219), memoized by log size; the 429 MB log tree parsed on the first open after a daemon restart — the cost #242 removed from the board payload.
- syncBoard renders 5 cards per column (src/webui/board.ts:321) behind a "show more" control.

## Decided direction (user)
- Token stats back on the board cards, for visible cards only: the cards each column renders before "show more". Cards behind "show more" need no stats.
- Stats for tasks in done may be cached (done logs never change); the cache must invalidate if a task's state leaves done.
- Doctor data stays OFF /api/tasks (confirmed in #242): per-task doctor entries remain in /api/task-detail only.

## Required changes
1. /api/tasks light rows carry the agent-history token stat data the card stat line needs, for the visible subset: the first 5 tasks per column per project (the cards rendered before "show more", same order as the renderer). Cards behind "show more" carry no stats.
2. Done-task stats cached: done logs are immutable; serve cached stats and invalidate when a task's state leaves done. Active-state stats must stay fresh enough for the spinners and the 1 s/5 s cadence.
3. Restore the card stat line rendering in src/webui/board.ts. Keep the graceful degradation for cards without stats.
4. Keep the shipped detail endpoint and the poll behaviour unchanged: openTask fetches the detail on every open (no client-side cache), the poll re-fetches the open task's detail while a modal is open, and paces the 1 s/5 s cadence on the fresh detail (refreshMs(openDetail)).
5. Keep the board payload light: no full log-tree parsing per poll; stats only for the visible subset.

## Constraints
- No new dependencies, no framework; keep the current template-string client.
- Do not change the .kanban task file format or the log file formats.
- Do not touch /api/agent-log or the log panel.

## Acceptance criteria
- `pnpm test` passes, including tests in tests/webui.test.ts that assert: the visible subset of /api/tasks rows carries the token stat data; cards behind "show more" carry none; done-task stats come from the cache and invalidate when a task leaves done; /api/tasks rows still carry no body/specs/notes/openQuestions/doctor keys.
- `pnpm test:changed` passes for the touched files.

# Notes
- Splitter (no split, 2026-02-05): kept as one task. The server change (light-row stats + done cache) and the client change (stat line rendering) are not parallel: the client binds to the field names the server emits, and both add tests to tests/webui.test.ts, the shared hub file. Splitting visible-subset stats from the done cache does not help either, since both touch the same logStats/statsCache region of src/webui/payload.ts. Same cross-cutting contract as 000242: one developer, one review pass.
- Developer (2026-02-05, commit 11c2e45): tests first, then the server change. Red run: "a visible card's row carries the agent stat data" failed with undefined !== []. Implementation in src/webui/payload.ts only: a doneAgents per-root cache with cardAgents (delete on sight when the state is not done, so a re-done task re-caches fresh), and visibleCards (first five rows per column, the same sort syncBoard runs) feeding agents into taskPayload's served rows; tasks removed from the board have their cache entries swept per poll. No board.ts change: the card renderer (cardHtml/taskStatsText/taskStats) was intact, the stat line was empty only because the rows carried no agents. The row's agents are the same AgentEntry[] shape the detail serves, so taskStats renders unchanged. First green run failed on a fixture bug: the log rewrite 300 -> 500 was byte-identical in length, so the size-keyed logStats cache never re-parsed; retokened the fixture (300/1500/20000). Scoped suite: node tests/webui.test.ts and pnpm test:changed (maps to tests/webui.test.ts) pass. The full suite was not run per policy.

# Open questions
- The visible subset's five-per-column cap is the server constant VISIBLE_CARDS in payload.ts, mirroring the client's VISIBLE = 5 in page.ts; a future change to one must update the other.
- The visible rows carry the full agent history shape (role, run, alive, status, handle, tokens, duration), the same the detail serves; openTask's shell render therefore now shows the run cards pre-detail for visible tasks (a side effect, no fetch-behavior change).
- The done cache holds only run-log stats; a done task's logs are treated as immutable per the decided direction, so a log that changes while a task stays done stays stale until it leaves done.
