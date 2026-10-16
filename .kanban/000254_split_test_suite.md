---
name: "chore: split the test suite into area subdirs"
priority: "medium"
state: "to-do"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "split-test-suite"
---

# Summary
Split the four non-trivial test files (orchestrator 3,973 lines, webui 2,350, efficiency-analysis 987, kanban 510) into subdir-per-area suites, move shared helpers into tests/helpers.ts, and make npm test a glob loop so future splits never touch package.json.

# Specs
Facts (measured by the PM on 2026-10-16): tests/orchestrator.test.ts is 3,973 lines / 261 KB, tests/webui.test.ts 2,350 / 196 KB, tests/efficiency-analysis.test.ts 987, tests/kanban.test.ts 510; small files plugin (70), mcp (170), extension (201) and context-symlinks (239) stay as they are. All files are plain top-level scripts (node:assert/strict, top-level awaits, no test framework) that run with node tests/<file>.ts. Shared helpers are defined inline: orchestrator.test.ts has fixture() (line 24), runDaemon() (line 180) and per-scenario constants; each file mixes many scenario groups (hub lock, singleton, promote gates, blockers, merge, sweep, pid and spawn management, worktree linking for orchestrator; payload, board, page and hub for webui).

Decisions (user, 2026-10-16): split all four non-trivial files; subdir per area; shared helpers in tests/helpers.ts; npm test becomes a glob loop over tests/**/*.test.ts.

Requirements:
1. Split tests/orchestrator.test.ts into tests/orchestrator/*.test.ts files by scenario group (for example spawn, promote, merge, log, hub, singleton); the seams are the developer's judgment.
2. Split tests/webui.test.ts into tests/webui/*.test.ts files (for example payload, board, page, hub).
3. Split tests/efficiency-analysis.test.ts and tests/kanban.test.ts into area subdirs the same way.
4. Shared helpers (fixture, runDaemon, temp-dir setup and the daemon-run helpers) move to tests/helpers.ts and are imported by the split files; no copy-pasted helper blocks.
5. plugin.test.ts, mcp.test.ts, extension.test.ts and context-symlinks.test.ts stay at tests/ root, unchanged except import paths.
6. package.json's test script becomes a glob loop over tests/**/*.test.ts (a bash loop or find), so future splits never touch it.
7. Each split file stays a standalone node script: node:assert/strict, top-level awaits, runnable with node tests/<area>/<file>.test.ts.
8. No test skipped or dropped: every assertion from the old files lands in a split file; scenario comments with 000NNN task references move with their scenarios.
9. State the big assumptions affecting the feature.

Acceptance:
- npm test runs the glob loop over every split file and passes.
- node tests/<area>/<file>.test.ts works standalone for each split file.
- No assertion count regression: the PM compares the pre/post test output.

# Notes
