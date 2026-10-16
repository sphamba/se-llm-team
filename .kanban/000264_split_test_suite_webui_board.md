---
name: "chore: split-test-suite webui board group"
priority: "medium"
state: "to-do"
worktree: ""
issuer: "#256"
complexity: "simple"
shortName: "split-test-suite-webui-board"
---

# Summary
Split the board scenario group of tests/webui.test.ts (lines 422-753) into tests/webui/board.test.ts. Additive only: the original file stays untouched until the parent verification task deletes it.

# Specs
# Facts
tests/webui.test.ts is 2,379 lines / 739 assertions, a plain top-level script (node:assert/strict, top-level awaits, no test framework). Imports come from ../src/webui.ts (the barrel), ../src/webui/logpane.ts, ../src/kanban.ts and ../src/hub.ts, with explicit .ts extensions. This task owns the board scenario group of that file.

# Requirements
1. Create tests/webui/board.test.ts from tests/webui.test.ts lines 422-753 (region starts at the comment "// FLIP diff: which cards get transforms", ends with the 000077 assertion "a refresh with the same payload keeps the backlog order"). This region tests board rendering: the FLIP diff, the 000047/000181 stacked pairs, the syncBoard client-scope interpolation, accents in pipeline order, spinner states, task-id links, issuer and complexity badges, the 000178 stats line, the blockedBy relation lines and their geometry (000127/000236), the 000144 hover, the 000191/000194 motion CSS, the refresh identity, the entrance class, the in-place stats, the 000030 column cap and the 000077 ordering.
2. The El stub (old line 442) is region-local: define it inside this file.
3. Copy the setup this region needs: head boilerplate (HERE, STATE_NAMES, temp root/home, cleanup handlers, XDG_CONFIG_HOME drop) + createTask + HOME juggling + startHub({ name: "webui-test", root, host: "localhost", port: 0 }) (old lines 316-321) + its own page fetch: fetch(`${base}/`).text() (old lines 397-399 shape).
4. Imports become ../../src/*.ts from the subdir file: ../../src/webui.ts (prune the barrel list to what you use), ../../src/kanban.ts, ../../src/hub.ts. Prune unused imports.
5. Helpers stay inline in this file; do NOT create tests/webui/helpers.ts (parallel split tasks would add/add-conflict on it). A small stub another split file also has is fine.
6. Do NOT edit or delete tests/webui.test.ts: it stays untouched until the parent verification task deletes it after all pieces land. Never touch package.json, scripts/test-changed.mjs, tests/helpers.ts or any other test file.
7. The file stays a standalone node script: node:assert/strict, top-level awaits, runnable with node tests/webui/board.test.ts.
8. No test skipped or dropped: all 139 assertions from the region land. Scenario comments carrying 000NNN task refs move with their scenarios.
9. pnpm test still names tests/webui.test.ts (the glob loop lands with task #255), so it does not pick up the new file yet. That is expected, do not fix it: the check for this task is the standalone run.
10. State the big assumptions affecting the change.

# Acceptance
- node tests/webui/board.test.ts passes standalone.
- No assertion loss: all 139 assertions land in the new file (compare the old region from git history with the new file).

# Notes
