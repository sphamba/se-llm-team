---
name: "chore: split-test-suite webui page group"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#256"
complexity: "moderate"
shortName: "split-test-suite-webui-page"
---

# Summary
Split the page scenario group of tests/webui.test.ts (lines 755-1513) into tests/webui/page.test.ts. Additive only: the original file stays untouched until the parent verification task deletes it.

# Specs
# Facts
tests/webui.test.ts is 2,379 lines / 739 assertions, a plain top-level script (node:assert/strict, top-level awaits, no test framework). Imports come from ../src/webui.ts (the barrel), ../src/webui/logpane.ts, ../src/kanban.ts and ../src/hub.ts, with explicit .ts extensions. This task owns the page scenario group of that file, the largest one.

# Requirements
1. Create tests/webui/page.test.ts from tests/webui.test.ts lines 755-1513 (region starts at the comment "// tabs: one per registered project", ends with the cadence assertion "the page runs the tested cadence helper"). This region tests client page behavior: the tabs (000039, the 000103 branch labels, the 000235 throttled wake), the per-project payloads and tab state, the agent info rows (000248), the 000076/000120 run cards and sub stacks, the fonts (000204 rem, 000141 Inter, the 000147/000153 mono scope), the detail-card agent history and sub list rebuilds (000120/000191/000251), the 000121 refresh, the doctor card UI (000222/000230/000232), the hover colors (000239/000240), the pulse and markLiveLine (000191/000193/000194), the close paths and closeModal (000194), the 000209 popup scroll, the 000246 loading state, the 000243 clear-on-load, the 000142 in-place stats poll, the 000237/000238 detail relation lines and the cadence (000169).
2. The ShineEl and RelEl stubs are region-local: define them inside this file.
3. Copy the setup this region needs: head boilerplate (HERE, STATE_NAMES, temp root/home, cleanup handlers, XDG_CONFIG_HOME drop) + createTask + HOME juggling + startHub({ name: "webui-test", root, host: "localhost", port: 0 }) (old lines 316-321) + its own page fetch: fetch(`${base}/`).text() (old lines 397-399 shape).
4. Imports become ../../src/*.ts from the subdir file: ../../src/webui.ts (prune the barrel list to what you use), ../../src/kanban.ts, ../../src/hub.ts. Prune unused imports.
5. Helpers stay inline in this file; do NOT create tests/webui/helpers.ts (parallel split tasks would add/add-conflict on it). A small stub another split file also has is fine.
6. Do NOT edit or delete tests/webui.test.ts: it stays untouched until the parent verification task deletes it after all pieces land. Never touch package.json, scripts/test-changed.mjs, tests/helpers.ts or any other test file.
7. The file stays a standalone node script: node:assert/strict, top-level awaits, runnable with node tests/webui/page.test.ts.
8. No test skipped or dropped: all 284 assertions from the region land. Scenario comments carrying 000NNN task refs move with their scenarios.
9. pnpm test still names tests/webui.test.ts (the glob loop lands with task #255), so it does not pick up the new file yet. That is expected, do not fix it: the check for this task is the standalone run.
10. State the big assumptions affecting the change.

# Notes for a later split
A later Splitter pass may sub-split this region when it no longer runs as one piece. Candidate seams: tabs, fonts and agent info (755-918), detail card and history/doctor (919-1340), modal close, pulse, relations and cadence (1340-1513). Sub-split files follow the same contract: additive only, disjoint names, no shared helpers.ts.

# Acceptance
- node tests/webui/page.test.ts passes standalone.
- No assertion loss: all 284 assertions land in the new file (compare the old region from git history with the new file).

# Notes
