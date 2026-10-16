---
name: "chore: split-test-suite webui area"
priority: "medium"
state: "doing"
worktree: "chore/256-split-test-suite-webui"
issuer: "#254"
complexity: "simple"
shortName: "split-test-suite-webui"
blockedBy: "#258, #259, #260, #261, #262"
---

# Summary
Verification only: once the five group files (logpane #258, hub #259, board #260, page #261, agentlog #262) land, delete tests/webui.test.ts, run every new file standalone, and verify all 739 assertions moved whole.

# Specs
Facts: the split landed as five standalone files in tests/webui/, each carved verbatim from a disjoint range of the old tests/webui.test.ts (2,379 lines, 739 assertions): logpane 43-313 (61 asserts), hub 14-42 + 315-421 + 2277-2380 (76), board 422-797 (153), page 798-1513 (270), agentlog 1514-2275 (179). The subtasks own only their new files.

Requirements:
1. Delete tests/webui.test.ts (all 739 assertions must already sit in the new files before deletion).
2. Run node tests/webui/<file>.test.ts standalone for each of logpane, hub, board, page, agentlog: all green.
3. Assertion accounting: count per file (grep -c "assert\.") and check the union equals the old file's 739 (compare against the old file from git history, e.g. git show <merge-base>:tests/webui.test.ts). Targets: 61/76/153/270/179.
4. Spot-check the move is verbatim: scenario code and 000NNN comments match the old ranges; only imports ("../../src/*.ts"), paths and per-file boot differ. No scenario rewritten.
5. No forbidden file touched by the subtasks: package.json, scripts/test-changed.mjs, tests/helpers.ts, tests/orchestrator.test.ts, tests/efficiency-analysis.test.ts, tests/kanban.test.ts unchanged.
6. pnpm test: while task #255 (the package.json glob) has not landed, pnpm test simply runs no webui files after the old file's deletion. That is expected, do not fix it here.
7. State the big assumptions affecting the feature.

Acceptance:
- tests/webui.test.ts is gone; the five new files pass standalone.
- No assertion count regression: the union of the new files' assertions equals 739 (61 + 76 + 153 + 270 + 179).

# Notes
