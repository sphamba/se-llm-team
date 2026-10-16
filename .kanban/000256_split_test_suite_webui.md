---
name: "chore: split-test-suite webui area"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#254"
complexity: "moderate"
shortName: "split-test-suite-webui"
---

# Summary
Split tests/webui.test.ts (2,379 lines, 739 assertions) into tests/webui/*.test.ts by scenario group. This task owns only tests/webui.test.ts and its new subdir; the shared files (package.json, scripts/test-changed.mjs, tests/helpers.ts) belong to the orchestrator split task #255.

# Specs
Facts (measured by the PM on 2026-10-16): tests/webui.test.ts is 2,379 lines / 739 assertions (grep -c "assert\."), a plain top-level script (node:assert/strict, top-level awaits, no test framework) runnable with node tests/webui.test.ts. Imports come from "../src/webui.ts" (the barrel) and "../src/webui/logpane.ts" with explicit .ts extensions. Scenario groups mixed in one file: payload, board, page and hub.

Requirements:
1. Split tests/webui.test.ts into tests/webui/*.test.ts files by scenario group (for example payload, board, page, hub); the seams are the developer's judgment.
2. Helpers shared between the split files stay within tests/webui/ (for example a tests/webui/helpers.ts). Do not create or edit the root tests/helpers.ts: the orchestrator split task #255 owns it.
3. src imports become "../../src/*.ts" from the subdir files. Scenario comments carrying 000NNN task references move with their scenarios.
4. Each split file stays a standalone node script: node:assert/strict, top-level awaits, runnable with node tests/webui/<file>.test.ts.
5. No test skipped or dropped: every one of the 739 assertions from the old file lands in a split file.
6. Ownership: this task owns tests/webui.test.ts and tests/webui/ only. Do not touch package.json, scripts/test-changed.mjs, tests/helpers.ts, tests/orchestrator.test.ts, tests/efficiency-analysis.test.ts or tests/kanban.test.ts.
7. Live check note: pnpm test can fail in the worktree while the old package.json script still names tests/webui.test.ts (the glob loop lands with task #255). That is expected, do not fix it: the check for this task is running each split file standalone.
8. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui/<file>.test.ts works standalone and passes for each split file.
- No assertion count regression: all 739 assertions land in the new files (compare the old file from git history with the new area dir).

# Notes
