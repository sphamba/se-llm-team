---
name: "chore: split-test-suite webui logpane and hub groups"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#256"
complexity: "simple"
shortName: "split-test-suite-webui-hub"
---

# Summary
Split the two head scenario groups of tests/webui.test.ts into tests/webui/logpane.test.ts (lines 1-314, logpane module tests) and tests/webui/hub.test.ts (lines 315-421, hub endpoint tests). Additive only: the original file stays untouched until the parent verification task deletes it.

# Specs
# Facts
tests/webui.test.ts is 2,379 lines / 739 assertions, a plain top-level script (node:assert/strict, top-level awaits, no test framework). Imports come from ../src/webui.ts (the barrel), ../src/webui/logpane.ts, ../src/kanban.ts and ../src/hub.ts, with explicit .ts extensions. One hub starts at old line 319 (startHub, port 0) and serves everything after it. This task owns two head groups of that file.

# Requirements
1. Create tests/webui/logpane.test.ts from tests/webui.test.ts lines 1-314 (region starts at the imports, ends with the 000141 assertion "a thinking body containing markdown renders through md() inside the lg-think details"). This region tests src/webui/logpane.ts directly: logFixups selector handling and orphan promotion, renderLogChunk JSONL rendering and legacy passthrough, 000122 collapsible blocks and join spans, client-side promotion and joins, thinking deltas and the 000148 live multi-chunk polls, sidechain transcripts, 000141 markdown rendering. It needs no hub and no board: import only the logpane module helpers the region uses (renderLogChunk, logFixups, esc, LOG_ROLES and any others) plus the fs/zlib imports the region uses. Copy only the head boilerplate the region needs (temp dirs, cleanup handlers, XDG_CONFIG_HOME drop).
2. Create tests/webui/hub.test.ts from tests/webui.test.ts lines 315-421 (region starts at the comment "// the hub serves the dashboard endpoints", ends with the 000192 assertion "a page load writes no webui copy dirs under src/"). This region tests the hub endpoints: /api/tasks light rows (000242/000245), /api/task-detail light detail and the follow-up history (000248), 404s on both endpoints, issuer and blockedBy flows, GET / state names, /api/hub identity (000165), the 000192 static-import check. Copy the setup this region needs: head boilerplate + createTask + HOME juggling + startHub({ name: "webui-test", root, host: "localhost", port: 0 }) (old lines 316-321). The page fetch (old lines 397-399) belongs to the GET / test here; the board and page files fetch their own page.
3. The head config check (old lines 37-41, "absent or invalid config = off", loadWebUiConfig enabled=false) does NOT belong in this task: it goes to the payload group. Do not include it.
4. Imports become ../../src/*.ts from the subdir files: ../../src/webui.ts (prune the barrel list to what you use), ../../src/webui/logpane.ts for the logpane-only exports, ../../src/kanban.ts, ../../src/hub.ts. Prune unused imports.
5. Helpers shared between your two files stay inline in each file; do NOT create tests/webui/helpers.ts (parallel split tasks would add/add-conflict on it). A small stub another split file also has is fine. STATE_NAMES is one line: copy it into each file that needs it.
6. Do NOT edit or delete tests/webui.test.ts: it stays untouched until the parent verification task deletes it after all pieces land. Never touch package.json, scripts/test-changed.mjs, tests/helpers.ts or any other test file.
7. Each file stays a standalone node script: node:assert/strict, top-level awaits, runnable with node tests/webui/<file>.test.ts.
8. No test skipped or dropped: every assertion from the two regions lands (62 + 54 = 116). Scenario comments carrying 000NNN task refs move with their scenarios.
9. pnpm test still names tests/webui.test.ts (the glob loop lands with task #255), so it does not pick up the new files yet. That is expected, do not fix it: the check for this task is the standalone run.
10. State the big assumptions affecting the change.

# Acceptance
- node tests/webui/logpane.test.ts and node tests/webui/hub.test.ts pass standalone.
- No assertion loss: 116 assertions land in the two new files (compare the old regions from git history with the new files).

# Notes
