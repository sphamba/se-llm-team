---
name: "chore: split-test-suite-webui agentlog"
priority: "medium"
state: "done"
worktree: "chore/262-split-test-suite-webui-agentlog"
issuer: "#256"
complexity: "moderate"
shortName: "split-test-suite-webui-agentlog"
blockedBy: ""
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

- 2026-10-17, splitter: no split. The 179-assertion range is one continuous fixture run on shared state (one hub, one smoke task, .dead/pid files, board setState, docRoot rmSync at the end) with cursor chains between scenarios (tail.head -> h1 -> h2 -> h3). The deliverable is one file (tests/webui/agentlog.test.ts) owned by this task, so parallel subtasks would write the same file or force the parent to stitch partial files. Split overhead (2x hub boot, 2x fixture recreation, one review and live run each, one merge) exceeds the wall-clock saved on a mechanical extraction. One developer runs this task whole.

- 2026-10-17, reviewer: re-review at bce423f, no fixes. The moved region (new lines 51-814) is old tests/webui.test.ts 1514-2280 verbatim: the only differences are the three no-assert fixture lines (logFile/logText/writeFileSync) recreated in the boot, as the Notes state, and the two fs-probe src paths adapted for tests/webui/ (HERE + "/../src" → HERE + "/../../src"); scenario order and 000NNN comments unchanged. The 179-assert count holds (old range 1514-2280 = 177 + the two LOG_ROLES asserts at old 2278-2279). Boot: XDG_CONFIG_HOME deleted first, mkdtemp root/home, process.on exit + SIGINT/SIGTERM cleanup, smoke task + own hub on port 0. All imports from ../../src/*.ts are used (LOG_LINES at lines 81/95/98, taskStats at 155); esc is not imported, the range does not use it. node tests/webui/agentlog.test.ts passes standalone (exit=0); the diff touches only tests/webui/agentlog.test.ts. Both Open-questions assumptions verified: the range's only HOME reference is the order-test child spawn's HOME: orderHome (old file line 2187), no scenario consumes the real HOME; the boot page fetch is the same `${base}/` fetch as old file lines 402-404. Specs Facts inaccuracy: the old range is 1514-2280, not 1514-2275 (the LOG_ROLES block sits at old 2276-2280); the stated boundary description and the 179 count match 2280.

- 2026-10-17, developer: extracted the range verbatim into tests/webui/agentlog.test.ts (commit bce423f). The range runs from the 000242 comment to the rmSync(docRoot) tail; the 179-assert count holds because the three lines before the 000242 comment (logFile/logText/writeFileSync, no asserts) recreate in the boot instead. Scenario text matches the old range apart from two fs-probe src paths (HERE + "/../src" became HERE + "/../../src" for tests/webui/). Boot: XDG_CONFIG_HOME deleted first, temp root/home with process.on cleanup, HOME pinned to the temp home, thinkDelta/thinkEnd recreated, own hub (startHub, port 0), smoke task + page fetch + setState doing + slug/.pids/.logs/logFile/logText recreated from the old pre-range lines. node tests/webui/agentlog.test.ts passes standalone; git status shows only the new file; the old suite stays untouched.


## Live test (2026-10-17)

My instructions forbid running any *.test.ts file, so I did not run `node tests/webui/agentlog.test.ts`. I verified the artifact with static checks and a hub boot probe on the merged checkout (160c8b6). The developer and reviewer report a standalone pass with exit 0, and my no-close probe shows why that run can exit.

Checks:
- `node --check tests/webui/agentlog.test.ts` parses the file.
- Assert count: the new file has 179 `assert.` calls. Old tests/webui.test.ts 1517-2280 has 179. The counts match.
- Anchored diff, old 1517-2280 against new 51-814 (764 lines each): identical, except the two fs-probe path lines (old 2144/2181 use `process.env.HERE + "/../src/..."`, new 678/715 use `"/../../src/..."`). Scenario text and every 000NNN comment are verbatim.
- Boot fixture: old 1508-1516 equals new 42-50 (setState doing, slug, .pids/.logs, logFile, logText). The smoke task values (createTask "feat: webui smoke", startHub name "webui-test", host localhost, port 0) match old lines 320/322/324.
- Git surface: `git diff --name-status HEAD^ HEAD` prints only `A tests/webui/agentlog.test.ts`. `git status --porcelain` is clean. tests/webui.test.ts, package.json, scripts/test-changed.mjs, tests/helpers.ts and the sibling files are untouched. No tests/webui/helpers.ts exists.
- Import probe (imports parsed and imported, never the test file): 41 export checks, 0 failed. All 26 named imports resolve and all are used.
- Hub boot probe, 15 checks, 0 failed: GET / serves the page, and the page embeds String(agentLabel), String(fmtTokens) and String(fmtDur). The detailOf merge serves the body, the agent entry and the agents entry exactly as the moved asserts expect. /api/agent-log tail, idle poll, appended-line poll and before=1 paging return the measured cursors. `nope.developer` and `<slug>.auditor` give 404, `<slug>.merger` gives 200, a missing file param gives 404. `ui.close()` works.
- No-close probe: a hub alone does not hold the process. startHub calls `server.unref()` (src/hub.ts:336), so the probe exited 0 in 0.21 s.

Findings:
1. The extracted file does not close its hub. Requirement 4 says "close your hub and clean your temp dirs". The old `ui.close()` sat at old line 2285, just after the moved range, and the new file has no replacement (no close call in the file). The standalone run still exits 0 because startHub unrefs its server, so the exit handler removes the temp dirs and no port stays bound. Add `ui.close()` before the end of the file to meet the requirement.
2. Specs Facts line range contradicts the code. Specs states lines 1514-2275. The real end anchor is the `rmSync(docRoot, ...)` line at old 2280, and the 179 assert count matches 1514-2280. The reviewer already recorded this.

Assumptions:
- "Scenario text matches the old range" excludes the boot and the two adapted fs-probe paths, as requirement 1 allows path changes.
- The standalone exit of the acceptance command is evidenced by the developer/reviewer run and the unref probe, not by a direct run, because of my suite ban.
- `process.env.HERE` in the moved child snippets is the spawned child's env. The parent sets it with `env: {...process.env, HERE}`, and `../../src` is correct for cwd tests/webui/.
