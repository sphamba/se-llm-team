---
name: "chore: split-test-suite orchestrator area and shared test infra"
priority: "medium"
state: "doing"
worktree: "chore/255-split-test-suite-orchestrator"
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
