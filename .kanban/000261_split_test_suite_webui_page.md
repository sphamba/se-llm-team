---
name: "chore: split-test-suite-webui page"
priority: "medium"
state: "doing"
worktree: "chore/261-split-test-suite-webui-page"
issuer: "#256"
complexity: "moderate"
shortName: "split-test-suite-webui-page"
---

# Summary
Extract the served-page/client scenario group (old tests/webui.test.ts lines 798-1513, 270 assertions) into a standalone tests/webui/page.test.ts. The old file is not edited: it is deleted later by parent task #256.

# Specs
Facts: tests/webui.test.ts is a 2,379-line / 739-assertion plain top-level node script (node:assert/strict, top-level awaits, no framework). It stays untouched while you work; parent task #256 deletes it after all five group files land. Your range: lines 798-1513 (270 assertions), the served page/client group: z-index layering, tab poll cadence and throttle, log autoscroll, fetchSubs/updateOpenTask/renderDoctor/renderAgent/pollLog/markLiveLine/closeAnimated extracted from the served source via new Function, theme vars, fonts, aliveness/pulse, close paths. The range starts at "const modalZ = page.match(...)" and ends right before "// 000242: the agent history lives on the per-task detail". The five subtask ranges are disjoint and sum to all 739 assertions.

Requirements:
1. Create tests/webui/page.test.ts holding this range's scenarios, moved verbatim: scenario code and 000NNN comments unchanged, only imports, paths and boot adapted. This is one continuous run over the served page source: keep the scenario order.
2. Self-contained: boot your own hub (delete XDG_CONFIG_HOME first per 000215, mkdtemp HOME/root, process.on cleanup), const page = await (await fetch(`${base}/`)).text(). Copy needed stubs inline. Do NOT create tests/webui/helpers.ts, do NOT import from tests/webui.test.ts or root tests/helpers.ts.
3. Imports become ../../src/*.ts from tests/webui/: import only what your range uses (e.g. refreshMs, syncStatsLine, LOG_LINES from ../../src/webui.ts, startHub from ../../src/hub.ts).
4. Standalone runnable: node:assert/strict, top-level awaits, node tests/webui/page.test.ts passes; close your hub and clean your temp dirs.
5. No assertion dropped: your file carries exactly 270 assertions (grep -c "assert\."); the move is verbatim, not rewritten.
6. Ownership: this task owns tests/webui/page.test.ts only. Do not touch tests/webui.test.ts, package.json, scripts/test-changed.mjs, tests/helpers.ts or any sibling test file. pnpm test still runs the old file until task #255 lands the glob; that is expected.
7. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui/page.test.ts passes standalone.
- The file carries exactly 270 assertions and its scenario text matches the old range (imports/paths/boot apart).
- git status shows only tests/webui/page.test.ts as new.

# Notes

- Extracted the served-page/client range into tests/webui/page.test.ts (commit c1a9a6b): old lines 801-1516 in this worktree's 2,460-line file (the SPECS' 798-1513; this branch predates the #259 hub split, so the range sits 3 lines later), 270 assertions, scenario code and 000NNN comments byte-identical (diff-verified against the old range and the El stub).
- Boot adapted from the #259 hub.test.ts pattern: XDG_CONFIG_HOME deleted first (000215), mkdtemp root/home with distinctive webui-page-* prefixes, process.on exit/SIGINT/SIGTERM cleanup, createTask + startHub port 0, const page = fetch(`${base}/`).text(), const histPayload = fetch /api/task-history (the old file defines it at line 361, before the range, and the range reads it), and the El stub (old lines 444-470) copied inline. No tests/webui/helpers.ts, no imports from tests/webui.test.ts or root tests/helpers.ts.
- The boot's hub-start check is a plain throw, not assert.ok, so grep -c "assert." is exactly 270.
- Imports (only what the range uses): getTask/setState from kanban, startHub from hub, agentRowSig/agentStatsText/boardOf/curve/doctorCol/logFixups/md/mergeBoards/refreshMs/syncAgentStats/syncDoctorCards/syncStatsLine from the webui barrel, esc from the logpane module. numLinkHtml and syncBoard appear only inside page.includes strings, no imports for them.
- node tests/webui/page.test.ts passes standalone (exit 0); the hub server is unref'd so the run exits; cleanup removes both temp dirs. The old file is untouched; pnpm test still runs only the old file (explicit list, no glob) until #255 lands the glob.

# Open questions

- Assumption: the boot fetches the history payload while the task is backlog with no role logs (matching the old file's state at its line 361), so the range's agent null / empty-agents asserts read the same data.
- Assumption: the standalone run is safe in parallel with the other group files (distinctive webui-page-* temp prefixes, port 0); no fixtures are shared across group files.
