---
name: "fix: card stats fetched lazy, deferred, one by one, top to bottom"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "lazy-stats-queue"
---

# Summary
Card stats fetch as one batched sync fetch inside the show-all click handler, with no deferred queue: tasks revealed by show all rely on that single request, tasks arriving in already-expanded columns are never fetched, and a failed fetch is a silent no-op. Reshape the client into a deferred sequential per-file fetch queue drained top to bottom, re-queued on reveal and on poll arrivals, with failure retry.

# Specs
Goal: card stats (tokens, time) are fetched lazily, deferred, one by one, top to bottom — for show-all reveals, for poll arrivals, and with failure retry.

Facts (fact-found 2026-10-17, harness-verified):
- queueStats (src/webui/page.ts:408-424) fires one batched sync fetch() in the click handler (toggleCol, page.ts:402). No IntersectionObserver, no requestIdleCallback, no setTimeout, no deferred queue exists. A harness run confirmed one click on a 7-task column fires /api/card-stats?files=<2 hidden> and stats land, so the reported never-appear does not reproduce on current source (a stale browser tab holding pre-#264 JS, or a silently swallowed failure, explains it).
- Genuine never-fetch gaps: (a) a task arriving/moving to position 6+ in an already-expanded column is never fetched (refresh() at page.ts:1081-1122 does mergeBoards, render, pollDetail only, never queueStats; the poll payload attaches agents only to the first 5 tasks, src/webui/payload.ts:615-636); (b) a failed fetch (404, e.g. stale hub) is a silent no-op (page.ts:419).
- Endpoint contract (#263, src/webui/hub.ts:247-257): GET /api/card-stats?files=<file>[,<file>...][&project=<id>]; project defaults to the hub root (hub.ts:202); unknown project = bare 404; missing/empty files = {}; response { "<file>": { "agents": [AgentEntry[]] } } via cardStatsPayload (payload.ts:649-658, off-board files omitted). Reusable per-file.
- Merge/render path reusable unchanged: mergeCardStats (board.ts:361-376) into statsKnown + localStorage for done, then render() applies applyCardStats (board.ts:330-355, called page.ts:505) before syncBoard (page.ts:506).
- Dedupe today: statsInFlight Set (page.ts:433), keys statsKey(project,file) (board.ts:316-318); done-with-known-agents skip (page.ts:413).

Decided plan (user request 2026-10-17: lazy, deferred, one by one, top to bottom):

1. Reshape queueStats (page.ts:408-424) into a deferred sequential per-file fetch queue: unfetched cards enqueue their files; the queue drains one file per request, top to bottom in document order, deferred off the click/render path (e.g. setTimeout 0), never blocking render. Reuse statsInFlight and statsKnown for dedupe; keep the done-with-known-agents skip and the localStorage merge unchanged.
2. toggleCol (page.ts:402) enqueues the newly revealed cards' files into the same queue instead of firing the batched request synchronously.
3. Gap (a): refresh() (page.ts:1081-1122) re-enqueues unfetched cards in already-expanded columns after each poll, so tasks arriving at position 6+ get their stats too.
4. Gap (b): a failed request no longer vanishes silently: on failure drop the key from statsInFlight so the next re-enqueue (from refresh()) retries; no console spam, no error UI.
5. The batched request mode of the endpoint stays as-is server side; no hub.ts or payload.ts changes.

Tests: extend the 000264 block in tests/webui/board.test.ts:412-541 — a scenario for the deferred sequential queue (per-file order top to bottom, one at a time, not synchronous with the click), a re-queue-on-arrival scenario (a task appearing at position 6+ in an expanded column gets fetched on the next refresh), and a failure-retry scenario (a failed fetch is retried on a later refresh). Update the PAGE pins at board.test.ts:529-541 (unfold endpoint pin 535, statsInFlight pin 536) to the new mechanism.

Acceptance: node tests/webui/board.test.ts passes, pnpm test passes.

# Notes
