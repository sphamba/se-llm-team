---
name: "feat: token stats on visible board cards with done-task caching"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "visible-card-token-stats"
blockedBy: "#244"
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
