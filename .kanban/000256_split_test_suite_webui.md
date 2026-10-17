---
name: "chore: split-test-suite webui area"
priority: "medium"
state: "done"
worktree: ""
issuer: "#254"
complexity: "simple"
shortName: "split-test-suite-webui"
blockedBy: ""
---

# Summary
Verification and cleanup: the five group files (logpane #258, hub #259, board #260, page #261, agentlog #262) landed with exact target counts (61/76/153/270/179). Move the 58 post-carve asserts that live only in the old tests/webui.test.ts (the 000263/000264 card-stats scenarios) into their split homes, delete the old file, and verify all 797 assertions moved whole.

# Specs
Facts (verified 2026-10-17 on main): the split landed as five standalone files in tests/webui/, each carved verbatim from a disjoint range of the old tests/webui.test.ts (2,379 lines, 739 assertions at branch base a582b65): logpane 43-313 (61 asserts), hub 14-42 + 315-421 + 2277-2380 (76), board 422-797 (153), page 798-1513 (270), agentlog 1514-2275 (179). The final group set matches these five names and counts exactly (61/76/153/270/179, total 739); the conflicting newer group plan (#265 page 284, #266 payload 200) was dropped from the board. No re-cut needed.

Baseline correction (2026-10-17): tests/webui.test.ts now holds 2,611 lines and 797 assertions. The 58 extra asserts are post-carve additions that live only in the old file: the 000263/000264 card-stats scenarios (#263 route asserts around line 401 in the 000245 hub block, in-process payload asserts around line 2377 in the stats fixture, #264 client asserts imported per the note at old line 17) plus other post-base block extensions. A scenario-id diff shows the five files carry every old scenario id except 000263/000264; card-stats mentions: 19 in the old file, 7 in board.test.ts (the f53e4c5 pin patch).

Requirements:
1. Move the 58 unsplit asserts into the split files that hold their blocks' homes: the 000263 route asserts into hub.test.ts's 000245 block, the 000263 payload asserts and the 000264 client asserts into the split homes of the blocks they extend; keep import lines whole (the 000264 note at old line 17 shows the import shape).
2. Delete tests/webui.test.ts only after the moved asserts are in (all 797 assertions must sit in the new files before deletion).
3. Run node tests/webui/<file>.test.ts standalone for each of logpane, hub, board, page, agentlog: all green.
4. Assertion accounting: count per file (grep -c "assert\.") and check the union equals the old file's 797 (compare against the old file from git history, e.g. git show <merge-base>:tests/webui.test.ts, plus the post-base additions).
5. Spot-check the move is verbatim: scenario code and 000NNN comments match the old ranges; only imports ("../../src/*.ts"), paths and per-file boot differ. No scenario rewritten.
6. No forbidden file touched: package.json, scripts/test-changed.mjs, tests/helpers.ts, tests/orchestrator.test.ts, tests/efficiency-analysis.test.ts, tests/kanban.test.ts unchanged.
7. pnpm test: while task #255 (the package.json glob) has not landed, pnpm test simply runs no webui files after the old file's deletion. That is expected, do not fix it here.
8. State the big assumptions affecting the feature.

Acceptance:
- tests/webui.test.ts is gone; the five new files pass standalone.
- No assertion count regression: the union of the new files' assertions equals 797 (739 carved + 58 migrated).

# Notes
- Blocked, verification cannot run. The split has not landed at branch base a582b65 (= main, no commits in this worktree): tests/webui.test.ts is still present (2,379 lines, 739 assertions) and tests/webui/ does not exist.
- Dependency state at check time: #258 has one commit (1898b6a, tests/webui/logpane.test.ts, 274 lines); #259 and #260 are running with branches still at a582b65; #261 and #262 are to-do with no branch. The board also holds a newer group plan (#265 page 755-1513 / 284 assertions, #266 payload 1514-2379 / 200 assertions; #263/#264 absent from main) that conflicts with the five-file targets in Specs (61/76/153/270/179).
- No code change and no commit in this worktree. Re-run this task after the webui group tasks merge into main, then compare the counts against the group files that actually land.

## Run 2 (unblocked, done)
- Done in the worktree at commit 9673b45, on top of main 35e56b6. The branch had no own commits, so one fast-forward brought in the five split files (#258-#262), #263/#264 and the #255 glob.
- Post-base diff (a582b65..35e56b6) of tests/webui.test.ts gave 240 changed lines and exactly 58 assert additions in four blocks. Each block moved verbatim (per-block diff empty):
  - 000263 route asserts, 4, old lines 401-413, into hub.test.ts's 000245 visible-subset block.
  - 000263 payload asserts, 3, old lines 2377-2382, into hub.test.ts's stats fixture block.
  - 000250 RAM ratchet, 18, old lines 2406-2480, into hub.test.ts after the done-cache block.
  - 000264 lazy card-stats client, 33, old lines 2482-2608, into board.test.ts before ui.close().
- The other two post-base hunks were already in the split files and byte-identical to the old file: the 000200 card-stats CSS pin (board.test.ts:139) and the 000250 openSync preload (agentlog.test.ts:708). No action.
- Imports added: hub.test.ts got appendFileSync, existsSync and readFileSync (node:fs), gzipSync (node:zlib), logStats, MAX_LOG_CACHES, statsCache, subagentLogs, subsCache, cardStatsPayload (payload module) and compactFinishedLogs (orchestrator barrel); board.test.ts got applyCardStats, mergeCardStats, sortedCol, statsKey (board module) and PAGE (page module).
- tests/webui.test.ts is deleted. Assert counts: logpane 61, hub 101, board 186, page 270, agentlog 179, union 797 (739 carved + 58 migrated).
- All five files pass standalone (node tests/webui/<file>.test.ts, outputs in /tmp/logpane.out, /tmp/hub.out, /tmp/board.out, /tmp/page.out, /tmp/agentlog.out).
- No forbidden file touched: git diff main is empty for package.json, scripts/test-changed.mjs, tests/helpers.ts, tests/orchestrator.test.ts, tests/efficiency-analysis.test.ts and tests/kanban.test.ts.
- Requirement 7 is obsolete: #255 landed, so the package.json test glob (tests/*/*.test.ts) picks up the five webui files. The full suite was not run, per policy.
- Re-review at 9673b45 (worktree HEAD, on main 35e56b6): all Run 2 claims hold. tests/webui.test.ts is gone; the five files carry 61/101/186/270/179 asserts, union 797 (grep). The four moved blocks diff verbatim against the old file at 35e56b6 (old 401-413 and 2377-2382 and 2406-2480 into hub.test.ts, old 2482-2608 into board.test.ts; 58 asserts). Scenario-id union matches the old file; the only extra id is 000260 in board.test.ts line 1, the file's own split-source header comment, not a scenario. Git diff main is empty for the six forbidden files. Green standalone runs recorded at this commit stand, no union re-run. No fixes. 797 asserts across tests/webui/ (logpane, hub, board, page, agentlog).

## Live test (2026-10-17)
- Moved ranges are byte-identical. Each of the four post-base blocks from `git show HEAD^:tests/webui.test.ts` is one contiguous verbatim substring of its split home: 000263 routes old 401-413 into hub.test.ts 125-137 (md5 6ba346417d7c6977ffbc88a18f381c5b), 000263 payload old 2377-2382 into hub.test.ts 245-250 (e5e2f2567ff83599feef4f3ac41e203e), 000250 RAM ratchet old 2406-2480 into hub.test.ts 274-348 (c6110569bf2c73ed4353fe1b912e7a22), 000264 client old 2482-2608 into board.test.ts 412-538 (789f2c81ae620881e18590e006687903). The boundaries are exact and each block occurs once.
- The two post-base hunks that were already in the split files are byte-identical to the old file: the 000200 card-stats pin (old line 545 = board.test.ts 139) and the 000250 openSync preload (old 2186-2194 = agentlog.test.ts 703-711).
- Assert accounting: logpane 61, hub 101, board 186, page 270, agentlog 179, union 797. This equals the old file's 797. The sorted assert-line multiset differs in exactly 3 lines. All 3 are path adjustments from `join(HERE, "..")` to `join(HERE, "..", "..")` because the files sit one level deeper. No assertion text changed.
- Scope: the task's own commit touches only tests/webui.test.ts (deleted), tests/webui/board.test.ts and tests/webui/hub.test.ts (modified). The six forbidden files are identical between HEAD^ and HEAD: package.json, scripts/test-changed.mjs, tests/helpers.ts, tests/orchestrator.test.ts, tests/efficiency-analysis.test.ts, tests/kanban.test.ts. The last three are pre-split monolith paths.
- Import probe: all 45 import statements of the five files resolve against the real modules. All 93 named or aliased exports exist. 0 failed.
- Boot probe on the real served surface: 146 checks, 0 failed. The probe starts a real hub on port 0 with the copied boot block (HOME and XDG handling verbatim), repeats the boot API reads, and replays the four moved scenarios with copied code. Only the `assert` binding changes to a tally shim. It covers the 000263 card-stats endpoint over HTTP (hidden card 30 tokens, bogus file omitted, missing files `{}`, unknown project 404), the payload batch, the RAM ratchet (incremental offsets, partial tail, sweep eviction, bounded caches), the 000264 client helpers over stubbed storage, the served page markers and the compile check of the served script. Negative control: a direct `startHub` writes no hub lock.
- Assumption: the range check uses `git show 9673b45^:tests/webui.test.ts` as the pre-move revision. That merged parent carries the 58 post-base additions.
- Assumption: the acceptance names standalone runs of `node tests/webui/<file>.test.ts`. I did not run them. Those files are developer and reviewer gates. The five split-chore checks above cover the same surfaces.
- No contradicted assumptions. No findings.

