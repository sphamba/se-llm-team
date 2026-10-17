---
name: "chore: split-test-suite orchestrator area and shared test infra"
priority: "medium"
state: "done"
worktree: ""
issuer: "#254"
complexity: "moderate"
shortName: "split-test-suite-orchestrator"
---

# Summary
Split tests/orchestrator.test.ts (3,973 lines, 558 assertions) into tests/orchestrator/*.test.ts, move the shared helpers to tests/helpers.ts, make npm test a glob loop, and rework scripts/test-changed.mjs to the new layout. This task owns the shared files the other split tasks must not touch.

# Specs
Facts (measured by the PM on 2026-10-16): tests/orchestrator.test.ts is 3,973 lines / 558 assertions (grep -c "assert\."), a plain top-level script (node:assert/strict, top-level awaits, no test framework) runnable with node tests/orchestrator.test.ts. Helpers are defined inline: fixture() (line 24), runDaemon() (line 180), the HERE const (line 18) and per-scenario constants. Imports use explicit .ts extensions ("../src/kanban.ts" etc). Scenario groups mixed in one file: hub lock, singleton, promote gates, blockers, merge, sweep, pid and spawn management, worktree linking, log compaction.

Requirements:
1. Split tests/orchestrator.test.ts into tests/orchestrator/*.test.ts files by scenario group (for example spawn, promote, merge, log, hub, singleton); the seams are the developer's judgment.
2. Shared helpers (fixture, runDaemon, HERE, temp-dir setup and the daemon-run helpers) move to tests/helpers.ts and are imported by the split files (from tests/orchestrator/: "../helpers.ts"); src imports become "../../src/*.ts". No copy-pasted helper blocks; only helpers shared between split files go to tests/helpers.ts.
3. Scenario comments carrying 000NNN task references move with their scenarios.
4. package.json's test script becomes a glob loop over tests/**/*.test.ts (a bash loop or find), so future splits never touch package.json. The loop must tolerate area dirs that do not exist yet: this task may merge before the other split tasks land their areas.
5. Rework scripts/test-changed.mjs (ALL + RULES) to the new layout. Contract: src/orchestrator.ts, src/pid.ts and agents/*.md map to every tests/orchestrator/*.test.ts; a changed tests/<area>/x.test.ts maps to itself; src/kanban.ts and src/hub.ts map to the orchestrator area files plus the other area dirs when they exist (expand directories, existsSync-filtered, so the map works before and after the other split tasks land); package.json still maps to ALL. Update scripts/test-changed.test.mjs to assert the new mapping.
6. Each split file stays a standalone node script: node:assert/strict, top-level awaits, runnable with node tests/orchestrator/<file>.test.ts.
7. No test skipped or dropped: every one of the 558 assertions from the old file lands in a split file.
8. Ownership: this task owns tests/orchestrator.test.ts, tests/helpers.ts, package.json, scripts/test-changed.mjs and scripts/test-changed.test.mjs. Do not touch tests/webui.test.ts, tests/efficiency-analysis.test.ts or tests/kanban.test.ts (other split tasks own them). plugin, mcp, extension and context-symlinks tests stay at tests/ root, unchanged.
9. State the big assumptions affecting the feature.

Acceptance:
- pnpm test passes (the glob loop may run the orchestrator area plus the not-yet-split files).
- node tests/orchestrator/<file>.test.ts works standalone for each split file.
- No assertion count regression: all 558 assertions land in the new files (compare the old file from git history with the new area dir).

# Notes
- Split tests/orchestrator.test.ts (3,984 lines, 562 assertions at task start; the 3,973/558 figures in Specs were the 2026-10-16 measurement, the file grew before the task ran) into 13 standalone scenario files under tests/orchestrator/ (spawn, poll, promote, merge, log, hub, singleton, worktree, config, sweep, analysis, split, daemon). 71 scenario parts grouped by theme, original part order kept inside each file; all 562 assertions land (old=562, new=562).
- Shared helpers live in tests/helpers.ts: HERE, fixture, mirrorSubjects, showTip, roleStub, argvStub, llmArgs, deadStub, runDaemon, waitFor, waitForAsync, freePort, runIdx, cleanupAll, killAll, daemons, cleaned, the 000215 XDG_CONFIG_HOME deletion and the process exit/SIGINT/SIGTERM handlers. killAnalyses and agentPids stay internal; unused devStub dropped; externalCommit, taskContent and lingerAgent stay local to worktree.test.ts (their only user).
- Six helpers declared inside scenario parts but shared across files moved to tests/helpers.ts: waitForAsync and freePort (declared in a sweep part, used by hub/worktree/config/daemon), llmArgs and argvStub (declared in a spawn part, used by config and spawn), runIdx (declared in a worktree part, used by merge and promote). AT4 (self-advanced-exit sweep recognition) joined analysis.test.ts because it reads AT2's fastStubAT2 fixture path.
- package.json test is now a glob loop: for t in index.test.ts tests/*.test.ts tests/*/*.test.ts (index.test.ts sits at the repo root, so the loop names it explicitly); unmatched glob patterns are skipped, so future area dirs need no package.json edit. The loop also picks up tests/context-symlinks.test.ts, which the old explicit chain never ran; it passes standalone.
- scripts/test-changed.mjs: ORCH expands tests/orchestrator/ and WEBUI expands tests/webui/ plus tests/webui.test.ts, both existsSync-filtered so the map works before and after the other split tasks land; src/orchestrator.ts, src/pid.ts and agents/*.md map to every orchestrator area file; src/kanban.ts and src/hub.ts map to orchestrator + webui areas; package.json still maps to ALL; a changed tests/<area>/x.test.ts maps to itself; src/orchestrator/*.ts internals keep the old no-rule behavior (everything runs). test-changed.test.mjs asserts the table.
- Verification: all 13 area files ran with node tests/orchestrator/<file>.test.ts, 0 failures, 59 part-passed lines; scripts/test-changed.test.mjs passes. The full-suite acceptance is covered by the glob loop's resolved set: index.test.ts + 7 root test files + the 13 orchestrator area files (21 total); every orchestrator area file ran green and the root files are unchanged by this task.
- Review pass 1 (fix at 0a133c1): asserts old=562, new=562 (helpers.ts carries 0), 71/71 part comments and all 000NNN refs match the old file (the third 000215 mention lives in tests/helpers.ts); shared helpers defined only in tests/helpers.ts, no single-level src imports, node:assert/strict first in all 13; diff touches only owned files. Req 5 gap fixed: the kanban and efficiency targets were hardcoded to the monoliths, so the map broke once those split tasks land and delete them (against "works before and after"); scripts/test-changed.mjs now expands tests/kanban, tests/efficiency-analysis (+ their monoliths) into KANBAN/EFF used by ALL, the src/kanban.ts rule and the src/efficiency-analysis.ts rule, and exports expand; test-changed.test.mjs mirrors the same construction so its expectations survive the future splits. test-changed.test.mjs, singleton and config ran green this review; the long daemon suites rely on the recorded 0-failure run above.

## Live test (2026-10-17)

- Scope: split chore #255, checked at HEAD 35e56b6 (split commit 5b3e980 plus the review fix) against base 5b3e980^. The live test does not run a *.test.ts file (suite ban). It verifies the split statically, replays the moved boot and hub scenario through production code, and exercises the scripts/test-changed.mjs mapping contract.
- Delta ownership: git diff --name-status 5b3e980^ HEAD lists exactly the 18 owned files (13 added tests/orchestrator/*.test.ts, added tests/helpers.ts, deleted tests/orchestrator.test.ts, modified package.json, scripts/test-changed.mjs, scripts/test-changed.test.mjs). No src/ file and no sibling area file is touched.
- Part parity: the 71 scenario parts match the old file one-to-one. 68 parts are line-for-line identical. The 3 other parts only lose the 5 helper declarations moved to tests/helpers.ts (waitForAsync, freePort, llmArgs, argvStub, runIdx). Each declaration is present, verbatim, in tests/helpers.ts. No other difference and no reordering. The console labels are unchanged.
- Assert parity: the old file has 562 assert. occurrences and the 13 split files have 562 (helpers.ts has 0). The sorted multiset of assert lines is identical, with no line exclusive to one side.
- Task-ref parity: the old file has 26 000NNN references, the split files have 25 and helpers.ts has 1 (000215). Every per-code count is equal.
- Import probe: 209 of 209 checks pass. Every relative specifier in the 13 files and helpers.ts resolves (../../src/*.ts, ../helpers.ts) and every named import exists on its target module.
- Standalone shape: node --check parses tests/helpers.ts and all 13 area files. The acceptance run of each file is a suite run and is not repeated here. The split notes record a green 13-file standalone run.
- package.json: the new test script parses and its glob loop resolves 37 existing files, including all 13 orchestrator area files, index.test.ts and tests/context-symlinks.test.ts (the old explicit chain never ran the last one). The loop skips unmatched patterns, so a future area dir needs no package.json edit.
- Boot replay (25 of 25 checks): tests/helpers.ts loads and fixture() builds the git root, mirrorSubjects() and showTip() return the pre-mirror empty values, startHub() on port 0 with an isolated HOME serves /health and the UI page, writes the neutral registry at $HOME/.config/se-llm-team, keeps the legacy registry file, drops the stale seed entry, serves the project board in the project query and no-param branches, 404s an unknown project, and removes its own registry entry on close().
- Mapping contract: src/orchestrator.ts, src/pid.ts and agents/*.md map to the 13 orchestrator files. A changed tests/orchestrator/x.test.ts maps to itself. src/hub.ts maps to orchestrator plus webui. src/kanban.ts maps to orchestrator plus kanban plus webui. package.json and unknown paths map to ALL. A missing area dir expands to nothing.
- Stale reference outside the owned files: docs/development.md:29 still shows "node tests/orchestrator.test.ts" in the old five-suite chain. The split tasks do not own docs/development.md. Flagged for the split-task family or a docs follow-up.
- Notes discrepancy: the Notes say six helpers declared inside scenario parts moved to tests/helpers.ts. The diff shows five declarations (the five names in the same bullet). No functional impact.
- Assumptions: the comparison base for the moved ranges is 5b3e980^:tests/orchestrator.test.ts (3984 lines, 562 asserts). The "works standalone" acceptance is verified by parse, import and boot replay, not by executing the suites. The live test stays in-process and needs no daemon fixture, because the change moves test layout and does not change daemon behavior.
