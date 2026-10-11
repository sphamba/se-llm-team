---
name: "fix: verify the merged webui board after 47 - pair width, spinner identity, hub tabs"
priority: "high"
state: "done"
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

## Developer verification (2026-10-11)
- Precondition: the #47 merge commit 52b119b is an ancestor of the worktree HEAD. The worktree started at main 50937a6. Main advanced to 01136ea while this task ran (the #78 to-merge merge and a docs commit). `git diff 50937a6 01136ea -- src/webui.ts` is empty: the webui source is byte-identical, only the state list in src/kanban.ts grew to 10 states. The branch was fast-forwarded to main tip 01136ea. All checks below ran on 01136ea, not on a stale base.
- Check 1, source and merge resolution: PASS. `.pair` has `min-width: 300px; flex: 1 0 300px`, the same floor as `.col`; 000096 adds only `.pair .col { flex: 0 0 auto; }` (a height floor fix). buildShell, syncBoard, cardHtml and spinnerHtml are exported, interpolated into PAGE, and used by the per-tab render path (buildShell and syncBoard in render(), cardHtml in syncBoard, spinnerHtml in cardHtml). tabNames, tabsHtml, boardOf, mergeBoards, renderTabs, switchTab, boards and tab.expanded all survive and render() reads tab.tasks and tab.expanded through activeBoard(). A read-only merge audit (`git diff 52b119b^1 52b119b -- src/webui.ts`, `git diff 52b119b^2 52b119b -- src/webui.ts`) shows a correct union: no helper and no behavior from either parent is missing, the only deletions are the replaced old client body and the complementary sides of main's newer work. `git merge-tree --write-tree HEAD 6c90c11` reports no conflict (6c90c11 is an ancestor).
- Check 2, full suite on 01136ea: PASS on the first run. `node src/kanban.test.ts` -> all assertions passed. `node src/orchestrator.test.ts` -> all smoke parts passed. `node src/webui.test.ts` -> all assertions passed. No flake, so no re-run was necessary.
- Check 3, browser (headless Chromium, Playwright 1.63.0 from the npx cache, temp boards, port 0, HOME isolated, production webui on 4242 never touched): 17/17 PASS. Command: `node /tmp/check93/browser.mts` (the probe script stays at /tmp/check93/browser.mts for this session).
  - Structure: backlog | to-do+doing | to-review+reviewing | to-live-test+live-testing | to-merge+merging | done. Four `.pair` wrappers. The to-merge/merging pair comes from #78, which landed during this task.
  - Geometry at 1280px and at 700px: all six top-level boxes and all ten columns are 300px wide. Every `.pair` is as wide as its widest inner `.col`, every `.col` stays inside its `.pair` (left >= pair.left - 1, right <= pair.right + 1), adjacent boxes keep the 10px gap, the top-level boxes stay on one row, and the board scrolls horizontally (scrollWidth > clientWidth).
  - Spinner identity: after 11.2s (two 5s refreshes) the `.spin` node and its Animation object are the same objects, playState is "running" and currentTime advanced to 11699ms. The refresh did not restart the animation.
  - State change: doing -> to-review moves the card, keeps its card element, rewrites its markup and removes the spinner. to-review -> reviewing keeps the card element, rewrites the markup and starts a running spinner. An untouched backlog card and an untouched merging card keep both their card node and their `.name` node, so an unchanged card is not rewritten. Counts update (doing 0, reviewing 1).
  - Hub tabs: the hub serves both registered projects alpha and beta. Both tabs render with alpha active. A click on beta shows beta's cards in the four-pair layout and marks beta active. A click back on alpha restores alpha's board. The hub-served page ships every helper name that main's tests assert.
  - Screenshots: /tmp/check93/wide-1280.png, /tmp/check93/narrow-700.png, /tmp/check93/hub-alpha.png.
- Probe history: the first two probe runs failed on probe-side bugs (a wrong pairLayout index and a missing rect height), not on product behavior. The final probe passed 17/17. I did not change any source file.
- Outcome: the merge resolution is correct. No code change is needed, so the branch has no diff and `git status --short` is clean. This is the valid no-diff pass that the acceptance allows.

## Reviewer verification (2026-10-11)
- Base check: worktree HEAD is 01136ea, the main tip; `git diff main...HEAD` and `git diff HEAD..main` are both empty and `git status --short` is clean. The precondition holds (the #47 merge is an ancestor and `.pair` plus the reconciliation helpers are present).
- Check 1 re-verified from source: src/webui.ts line 527 `.pair` has `min-width: 300px; flex: 1 0 300px`, the same floor as `.col` on line 528. tabNames, tabsHtml, boardOf, mergeBoards, pairLayout, spinnerHtml, cardHtml, buildShell and syncBoard are exported, interpolated into PAGE, and the per-tab render path uses them (render() calls renderTabs() and syncBoard(cols, tab.tasks, tab.expanded, ...) through activeBoard(); syncBoard calls cardHtml; cardHtml calls spinnerHtml). `git diff 52b119b^1 52b119b -- src/webui.ts` and `git diff 52b119b^2 52b119b -- src/webui.ts` delete no helper from either parent.
- Check 2 re-run by the reviewer on the same tree, all first try, no flake: `node src/kanban.test.ts` -> all assertions passed; `node src/orchestrator.test.ts` -> all smoke parts passed; `node src/webui.test.ts` -> all assertions passed.
- Check 3 re-run independently by the reviewer: `node /tmp/check93/browser.mts` exited 0 with 17/17 passed (temp boards, port 0, Playwright 1.63.0, production webui on 4242 untouched). Geometry at 1280px and 700px: every pair and column 300px, no spill, 10px gaps, one row, horizontal scroll. Spinner: same `.spin` node and same Animation after 11.2s, playState "running", currentTime 11699ms. Hub: both tabs render and switch, switched board keeps the four-pair layout, page ships every asserted helper name. Probe output: /tmp/check93/reviewer-probe.json.
- Verdict: PASS, no fixes made. The worktree stays at main with no diff, which the acceptance allows for an already-correct resolution.

## Live test (2026-10-11)
- Precondition re-checked by the live tester: worktree HEAD is 01136ea, `52b119b` (the #47 merge) is an ancestor, `git diff main...HEAD` and `git diff HEAD..main` are both empty, and `git status --short` is clean. No stale base.
- Full suite on the worktree, all first try, no flake: `node src/kanban.test.ts` -> all assertions passed; `node src/orchestrator.test.ts` -> all smoke parts passed (including hub failover, llm config flags, restart preserves in-flight board state, reviewer successful-run cap); `node src/webui.test.ts` -> all assertions passed.
- Browser check as a user: `node /tmp/check93/browser.mts` from /tmp, headless Chromium, temp boards on port 0, production webui on 4242 untouched. Exit 0, 17/17 passed. Probe output saved at /tmp/check93/livetest-probe.json.
  - Pair layout: 4 `.pair` wrappers (to-do/doing, to-review/reviewing, to-live-test/live-testing, to-merge/merging) plus backlog and done. The wide-1280 screenshot shows no overlap and the board scrolls right to the fifth pair and done.
  - Geometry at 1280px and 700px: every pair and column 300px, no spill, 10px gaps, one row, horizontal scroll.
  - Spinner: same `.spin` node and same Animation after two 5s refreshes, playState "running", currentTime 11699ms. State change moves the card, rewrites only its markup, keeps untouched cards' nodes, and starts/stops the spinner.
  - Hub tabs: alpha and beta render, clicking beta shows beta's cards in the pair layout, clicking back restores alpha. The hub page ships every asserted helper name.
- Verification-only pass: the merged resolution is correct, no code was edited, no issue found.
- Open questions: none.

## Merge (2026-10-11)
- Step 1, worktree merge of main into fix/93-verify-the-merged: the branch tip 01136ea was the merge base (the branch had no unique commits, the verified resolution produced no diff), so `git merge main` fast-forwarded it to main tip 33c2283. No conflicts, nothing to resolve, no fix commits needed.
- Test suites on the new tip 33c2283, all first try, no flake: `node src/kanban.test.ts` -> all assertions passed; `node src/orchestrator.test.ts` -> all smoke parts passed (including task removal, blockedBy failsafe); `node src/webui.test.ts` -> all assertions passed.
- Source invariants re-checked on 33c2283, since main advanced past 01136ea with 273 changed lines in src/webui.ts (agent history, accents, modal overlay fix, run buttons): `.pair` still has `min-width: 300px; flex: 1 0 300px`, the same floor as `.col`; tabNames, tabsHtml, boardOf, mergeBoards, pairLayout, spinnerHtml, cardHtml, buildShell and syncBoard are all present, and the per-tab render path still uses them (renderTabs and switchTab at src/webui.ts lines 775 and 781, render() calls both).
- Browser probe re-run on the new tip: first run 16/17. The one failure was a stale probe expectation, not a product bug: the probe asserted the merging column's card has no spinner, but 2e0bcb2 (a main feature, "webui accents and a merging spinner for the to-merge/merging columns") added `merging` to spinnerHtml's spinner states. Probe detail confirms the substance passes (cardSame: true, nameSame: true, spinner running). I updated the probe's expectation in /tmp/check93/browser.mts (outside the repo) to assert `spinner: true` for merging and re-ran: ALL 17 BROWSER CHECKS PASSED (exit 0, /tmp/check93/merger-probe.out). No repo file was touched for this.
- Step 2, main merge of fix/93-verify-the-merged: `git merge --no-edit fix/93-verify-the-merged` -> "Already up to date." (main 33c2283 equals the branch tip after the fast-forward). Working tree clean, no merge commit created.
- Outcome: both merges complete, main is clean at 33c2283, worktree clean at 33c2283. No product change was needed; the verified resolution survived main's advance. No open questions.
