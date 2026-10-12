---
name: "perf: faster orchestrator tests; selective test runner"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: ""
issuer: "user"
complexity: "moderate"
shortName: "faster-orchestrator-tests"
---

# Summary
The orchestrator test suite takes ~210s of the ~217s total and slows the development process. Shrink the daemon delays the tests use (the biggest lever, no code changes needed) and add a selective runner that only runs test files affected by the current modifications. Both.

# Specs
Current facts (verified): every orchestrator.test.ts scenario spawns a real `node src/orchestrator.ts` daemon on a temp git fixture with a per-fixture config at .kanban/se-llm-team.json or CLI flags; the shared spawn helper (test:152-157) passes --rescan-seconds 1 --poll-minutes 0.05 (3s poll), and config-writing parts use pollMinutes: 0.05 (test:232, :316, :537, :667, :1313) with part K at autoScheduleMinutes: 0.08; pollMinutes and autoScheduleMinutes have NO validation (orchestrator.ts:130-131, fractional already used, setInterval takes pollMinutes*60*1000), rescan is CLI-only with no validation, cooldowns are already faked (utimesSync backdating test:350-352, injected clock test:1941-1944), hub election waits already shrunk via SE_LLM_TEAM_HUB_HEALTH_MS=500 / SE_LLM_TEAM_HUB_STALE_MS=1500 (test:1174, :1218). The wall clock goes to: bounce-streak waits (6+ deaths x 3s poll cadence, ~18-21s each, at test:330/:343/:369/:476/:620, ~60-75s total), fixed sleeps (~33s total at test:533/:647/:687/:718/:741/:777/:886/:914/:1076/:1605/:1630), and ~25 parts of 1s-rescan/fs.watch waitFor waits (~40-60s). No scripts exist in package.json; README:103-111 lists five bare node test commands.

Changes:
- Smaller delays, src/orchestrator.test.ts only: shrink the poll cadence from 0.05 to 0.01 (600ms) in the shared spawn helper and every config-writing scenario (pollMinutes: 0.01), cutting the bounce-streak and poll-cadence waits ~5x; keep --rescan-seconds 1 and the already-faked cooldowns and hub MS vars as they are; shrink the largest fixed sleeps only where the assertions tolerate it (leave every cap and every fake-expiry mechanism untouched). Assert nothing about absolute timing that 0.01 would break.
- Selective runner: a small runner script (scripts/test-changed.mjs, node stdlib only) that maps the current modifications (git status/diff vs main, staged or working tree) to the affected test files and runs only those, with the mapping: src/orchestrator.ts|src/pid.ts|agents/*.md -> src/orchestrator.test.ts; src/webui.ts -> src/webui.test.ts; src/kanban.ts -> src/kanban.test.ts + src/orchestrator.test.ts + src/webui.test.ts; src/hub.ts -> src/orchestrator.test.ts + src/webui.test.ts; index.ts -> index.test.ts + src/extension.test.ts; package.json -> all; no modifications -> nothing. Unknown paths fall back to running everything.
- package.json gains scripts.test (all five files) and scripts."test:changed" (the runner) without touching name/private/type/packageManager or adding dependencies; README's Checks section documents both commands and the fast-delay profile.

Tests: the runner maps representative paths correctly (assert its mapping table by import in a small self-check or by running it with a fake git state); the orchestrator suite still passes end to end with the smaller delays (run it once as the check); all other suites stay green.
