---
name: "fix: verify the merged webui board after 47 - pair width, spinner identity, hub tabs"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Follow-up to the live test of #47: once the #47 merge has landed on main, verify the merged webui board (pair width matches .col's 300px with no overlap, spinner identity survives two 5 s refreshes, hub tabs intact, full suite green) and repair the merged client only if the Merger's conflict resolution dropped either half. Does not redo the merge.

# Specs
Follow-up to the live test of #47 (feat: webui stacked column pairs; animation-preserving refresh). #47 passed 30/30 browser checks on its base e4c0358 and is done; the pipeline is merging branch feat/47-webui-stacked-column (commit 6c90c11). #47's Notes carry a MERGE WARNING and the Merger agent owns the conflict resolution in src/webui.ts and src/webui.test.ts. This task verifies the merged result and fixes it only if the resolution lost something. Do NOT redo the merge.

Precondition - do not guess:
- Run this only when main already contains the #47 merge: main has the `.pair` rule and the reconciliation helpers buildShell / syncBoard / cardHtml / spinnerHtml. If main does not contain them yet, stop, record that in # Notes, and do not verify a stale base.
- Intended scheduling: the PM promotes this immediately after #47's merge commit lands, before the queued webui tasks #77 / #79 / #81 / #88 go to-do, so the merged layout is verified before more webui changes pile on.

Facts (verified 2026-10-11 on main 50c7d38 and branch 6c90c11):
- `git merge-tree --write-tree main 6c90c11` conflicts in src/webui.ts and src/webui.test.ts. Main has the hub frontend's per-tab client (renderTabs, switchTab, boards, tab.expanded, plus helpers tabNames / tabsHtml / boardOf / mergeBoards, with tests asserting the page ships them) and the 300px columns from #82. The branch has the stacked-pair layout plus the animation-preserving node reconciliation.
- Branch CSS on 6c90c11: `.pair { display:flex; flex-direction:column; gap:10px; min-width:200px; flex:1 0 200px; }` (src/webui.ts line 459). Main CSS: `.col { ... min-width:300px; flex:1 0 300px; }` (main src/webui.ts line 374).
- Risk (1) - overlap: if the resolution keeps this branch's `.pair` at 200px next to main's 300px `.col`, each 300px pair column overflows its 200px wrapper and overlaps the next pair by about 89px (measured in Chromium on a minimal page during #47's live test). `.pair` must end up with the same width floor as `.col` (300px, flex basis 300px) or a layout that provably fits a 300px column.
- Risk (2) - silent feature loss: the branch's node reconciliation (buildShell, syncBoard, cardHtml, spinnerHtml, exported from src/webui.ts and interpolated into PAGE) must be re-applied on top of the new tabbed client. If the resolution keeps main's per-tab render wholesale, spinners reset every 5 s refresh - the whole point of #47 is silently lost. It must compose with main's client, including tab switches (renderTabs / switchTab / boardOf / mergeBoards) and the per-tab `boards` / `tab.expanded` state.

Checks (run all; record exact commands and results in # Notes):
1. Source check on the merged tree: `.pair`'s width floor equals `.col`'s (both 300px or provably fitting); buildShell / syncBoard / cardHtml / spinnerHtml are present AND still used by the per-tab render path (not dead code); renderTabs, switchTab, boards, tabNames, tabsHtml, boardOf and mergeBoards all survive.
2. Full suite in the worktree: `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts`. Known flakiness: part D (#49) and part T (#83) - on a flake, re-run and say so.
3. Browser check (headless Chromium/Playwright, same method as #47's live test: startWebUi on port 0 against a temp board; never touch the production webui on 4242):
   - Structure: the board row is backlog | pair(to-do over doing) | pair(to-review over reviewing) | pair(to-live-test over live-testing) | done, i.e. exactly 3 `.pair` wrappers today; with the two future merge states they become a fourth pair via pairLayout.
   - Geometry at 1280px and at a narrow viewport (e.g. 700px): every `.pair` is at least as wide as its widest inner `.col`; no inner `.col` spills outside its `.pair` (col.left >= pair.left - 1 and col.right <= pair.right + 1); adjacent pair boxes do not overlap (next.left >= prev.right + 10px gap - 1); all columns stay on one row and the board still scrolls horizontally.
   - Spinner identity: a task in a working state has a spinner node; tag the node and its Animation object, wait through at least two 5 s refreshes, then assert the same node and the same Animation with an advanced currentTime and playState "running". A state change rewrites only the changed card, keeps every other card's node, moves the card and starts/stops its spinner.
   - Hub tabs: with the hub test fixture's two registered projects, both tabs render and clicking the other tab switches its board; the switched board renders the pair layout too; the page still ships the helper names main's tests assert.
4. If any check fails, fix minimally - only src/webui.ts and/or src/webui.test.ts - by composing the reconciliation with the tabbed render and setting `.pair` sizing to match `.col`; then re-run checks 1-3.

Acceptance:
- The merged webui renders the pair layout with no overlap: `.pair`'s width floor is >= `.col`'s 300px, confirmed in the browser at 1280px and a narrow viewport.
- Spinner element and Animation identity survive two 5 s refreshes; unchanged cards are not rewritten; a state change still moves the card and starts/stops the spinner.
- The hub per-tab client is intact: tabs render and switch, and every helper name main's tests assert is still present; `node src/webui.test.ts` and the full suite pass.
- A resolution that is already correct must produce verification Notes and no diff - that is a valid pass, not a failure.

Constraints:
- Do not redo the #47 merge and do not edit .kanban/000047_fix_webui_polling_resets_the_animated_card_spinners_every_refresh.md; the Merger's merge commit is the starting point.
- Do not revert #82's 300px `.col` (300px is the target) and do not revert the hub tabs.
- Files touched: src/webui.ts and/or src/webui.test.ts only, unless the Notes justify more.

# Notes
