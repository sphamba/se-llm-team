---
name: "feat: lazy card stats batched endpoint"
priority: "high"
state: "done"
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

- Server half shipped: `cardStatsPayload(root, files)` in src/webui/payload.ts resolves each requested file against `listAll(root)` and calls `cardAgents` per on-board task, so #250's done memo and incremental parse stay in one place; exported from the barrel (src/webui/index.ts).
- Route in src/hub.ts next to /api/task-history: GET /api/card-stats?files=a.md,b.md[&project=<id>], async; project resolves like /api/tasks, an unknown project 404s with an empty body, and a missing or empty files param answers {}.
- taskPayload's eager first-5 attach is untouched.
- Tests in tests/webui.test.ts: one new payload import line (shared lines 9-12 untouched), route asserts in the 000245 hub block (the hidden card's agents over HTTP, bogus file omitted, empty files {}, unknown project 404) and in-process payload asserts in the 000245 stats fixture (off-board omitted, agents equal the visible row's, empty list {}). 757 to 764 asserts, `node tests/webui.test.ts` passes.
- Live check (feel-based): an in-process hub over a 6-task fixture answered all 6 files (the oldest hidden card with tokens 30), omitted bogus.md, answered {} without a files param, 404 for an unknown project, and /api/tasks still carried agents on exactly the first 5 rows.
- Deviation: the Tests note places the hub fixture at tests/webui.test.ts:2339-2440, but the file closes that hub at line 2284; the route asserts went into the 000245 hub block that does run startHub (around line 315), and the 2339 fixture carries the in-process payload asserts.
- Re-review at 3926052: contract holds (payload fn + barrel export + new import line; route async next to /api/task-history, project resolves via hub.ts:202 resolveEntry like /api/tasks, unknown 404; taskPayload untouched; 764 asserts, +7). The three former Open-question assumptions are confirmed in code (.log.gz handled in scanLogLines under cardAgents, no new cache, project by root or unique bare name) and are technical, so the section is deleted; all specs answered, tests/webui.test.ts and tests/webui/hub.test.ts both pass.
## Live test (2026-10-17)

- Ran the merged hub from this worktree (port 4350, isolated HOME, harness under `/tmp/t263`): 6 `done` fixture tasks (`000301`-`000306_stats_fixture_N.md`), one `<slug>.developer.0.log` per task with pi `session` + `turn_end` records (tokens 100 to 600, durations 1000 to 6000 ms), the fixture 6 log gzipped, mtimes 1 to 6 minutes old so fixtures 1-5 are the five visible cards and fixture 6 sits behind "show more".
- Harness `/tmp/t263/check.mjs` (`/tmp/t263/check.out`): 41 checks, 0 failed.
- `GET /api/tasks`: 6 rows, exactly fixtures 1-5 carry `agents` (tokens 100 to 500), the fixture 6 row carries no `agents` key. The eager first-5 attach is unchanged.
- `GET /api/card-stats?files=<all 6>`: 200, keys exactly the 6 requested on-board files, each answers one developer run (`role` developer, `run` 0, `handle` `<slug>.developer.0`, `status` ok, `alive` false) with tokens 100 to 600 and durations 1000 to 6000 ms. The gzipped fixture 6 log served tokens 600, so the decompress path works.
- The endpoint agents for a visible file equal the eager `/api/tasks` row agents byte for byte, so the done cache serves the same values.
- `files=fixture1,bogus.md,fixture6`: bogus.md omitted, both on-board files keyed.
- Missing `files`, `files=`, and `files=,,` answer `{}`. A trailing comma keeps the file keyed.
- Unknown project: `/api/card-stats?project=nope` returns 404 with an empty body, the same as the `/api/tasks?project=nope` baseline. `project` resolves by unique bare name (`t263`) and by root (`/tmp/t263/repo`).
- Assumptions: the `done` state keeps every agent entry static, so the deep equality between the two payloads is exact. The visible-five split comes from the measured `/api/tasks` answer, not from a derivation. The hidden log is gzipped to exercise the `.log.gz` path named in the Notes.
- No observed behavior contradicts the task assumptions. No issues found, no flow blocked. The unit-test acceptance (`node tests/webui.test.ts`) is the developer and reviewer gate and was not run, per the role rules.
