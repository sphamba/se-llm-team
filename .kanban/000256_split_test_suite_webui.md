---
name: "chore: split-test-suite webui area"
priority: "medium"
state: "doing"
worktree: "chore/256-split-test-suite-webui"
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

# Open questions

