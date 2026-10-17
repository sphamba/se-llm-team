---
name: "chore: split-test-suite-webui page"
priority: "medium"
state: "done"
worktree: ""
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
- Review of c1a9a6b (base main): verbatim move confirmed by range diff (old 801-1516 vs new 66-782: scenario code and 000NNN comments byte-identical, sole drift one added blank line at new 717); grep -c "assert." is exactly 270; node tests/webui/page.test.ts exit 0; git diff shows only tests/webui/page.test.ts, the old file untouched. Both former open assumptions verified: the old boot fetches histPayload at line 361 with the task still backlog, matching the new boot; parallel safety holds (port 0, distinctive webui-page-* temp prefixes, no shared fixtures). No fixes.

## Live test (2026-10-17)

Split-chore live test. The acceptance names `node tests/webui/page.test.ts`, so the suite ban holds: no `*.test.ts` was executed. Five checks: anchored range diff, assert/ref parity, file-set, import probe (delegated to one subagent), boot replay (run here against a real hub).

- Range diff (PASS): `git show 160c8b6:tests/webui.test.ts` and `git show e5d7d1a:tests/webui.test.ts` are byte-identical (md5 da572546edea762d33d76506e39fb6ff); extracted old 801-1516 and new 66-781 are byte-identical, 716/716 lines, sha256 8b25f67f60d18eba41c4d179d56b8ec6ebebdf5e39a7e01b8a0d067b0dd90744. Scenario order and 000NNN comments unchanged. The only extra lines are the blank 782 and the per-file `console.log("page.test.ts: all assertions passed")` at 783. The SPECS' 798-1513 plus the documented +3 shift resolves to 801-1516; at the SPECS' own numbering the range carries 273 assertions, so the shift is real.
- Assert parity (PASS): 270/270 `assert\.`; the sorted line-multiset diff of the two ranges is empty; task refs 65/65, the only extra ref is 000215 in the boot block above line 66. `git cat-file -t c1a9a6b` exists and its page.test.ts is byte-identical to HEAD's.
- File set (PASS): `git diff --name-status e5d7d1a^ e5d7d1a` is exactly `A tests/webui/page.test.ts` (783 added, 0 deleted); worktree clean vs HEAD; tests/webui.test.ts untouched; no package.json, scripts/test-changed.mjs, tests/helpers.ts or sibling test file touched.
- Imports (PASS): all four relative specifiers resolve (kanban, hub, webui barrel, logpane) and all 16 named imports exist; no module-private helper (agentHistory) imported; no tests/webui/helpers.ts.
- Boot replay (PASS, 23 checks / 0 failed): copied boot block without its asserts, isolated HOME, XDG_CONFIG_HOME deleted, `createTask`, real `startHub` port 0 (ephemeral 44259), `/` served 75,254 bytes, all 12 served markers the moved asserts read are present, all 6 functions the moved `new Function` scenarios extract (markLiveLine, closeAnimated, dropCurve, drawAgentRelations, hotAgentRelations, markActiveAgent) compile and return functions, the boot's `/api/task-history` reads match (`agent: null`, `agents: []`), a live `doing` task renders on `/api/tasks`, `ui.close()` and temp-dir cleanup leave no process or /tmp/lt261-* leftovers.

Assumptions: (1) the moved range is measured against the merged parent 160c8b6 and the task commit e5d7d1a, which are byte-identical, so the +3 branch shift cannot hide drift; (2) the suite-named acceptance run is not the live test, and the boot replay covers the same boot surface and served markers; (3) the probe replays the file's own boot block and histPayload reads against a real hub, with port 0 as in the file. No contradicting behavior observed; no finding.
