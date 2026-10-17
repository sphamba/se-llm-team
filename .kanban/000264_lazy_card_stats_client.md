---
name: "feat: lazy card stats client fetch cache animation"
priority: "high"
state: "doing"
worktree: "feat/264-lazy-card-stats-client"
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
