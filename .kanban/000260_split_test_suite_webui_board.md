---
name: "chore: split-test-suite-webui board"
priority: "medium"
state: "to-review"
worktree: "chore/260-split-test-suite-webui-board"
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

# Open questions
- Assumption: the board group needs no seeded task or registry entry; the green standalone run confirms the hub serves `/` on an empty root.
