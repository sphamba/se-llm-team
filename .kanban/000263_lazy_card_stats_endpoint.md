---
name: "feat: lazy card stats batched endpoint"
priority: "high"
state: "backlog"
worktree: ""
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
