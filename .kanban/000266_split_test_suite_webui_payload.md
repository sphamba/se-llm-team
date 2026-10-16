---
name: "chore: split-test-suite webui payload group"
priority: "medium"
state: "to-do"
worktree: ""
issuer: "#256"
complexity: "moderate"
shortName: "split-test-suite-webui-payload"
---

# Summary
Split the payload scenario group of tests/webui.test.ts (lines 1514-2379, plus the head config check) into tests/webui/payload.test.ts. Additive only: the original file stays untouched until the parent verification task deletes it.

# Specs
# Facts
tests/webui.test.ts is 2,379 lines / 739 assertions, a plain top-level script (node:assert/strict, top-level awaits, no test framework). Imports come from ../src/webui.ts (the barrel), ../src/webui/logpane.ts, ../src/kanban.ts and ../src/hub.ts, with explicit .ts extensions. This task owns the payload scenario group of that file, the largest one.

# Requirements
1. Create tests/webui/payload.test.ts from tests/webui.test.ts lines 1514-2379 (region starts at the comment "// 000242: the agent history lives on the per-task detail", runs to the end of file). Also take the head config check (old lines 37-41, "absent or invalid config = off", loadWebUiConfig enabled=false) and count it once here. This region tests the server payloads and daemon wiring: the detailOf merged history (000242/000248), the bounce dead markers (000128), the /api/agent-log tail, poll, history and walk-backs (000084/000158/000067), the JSONL event rendering and the 000218 claude stream-json renderers, the per-run history and labels (000088/000108), the token and duration stats (000120/000169/000177/000182), the 000146 meta, the subagent transcripts and walk-back (000088/000118), the 000123 gzip sweep, the 000139 mtime sort, the 000248 light-detail fs probe and the hub stall, the doctor payload (000222/000251), the hub port conflict, the daemon wiring and config overrides (000215, spawns a real daemon: needs the daemon variable and the ChildProcess type) and the 000245 done cache.
2. Copy the setup this region needs: head boilerplate (HERE, STATE_NAMES, temp root/home, cleanup handlers, XDG_CONFIG_HOME drop) + createTask + HOME juggling + startHub({ name: "webui-test", root, host: "localhost", port: 0 }) (old lines 316-321) + the log fixtures the region reuses (setState doing, .pids, .logs writes, old lines 1515-1518). The region does not need the page fetch.
3. Imports become ../../src/*.ts from the subdir file: ../../src/webui.ts (prune the barrel list to what you use), ../../src/kanban.ts, ../../src/hub.ts. Prune unused imports.
4. Helpers stay inline in this file; do NOT create tests/webui/helpers.ts (parallel split tasks would add/add-conflict on it). A small stub another split file also has is fine.
5. Do NOT edit or delete tests/webui.test.ts: it stays untouched until the parent verification task deletes it after all pieces land. Never touch package.json, scripts/test-changed.mjs, tests/helpers.ts or any other test file.
6. The file stays a standalone node script: node:assert/strict, top-level awaits, runnable with node tests/webui/payload.test.ts.
7. No test skipped or dropped: all 200 assertions from the region land (including the head config check). Scenario comments carrying 000NNN task refs move with their scenarios.
8. pnpm test still names tests/webui.test.ts (the glob loop lands with task #255), so it does not pick up the new file yet. That is expected, do not fix it: the check for this task is the standalone run.
9. State the big assumptions affecting the change.

# Notes for a later split
A later Splitter pass may sub-split this region when it no longer runs as one piece. Candidate seams: the agent-log endpoints and renderers (1540-2113), the daemon wiring and config (2282-2333), the doctor payload and done cache (2204-2379). Sub-split files follow the same contract: additive only, disjoint names, no shared helpers.ts.

# Acceptance
- node tests/webui/payload.test.ts passes standalone.
- No assertion loss: all 200 assertions land in the new file (compare the old region from git history with the new file).

# Notes
