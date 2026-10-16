---
name: "chore: split-test-suite-webui hub"
priority: "medium"
state: "backlog"
worktree: ""
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
