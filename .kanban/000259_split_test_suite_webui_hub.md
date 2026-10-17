---
name: "chore: split-test-suite-webui hub"
priority: "medium"
state: "live-testing"
worktree: "chore/259-split-test-suite-webui-hub"
issuer: "#256"
complexity: "simple"
shortName: "split-test-suite-webui-hub"
---

# Summary
Extract the hub/config/daemon scenario groups (old tests/webui.test.ts lines 14-42, 315-421 and 2277-2380, 76 assertions) into a standalone tests/webui/hub.test.ts. The old file is not edited: it is deleted later by parent task #256.

# Specs
Facts: tests/webui.test.ts is a 2,379-line / 739-assertion plain top-level node script (node:assert/strict, top-level awaits, no framework). It stays untouched while you work; parent task #256 deletes it after all five group files land. Your ranges: lines 14-42 (temp HOME/root boot, cleanup handlers, config-off assert, 1 assertion), 315-421 (hub boot, /api/tasks, task-detail, task-history, issuer and blockedBy flows, visible subset, GET /, /api/hub, 404s, 000192 probe, 54 assertions) and 2277-2380 (second hub on the taken port, daemon wiring, loadWebUiConfig precedence, in-process taskPayload visible subset, done cache, 21 assertions). 76 assertions total. The five subtask ranges are disjoint and sum to all 739 assertions.

Requirements:
1. Create tests/webui/hub.test.ts holding these ranges' scenarios, moved verbatim: scenario code and 000NNN comments unchanged, only imports, paths and boot adapted. The taskPayload/done-cache tail (old lines 2334-2376) may instead live in its own tests/webui/payload.test.ts, your judgment: one owner either way.
2. Self-contained: the old lines 14-42 are the boot pattern (delete XDG_CONFIG_HOME first per 000215, mkdtemp HOME/root, process.on("exit"/SIGINT/SIGTERM) cleanup); copy it inline and register it in your file. Do NOT create tests/webui/helpers.ts, do NOT import from tests/webui.test.ts or root tests/helpers.ts.
3. Imports become ../../src/*.ts from tests/webui/: import only what your ranges use, e.g. createTask/setState/getTask/PRIORITY_RANK from ../../src/kanban.ts, startHub from ../../src/hub.ts, loadWebUiConfig/taskPayload/taskHistory/taskStats etc. from ../../src/webui.ts. The daemon wiring test's HERE moves to the subdir: spawn join(HERE, "../../src/orchestrator.ts").
4. Standalone runnable: node:assert/strict, top-level awaits, node tests/webui/hub.test.ts passes; close your hub and clean your temp dirs.
5. No assertion dropped: your file(s) carry exactly 76 assertions (grep -c "assert\."); the move is verbatim, not rewritten.
6. Ownership: this task owns tests/webui/hub.test.ts (and optionally tests/webui/payload.test.ts) only. Do not touch tests/webui.test.ts, package.json, scripts/test-changed.mjs, tests/helpers.ts or any sibling test file. pnpm test still runs the old file until task #255 lands the glob; that is expected.
7. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui/hub.test.ts passes standalone.
- The file(s) carry exactly 76 assertions and the scenario text matches the old ranges (imports/paths/boot apart).
- git status shows only your new tests/webui/ file(s).

# Notes
- Split the three ranges 14-42, 315-421 and 2277-2379 of tests/webui.test.ts into a new tests/webui/hub.test.ts, moved verbatim apart from the imports and HERE paths. The file is self-contained: it deletes XDG_CONFIG_HOME, makes a temp HOME and root, registers the exit and signal cleanup, and imports only the symbols the ranges use from ../../src/kanban.ts, ../../src/hub.ts and ../../src/webui.ts.
- One owner: the taskPayload and done-cache tail stays in hub.test.ts. It reads ui, root, home and cleanup from the earlier ranges, so a second file would need a second boot and a second hub.
- Path adaptation: HERE is now tests/webui. The /api/hub root and commit checks use join(HERE, "../.."); the 000192 probe reads join(HERE, "../../src"); the daemon spawn uses join(HERE, "../../src/orchestrator.ts"). The final log line reads "hub.test.ts: all assertions passed".
- Requirement 4 clean-up: statsRoot and doneRoot get one rmSync each before the final cleanup(), because the old cleanup() removed only root and home.
- Check: node tests/webui/hub.test.ts exits 0 and prints "hub.test.ts: all assertions passed". grep -c "assert\." gives 76. A mechanical check reverted the five adaptations and compared each range with the old file: the three ranges are byte-identical.
- tests/webui.test.ts, package.json, scripts/test-changed.mjs, tests/helpers.ts and the sibling suites are untouched. pnpm test still runs the old file until task #255 lands the glob.
- Commit: 424ae73.
- Review at 424ae73: the old ranges' 76 assert lines match hub.test.ts 76:76, and the only three differences are the recorded path adaptations (hub.root, the hub.commit cwd and the 000192 probe use join(HERE, "../..") and ../../src). node tests/webui/hub.test.ts exits 0 and prints "hub.test.ts: all assertions passed"; the assert-line count gives 76. The boot pattern is inline (000215 XDG drop, temp HOME/root, exit/SIGINT/SIGTERM cleanup), imports come only from ../../src/kanban.ts, ../../src/hub.ts and ../../src/webui.ts, the daemon spawns join(HERE, "../../src/orchestrator.ts"), no helpers file, and git status is clean apart from the new file. Requirements 1-6 pass. The two stated assumptions stand: the tail ownership is requirement 1's delegated judgment, and the renamed log line plus the two temp-dir clean-ups are requirement 4's demanded cleanup, not a scenario change.
