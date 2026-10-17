---
name: "feat: lazy card stats client fetch cache animation"
priority: "high"
state: "done"
worktree: ""
issuer: "#252"
complexity: "moderate"
shortName: "lazy-card-stats-client"
---

# Summary
Client half of #252: unfolding a column queues one batched lazy stats fetch for the newly visible cards, stats appear with a smooth subtle animation (card height grows, no layout jump), and done-task stats cache in browser localStorage keyed per task and project, invalidated when a task leaves done.

# Specs
Parent: #252 (feat: lazy stats on all board cards). This subtask ships the client half. The server endpoint (#263) builds the same contract; build against it with a stubbed fetch so your tests do not need the endpoint to exist.

Contract (pinned by #263): GET /api/card-stats?files=<file>[,<file>...][&project=<id>] answers { "<file>": { "agents": [AgentEntry[]] } }, the same shape taskPayload's rows attach; files not on the board are omitted; missing/empty files = {}. Merge the response's {file: {agents}} into the rows so the existing taskStats/syncCardStats render path works unchanged.

Problem: toggleCol merely adds to expanded and re-renders from the SAME payload rows (src/webui/page.ts:396), so cards 6+ carry no agents and taskStats returns "" (src/webui/board.ts:44). There is no fetch on unfold and no client-side cache; cards 6+ only show stats if a later poll's first-5 shifts include them.

Requirements:
1. Testable lazy-stats logic in src/webui/board.ts as exported functions following the repo pattern (doc injected so tests run without a DOM; inject storage the same way), interpolated into PAGE (src/webui/page.ts) like syncBoard/syncCardStats; page.ts wires toggleCol and the render pass.
2. Every render pass applies lazily-known stats onto the shown rows BEFORE syncBoard, so the 5 s poll (which replaces tab.tasks with agent-less rows for cards 6+) never wipes revealed stats; the payload's own eager first-5 agents take precedence over the client cache.
3. Unfold queues ONE batched fetch for the newly shown non-done agent-less cards (the pinned endpoint, projectParam() like detailUrl), in-flight fetches de-duped; the response merges into the client stats state and re-renders. Non-done tasks NEVER serve stale or cached stats: never write them to localStorage, always fetch fresh (per-poll vs per-unfold refetch cadence is your call under that constraint).
4. Done-task stats cache in browser localStorage keyed per task AND per project (boards are per-project tabs), served without a fetch on the next page load and the next unfold; the entry invalidates when the task leaves done (drop the localStorage entry and the merged agents, a fresh fetch resumes). The orchestrator never stores this - browser localStorage only.
5. Stats appear when they become available with a smooth subtle animation; the card height grows with a subtle animation, no layout jump. The span joins through the existing syncCardStats path (board.ts:296); reuse the in-repo grow pattern (the m-box grow, page.ts 000246) or a CSS-only equivalent; prefers-reduced-motion turns the animation off (existing matchMedia convention).
6. Fail-soft: the fetch failure path (existing catch(() => null) pattern) leaves cards 6+ stats-less until a later poll, never breaks the board. Until #263 merges, the 404s are silent no-ops - expected, do not fix.
7. State the big assumptions affecting the piece (e.g. localStorage availability/quotas, multi-tab staleness, first-5 shift precedence).

Acceptance:
- node tests/webui.test.ts passes.
- Live test (feel-based): unfolding a column gives every revealed card its stats line, appearing smoothly with a subtle height animation; done tasks serve stats from localStorage on the next page load (the network tab shows no refetch for done cards).

Tests: append asserts at the END of tests/webui.test.ts, just before the final cleanup() - direct function tests with stubbed fetch/localStorage/doc (no hub needed; the endpoint is stubbed). NEVER edit the shared import lines (lines 9-12) - add a NEW import line for the new board.ts exports, so the merge with the server subtask stays trivial. Baseline: the file passes with 757 asserts (grep -c "assert\." tests/webui.test.ts); your additions raise that count.

# Notes
- No split (2026-10-17): the pieces share both source files. The lazy-stats state, merge, and localStorage cache (board.ts) are consumed by the page.ts fetch wiring, the animation rides the same syncCardStats span path, and every piece appends asserts at the end of the shared tests/webui.test.ts plus the new board.ts import line. Subtasks would conflict at merge and serialize on the tests for a ~150 line change. One developer is cheaper than 2-3 review passes. Keep the whole client half as one moderate task.

- Implemented (2026-10-17, commit c929345): sortedCol extracted from syncBoard's column sort and shared with the fetch queue; statsKey, applyCardStats and mergeCardStats in src/webui/board.ts implement the lazy-stats state; page.ts render applies known stats onto the rows before syncBoard so the 5 s poll's agent-less cards 6+ never wipe revealed stats, toggleCol queues one batched /api/card-stats fetch per unfold for the newly shown cards without known stats, deduped while in flight and merged on arrival with a re-render; the .card-stats span fades in (statsIn, var(--fade), reduced-motion kill rule).
- Tests: 33 direct-function asserts appended to tests/webui.test.ts over stubbed storage (no DOM, no hub) plus PAGE string pins; 790 total, suite green (one stale #000200 CSS pin updated to the new .card-stats rule text). Live check: unseeded unfold fired exactly one batched /api/card-stats?files=<3 beyond-fold files> request (404 silent no-op), seeded localStorage served done stats with zero fetches and rendered the spans.
- Reviewed (2026-10-17, base main): all seven requirements pass on recorded checks. R1 exported board.ts fns interpolate into PAGE as valid client JS (node's type stripping blanks the TS annotations, String(sortedCol) verified); R2 render applies known stats before syncBoard and the payload's eager first-5 win (t.agents short-circuit); R3 one batched /api/card-stats?files=...+projectParam() per unfold (projectParam at page.ts:708, in the client bundle), statsInFlight dedupe, storage write gated on row state done so non-done never touches localStorage; R4 done stats cache per project+task, stale entries drop with merged agents when the row leaves done; R5 statsIn fade (150ms --fade at page.ts:112) rides syncCardStats's in-place span update so it plays only when the span joins, reduced-motion rule covers .card-stats; R6 failure path is catch(() => null), 404 silent by design; R7 assumptions stated and code-confirmed. Tests: 790 asserts in tests/webui.test.ts (757 baseline), suite green; tests/webui/board.test.ts green after one fix at b386910 - the new .card-stats rule text broke the stale 000200 pin in the split board suite (updated in the monolith, missed in the area copy). page.ts has no split area suite; the monolith covers it.

## Live test (2026-10-17)
- Setup: a hub from this worktree (src/hub.ts, port 4350) served two scratch boards (14 tasks and 7 tasks, 7 done plus 7 to-do with the fold at 5). A real Chromium session ran 58 checks. 57 passed and 1 failed. The merged /api/card-stats endpoint (#263) served the requests. No stub was used, except one deliberate abort.
- To-do unfold: the click sent exactly one request, /api/card-stats?files=<the 2 revealed files>&project=<root>. Both revealed cards got their stats line (613 · 10s and 714 · 10s). A fold and a second unfold sent a fresh request, so non-done cards are never served from a cache. Non-done stats never reached localStorage.
- Done unfold: one batched request for the 2 revealed files, both cards got their stats line, and both entries landed in localStorage under "card-stats|<project>|<file>".
- Page reload: no /api/card-stats request on load. The done unfold after the reload sent no request and showed the cached values. The to-do unfold after the reload requested only its own 2 files.
- Eager rows win: a seeded bogus cache entry for a visible done card stayed ignored, the eager payload text (100 · 10s) was shown, and the bogus entry was unchanged at the end of the run.
- Invalidation: after a done task left done (state changed to "to-review"), its localStorage entry was removed and its new non-done stats (42 · 10s) appeared.
- Fail-soft: an aborted request left the revealed cards without a stats line, wrote nothing to localStorage, kept the board usable, and caused no page error.
- Per project keying: project B showed B values and wrote B keys. Project A kept A values across tab round trips. Known done stats caused no extra request.
- Reduced motion: with prefers-reduced-motion reduce the stats span had animation-name none for an eager card and for a lazily fetched card. The stats still rendered.
- Finding (1 check): the card height does not animate. The stats span fades in (opacity over 9 rAF frames, the 150 ms statsIn animation) and the card below slides smoothly (24 rAF frames through the FLIP transform). The height of the revealed card changes in one frame, from 64.3 px to 85.3 px, on the first frame that carries the span. The Specs clause "the card height grows with a subtle animation" is only partly met. The column shows no jump, because the neighbours move through the FLIP pass.
- No other issue: no uncaught page error, no console error beyond the deliberate abort.
- Assumptions: the fold threshold is 5 cards. The cache key carries the project, so the test used 2 projects. Poll and modal defaults were left in place. The node suite named in the Specs is not part of this live test.

