---
name: "chore: split-test-suite-webui board"
priority: "medium"
state: "done"
worktree: ""
issuer: "#256"
complexity: "simple"
shortName: "split-test-suite-webui-board"
---

# Summary
Extract the board scenario group (old tests/webui.test.ts lines 422-797, 153 assertions) into a standalone tests/webui/board.test.ts. The old file is not edited: it is deleted later by parent task #256.

# Specs
Facts: tests/webui.test.ts is a 2,379-line / 739-assertion plain top-level node script (node:assert/strict, top-level awaits, no framework). It stays untouched while you work; parent task #256 deletes it after all five group files land. Your range: lines 422-797 (153 assertions), the board group: FLIP diff, stacked pairs/tail stack, buildShell/syncBoard DOM stub tests, accent colors, cardHtml/complexity chips/stats lines, relationPaths geometry, curves, hotRelations hover, relation and motion CSS asserts, syncBoard cap/ordering, tabNames/tabsHtml/000103 labels. The range starts at "// FLIP diff: which cards get transforms" and ends right before the z-index block (const modalZ = page.match(...)). The five subtask ranges are disjoint and sum to all 739 assertions.

Requirements:
1. Create tests/webui/board.test.ts holding this range's scenarios, moved verbatim: scenario code and 000NNN comments unchanged, only imports, paths and boot adapted.
2. Self-contained: copy needed helpers (the El stub, buildShell/syncBoard wiring, rects) inline. The CSS asserts read the served page text: boot your own hub (delete XDG_CONFIG_HOME first per 000215, mkdtemp HOME/root, process.on cleanup), const page = await (await fetch(`${base}/`)).text(). Do NOT create tests/webui/helpers.ts, do NOT import from tests/webui.test.ts or root tests/helpers.ts.
3. Imports become ../../src/*.ts from tests/webui/: import only what your range uses, e.g. flipDiff, pairLayout, buildShell, syncBoard, cardHtml, relationPaths, tabNames, tabsHtml, LAYOUT from ../../src/webui.ts, startHub from ../../src/hub.ts.
4. Standalone runnable: node:assert/strict, top-level awaits, node tests/webui/board.test.ts passes; close your hub and clean your temp dirs.
5. No assertion dropped: your file carries exactly 153 assertions (grep -c "assert\."); the move is verbatim, not rewritten.
6. Ownership: this task owns tests/webui/board.test.ts only. Do not touch tests/webui.test.ts, package.json, scripts/test-changed.mjs, tests/helpers.ts or any sibling test file. pnpm test still runs the old file until task #255 lands the glob; that is expected.
7. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui/board.test.ts passes standalone.
- The file carries exactly 153 assertions and its scenario text matches the old range (imports/paths/boot apart).
- git status shows only tests/webui/board.test.ts as new.

# Notes
- Split tests/webui/board.test.ts out of tests/webui.test.ts lines 422-797 (000260): the 376 lines moved byte-identical (`diff` against the old range is clean), with a standalone boot (own hub on port 0, temp HOME/root, XDG_CONFIG_HOME dropped) and only the used imports adapted to ../../src/.
- `node tests/webui/board.test.ts` passes standalone and `grep -c "assert\."` reports exactly 153, matching the old range. The boot holds no assert, so the count stays at the ranged 153.
- No seeded task: the group reads the served page text and the pure board helpers only, so the hub needs no board row.
- tests/webui.test.ts, tests/helpers.ts, package.json, scripts/test-changed.mjs and every sibling test file untouched. pnpm test still runs the old file until #255 lands the glob, as the spec expects.
- Review at 355ee36: lines 33-408 of board.test.ts are byte-identical to webui.test.ts 422-797 (diff clean). The file carries exactly 153 assertions, node tests/webui/board.test.ts exits 0, the hub closes and the temp dirs clean up, and git status shows only board.test.ts as new. All 20 ../../src/* imports are used in the scenario code. No fixes.

## Live test (2026-10-17)

- Target: merged 3f8833c; `git diff --name-status HEAD^ HEAD` adds only tests/webui/board.test.ts. The acceptance run `node tests/webui/board.test.ts` is a unit-suite invocation and stayed out of the live test per role rules; it was verified without executing the suite, and the run itself stays a developer/reviewer gate.
- Move fidelity: `diff` of board.test.ts lines 33-408 against the old file's lines 425-800 is clean (376 lines byte-identical). The Spec's 422-797 line numbers are stale in the merged tree (intervening commits added 3 lines above the range); the range anchored by its own markers (starts `// FLIP diff: which cards get transforms`, ends before `const modalZ`) is 425-800, and the board content is unchanged.
- Assertions: `grep -c 'assert\.'` = 153 in board.test.ts and 153 in the old anchored range.
- Ownership: no forbidden file touched by the merge (tests/webui.test.ts, tests/helpers.ts, package.json, scripts/test-changed.mjs); no tests/webui/helpers.ts; tests/webui/ holds board.test.ts and logpane.test.ts.
- Imports resolve (probe parses the file, never runs it): all 20 named imports across ../../src/webui.ts, ../../src/kanban.ts and ../../src/hub.ts exist as exports (20 checks, 0 failed); every imported name appears in the scenario body; `node --check tests/webui/board.test.ts` parses.
- Boot works as the file uses it (probe replicates the boot, without the asserts): XDG_CONFIG_HOME dropped, temp HOME/root, `startHub` port 0 serves `/` with 200 at 75,254 bytes; all 10 state accent rules match; the page ships the tested helpers and CSS (flipDiff, LAYOUT, PRIORITY_RANK, card-stats and chip rules, #relations overlay, cardIn, tabs bar and z-index); hotRelations and switchTab are extractable from the served script; flipDiff/tabNames/tabsHtml match the moved range's expected values; `ui.close()` stops the port; the boot cleanup removes both temp dirs (20 checks, 0 failed).
- Assumptions: (1) the anchored marker comparison is the correct reading of "scenario text matches the old range", since the Spec line numbers predate an intervening commit; (2) board.test.ts line 409 is one blank separator before `ui.close()`, not a scenario line, so it falls under "boot apart"; (3) the suite execution acceptance is left to the developer/reviewer gates.
- No issues found. No open questions.
