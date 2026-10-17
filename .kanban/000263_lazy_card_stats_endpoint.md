---
name: "feat: lazy card stats batched endpoint"
priority: "high"
state: "to-review"
worktree: "feat/263-lazy-card-stats-endpoint"
issuer: "#252"
complexity: "simple"
shortName: "lazy-card-stats-endpoint"
---

# Summary
Server half of #252: a batched lazy-stats endpoint (GET /api/card-stats?files=...) that answers per-file agent stats for any board files, so the client (#264) can fetch stats for cards beyond the first 5 when a column unfolds. taskPayload's eager first-5 attach stays unchanged.

# Specs
Parent: #252 (feat: lazy stats on all board cards). This subtask ships the server half: a batched lazy-stats endpoint the client subtask (#264) fetches when a column unfolds. The client half builds against the contract below with a stubbed fetch, so the two can land in either order.

Problem: taskPayload attaches agents only to visibleCards, the first 5 per column plus the backlog task (src/webui/payload.ts:610-656, VISIBLE_CARDS=5); cards 6+ carry no agents and the client's taskStats renders "" until a poll shift includes them. No batched per-file stats endpoint exists (src/hub.ts routes only /api/tasks, /api/task-detail, /api/task-history, /api/agent-log).

Contract (pinned, the client builds against it; do not change it without updating both task files):
- GET /api/card-stats?files=<file>[,<file>...][&project=<id>]
- project resolves like every other route (hub.ts:202-204: url.searchParams.get("project") ?? opts.root, then resolveEntry; unknown project = 404 like /api/tasks).
- Response JSON: { "<file>": { "agents": [AgentEntry[], the same shape taskPayload's rows attach] } }, keyed per requested file; requested files not on the board are omitted; missing or empty files param = {}.
- The agents arrays come from the existing cardAgents (src/webui/payload.ts:573) per task, which already implements #250's rules: done tasks cache in the bounded doneAgents map, non-done tasks parse incrementally through agentHistory, no full-log content in memory. Add NO new server caching; the endpoint computes per request.

Requirements:
1. New payload function (e.g. cardStatsPayload(root, files: string[])) resolving tasks from the files list and calling cardAgents per task; export it from src/webui/payload.ts and the barrel (src/webui/index.ts) so tests import it.
2. Route in src/hub.ts in the GET chain (next to /api/task-history), async like /api/task-history so a slow parse never delays a concurrent client's response.
3. taskPayload's eager first-5 attach stays UNCHANGED (the 5 s poll stays cheap under #250's rules): the endpoint covers cards 6+ only. The first-5-only cap goes away as the user-facing limit (#245) because the endpoint covers the rest.
4. State the big assumptions affecting the piece (e.g. gzipped/rotated logs through the established decompress path, done-cache eviction interplay, hub multi-root resolution).

Acceptance:
- node tests/webui.test.ts passes.
- Live test (feel-based): curl the endpoint on a running hub with real files; every on-board file answers with its agents, a bogus file is omitted, and the eager /api/tasks response still carries the first 5.

Tests: extend the existing 000245 fixture block (tests/webui.test.ts:2339-2440) - it already spins a hub (startHub) with task fixtures and logs; add the endpoint asserts right there. NEVER edit the shared import lines (lines 9-12) - add a NEW import line for the new payload export, so the merge with the client subtask stays trivial. Baseline: the file passes with 757 asserts (grep -c "assert\." tests/webui.test.ts); your additions raise that count.

# Notes

- Server half shipped: `cardStatsPayload(root, files)` in src/webui/payload.ts resolves each requested file against `listAll(root)` and calls `cardAgents` per on-board task, so #250's done memo and incremental parse stay in one place; exported from the barrel (src/webui/index.ts).
- Route in src/hub.ts next to /api/task-history: GET /api/card-stats?files=a.md,b.md[&project=<id>], async; project resolves like /api/tasks, an unknown project 404s with an empty body, and a missing or empty files param answers {}.
- taskPayload's eager first-5 attach is untouched.
- Tests in tests/webui.test.ts: one new payload import line (shared lines 9-12 untouched), route asserts in the 000245 hub block (the hidden card's agents over HTTP, bogus file omitted, empty files {}, unknown project 404) and in-process payload asserts in the 000245 stats fixture (off-board omitted, agents equal the visible row's, empty list {}). 757 to 764 asserts, `node tests/webui.test.ts` passes.
- Live check (feel-based): an in-process hub over a 6-task fixture answered all 6 files (the oldest hidden card with tokens 30), omitted bogus.md, answered {} without a files param, 404 for an unknown project, and /api/tasks still carried agents on exactly the first 5 rows.
- Deviation: the Tests note places the hub fixture at tests/webui.test.ts:2339-2440, but the file closes that hub at line 2284; the route asserts went into the 000245 hub block that does run startHub (around line 315), and the 2339 fixture carries the in-process payload asserts.

# Open questions

- Assumption: swept .log.gz run logs flow through cardAgents' existing decompress path, no endpoint-specific handling.
- Assumption: done-cache population and eviction stay entirely inside cardAgents; cardStatsPayload adds no cache, so the eviction interplay is identical to taskPayload's.
- Assumption: project resolution is by root or unique bare name like /api/tasks; an unknown or duplicate-ambiguous project 404s (empty body).
