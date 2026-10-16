---
name: "chore: split-test-suite-webui agentlog"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#256"
complexity: "moderate"
shortName: "split-test-suite-webui-agentlog"
---

# Summary
Extract the agent-log endpoint scenario group (old tests/webui.test.ts lines 1514-2275, 179 assertions) into a standalone tests/webui/agentlog.test.ts. The old file is not edited: it is deleted later by parent task #256.

# Specs
Facts: tests/webui.test.ts is a 2,379-line / 739-assertion plain top-level node script (node:assert/strict, top-level awaits, no framework). It stays untouched while you work; parent task #256 deletes it after all five group files land. Your range: lines 1514-2275 (179 assertions), the agent-log group: per-task agent history (000242/000248 detailOf), run bounce (.dead markers), /api/agent-log tail/idle/paging, role allowlist, reviewer/splitter logs, sub list and subagent sub=N polls, gzip sweep, claude stream-json logs, 000088 per-run history, fmtTokens/fmtDur stats, doctor payload, fs probes, LOG_ROLES asserts. The range starts at "// 000242: the agent history lives on the per-task detail" and ends at the rmSync(docRoot, ...) line right before "// a second hub on the taken port reports failure". The five subtask ranges are disjoint and sum to all 739 assertions.

Requirements:
1. Create tests/webui/agentlog.test.ts holding this range's scenarios, moved verbatim: scenario code and 000NNN comments unchanged, only imports, paths and boot adapted. This is one continuous fixture run (logs written, fetched, then rmSynced in sequence): keep the scenario order.
2. Self-contained: boot your own hub and temp root/home (delete XDG_CONFIG_HOME first per 000215, mkdtemp HOME/root, process.on cleanup); recreate the smoke task fixture the detailOf helper fetches. Do NOT create tests/webui/helpers.ts, do NOT import from tests/webui.test.ts or root tests/helpers.ts.
3. Imports become ../../src/*.ts from tests/webui/: import only what your range uses, e.g. agentLogPayload, taskHistory, taskPayload, fmtTokens, fmtDur, LOG_LINES from ../../src/webui.ts, esc/LOG_ROLES from ../../src/webui/logpane.ts, createTask/setState from ../../src/kanban.ts, startHub from ../../src/hub.ts.
4. Standalone runnable: node:assert/strict, top-level awaits, node tests/webui/agentlog.test.ts passes; close your hub and clean your temp dirs.
5. No assertion dropped: your file carries exactly 179 assertions (grep -c "assert\."); the move is verbatim, not rewritten.
6. Ownership: this task owns tests/webui/agentlog.test.ts only. Do not touch tests/webui.test.ts, package.json, scripts/test-changed.mjs, tests/helpers.ts or any sibling test file. pnpm test still runs the old file until task #255 lands the glob; that is expected.
7. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui/agentlog.test.ts passes standalone.
- The file carries exactly 179 assertions and its scenario text matches the old range (imports/paths/boot apart).
- git status shows only tests/webui/agentlog.test.ts as new.

# Notes
