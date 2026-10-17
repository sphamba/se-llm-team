---
name: "chore: split-test-suite-webui hub"
priority: "medium"
state: "done"
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
- Split the three ranges 14-42, 315-421 and 2277-2379 of tests/webui.test.ts into a new tests/webui/hub.test.ts, moved verbatim apart from the imports and HERE paths. The file is self-contained: it deletes XDG_CONFIG_HOME, makes a temp HOME and root, registers the exit and signal cleanup, and imports only the symbols the ranges use from ../../src/kanban.ts, ../../src/hub.ts and ../../src/webui.ts.
- One owner: the taskPayload and done-cache tail stays in hub.test.ts. It reads ui, root, home and cleanup from the earlier ranges, so a second file would need a second boot and a second hub.
- Path adaptation: HERE is now tests/webui. The /api/hub root and commit checks use join(HERE, "../.."); the 000192 probe reads join(HERE, "../../src"); the daemon spawn uses join(HERE, "../../src/orchestrator.ts"). The final log line reads "hub.test.ts: all assertions passed".
- Requirement 4 clean-up: statsRoot and doneRoot get one rmSync each before the final cleanup(), because the old cleanup() removed only root and home.
- Check: node tests/webui/hub.test.ts exits 0 and prints "hub.test.ts: all assertions passed". grep -c "assert\." gives 76. A mechanical check reverted the five adaptations and compared each range with the old file: the three ranges are byte-identical.
- tests/webui.test.ts, package.json, scripts/test-changed.mjs, tests/helpers.ts and the sibling suites are untouched. pnpm test still runs the old file until task #255 lands the glob.
- Commit: 424ae73.
- Review at 424ae73: the old ranges' 76 assert lines match hub.test.ts 76:76, and the only three differences are the recorded path adaptations (hub.root, the hub.commit cwd and the 000192 probe use join(HERE, "../..") and ../../src). node tests/webui/hub.test.ts exits 0 and prints "hub.test.ts: all assertions passed"; the assert-line count gives 76. The boot pattern is inline (000215 XDG drop, temp HOME/root, exit/SIGINT/SIGTERM cleanup), imports come only from ../../src/kanban.ts, ../../src/hub.ts and ../../src/webui.ts, the daemon spawns join(HERE, "../../src/orchestrator.ts"), no helpers file, and git status is clean apart from the new file. Requirements 1-6 pass. The two stated assumptions stand: the tail ownership is requirement 1's delegated judgment, and the renamed log line plus the two temp-dir clean-ups are requirement 4's demanded cleanup, not a scenario change.

## Live test (2026-10-17)

- Scope: the task moves hub/config/daemon scenarios into tests/webui/hub.test.ts. The live-test instructions ban running *.test.ts, so `node tests/webui/hub.test.ts` was not run; that acceptance item stays a developer/reviewer gate. The live test verified the static move and exercised the production surface the moved scenarios pin.
- Static move (independent subagent, spot re-checked): base = `git show 424ae73^:tests/webui.test.ts` (2379 lines / 739 asserts, matching the Specs). R1 (base 14-42) and R2 (base 315-421) are exact substrings of hub.test.ts after reverting the documented HERE/path adaptations. R3 (base 2277-2379) is byte-identical line for line apart from the two requirement-4 cleanup lines (`rmSync(statsRoot...)`, `rmSync(doneRoot...)`) and the renamed final log line, both documented in the Notes.
- Assertions: grep -c "assert\." hub.test.ts = 76; the three ranges hold 1 + 54 + 21 = 76.
- Static surface: imports are node builtins plus ../../src/kanban.ts, ../../src/hub.ts and ../../src/webui.ts only; no import of tests/webui.test.ts or tests/helpers.ts; tests/webui/helpers.ts absent; commit 424ae73 touches only tests/webui/hub.test.ts; git status clean.
- Runtime usage (43 checks, 0 failed, /tmp/lt259/probe.mjs): hub boot on port 0; /api/tasks light-row fields, heavy keys absent, agents; /api/task-detail; /api/task-history; the 404s on both endpoints; issuer and blockedBy; the visible-subset fold; GET / markers (no-cache, script parses, title, theme, no notify, hub footer, task-history, all 10 state names); /api/hub pid/root/commit; no .webui-hot-* under src; second hub on the taken port returns null; loadWebUiConfig precedence (project over neutral over legacy pi path); taskPayload visible subset, usage sum, taskHistory equality, done cache stale/invalidate/re-cache; daemon wiring (HOME webUi config port 0, "web ui on <url>" logged, dashboard serves all states, /api/tasks serves the task).
- Assumptions: (a) the verbatim base is `424ae73^`, because the working-tree tests/webui.test.ts no longer matches the Specs' 2379 lines after later sibling work; (b) R3 ends at base line 2379, the Specs' 2380 is one past EOF; (c) the added rmSync lines are requirement 4's cleanup, not scenario text.
- Technical difficulties: none. No leftover fixture processes or temp dirs.
