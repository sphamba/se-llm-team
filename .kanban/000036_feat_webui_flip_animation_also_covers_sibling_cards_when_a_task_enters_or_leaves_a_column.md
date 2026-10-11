---
name: "feat: webui FLIP animation also covers sibling cards when a task enters or leaves a column"
priority: "low"
state: "done"
worktree: "feat/webui-flip-animation-also-covers-sibling-cards-when-a-task-enters-or-leaves-a-column"
---

# Summary
Extend the 000028 FLIP animation: when a card enters or leaves a column, animate the sibling cards that shift vertically too, instead of letting them jump.

# Specs
Animate sibling cards on column change (follow-up to 000028).

Facts:
- 000028 (merged) implements FLIP in src/webui.ts: it records positions before a state change and animates the moved card to its new column; unchanged refreshes do not re-animate.
- Gap: when a card leaves or enters a column, the sibling cards in that column jump vertically (they are re-rendered at new positions with no transform).

Changes (src/webui.ts only):
- Extend the FLIP pass: before the DOM update, record the rect of every card element (or at least all cards in the columns that gain or lose a card), keyed by the stable task number. After the update, apply inverted transforms to every card whose position changed, not only the card whose state changed.
- Use the same duration and easing as the moved-card animation from 000028.
- Keep the unchanged-refresh guard: a 5s refresh that renders identical positions animates nothing.
- Respect the reduced-motion setting if 000028 added one.

Acceptance:
- Removing a card from a column slides the cards below upward; adding a card slides them downward.
- The moved card keeps its lateral animation from 000028.
- Unchanged refreshes do not animate.
- Existing tests pass; extend webui.test.ts with an assert-based check for the FLIP diff (which cards get transforms) per repo convention.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000029 (chip fix) → 000030 (cap/unfold) → 000032 (One Dark) → 000033 (agent view), all in src/webui.ts.

# Notes

Implemented in the worktree, committed as 8d792fe (src/webui.ts + src/webui.test.ts only).

- New exported `flipDiff(oldPos, newPos)` in src/webui.ts: pure FLIP diff keyed by data-file; returns {dx, dy} for every card whose board-content position changed, skips new files and unchanged positions. It is interpolated into the PAGE template, so the client ships the exact source the test imports.
- render() now measures every card's position board-content relative (viewport rect minus board rect plus board scroll), before and after the innerHTML replace, and applies inverted transforms to every position-changed card. The prevStates state-change gate is gone; the unchanged-refresh guard is the position diff itself, and it is scroll-stable, so a refresh after scrolling the board animates nothing.
- Same duration and easing as 000028 (`transform .4s ease`); the moved card keeps its lateral slide and gains the vertical part; the reduced-motion guard is unchanged.
- webui.test.ts: assert-based flipDiff checks for leave (moved card gets the lateral dx, siblings below get the upward dy), enter (siblings get the downward dy, the new card gets none), unchanged refresh (empty diff), plus asserts that the served page ships the tested flipDiff source and the .4s timing. All three suites pass (kanban, orchestrator, webui).
- Live check in headless Chromium against a temp board (throwaway playwright-core in /tmp, since the repo gains no dependency): top card leaving first-frame tx=-420 on the moved card, ty=+68.5 on the siblings below (start below, slide up); re-entry gives tx=+420 and ty=-68.5 (slide down); an unchanged 5s refresh recorded zero transforms; inline transforms settle back to empty after each animation. Harness note: MutationObserver misses the transform because it is set and cleared synchronously in one task, so the check polls getComputedStyle per rAF frame.

Review (no fixes needed):
- Diff 8d792fe vs main touches only src/webui.ts and src/webui.test.ts, per the constraint. HOLD satisfied: 000029, 000030, 000032, 000033 are all done and merged into the branch base.
- flipDiff semantics re-derived by hand and correct: leave gives the moved card the lateral dx and siblings below an upward-slide dy; enter gives the siblings a downward-slide dy and the new card nothing; unchanged positions give an empty diff. First render animates nothing (every file is new in the first diff).
- Interpolation verified: String(flipDiff) does not include the export keyword, so the PAGE interpolation ships clean client JS inside the script block, and the test's page.includes(String(flipDiff)) assertion binds the served source to the tested function.
- Position math is scroll-stable: page scroll cancels in (rect - boardRect), board scroll is added back; board has overflow-x: auto so board.scrollLeft is real.
- Re-ran all three suites in the worktree: webui, kanban, orchestrator all pass.

Live test (result: pass, no issues with the change):
- Ran the project from the worktree like a user: daemon started with node src/orchestrator.ts --root /tmp/lt-000036 (throwaway board, 3 backlog + 2 done tasks), project .kanban/se-llm-team.json overrode the webui to port 4389 (production daemon owns 4242). The webui came up, served the worktree code (flipDiff present in the page), and the port-conflict path was confirmed incidentally: the first start attempt logged "web ui failed to start, continuing without it" and the daemon kept running.
- Drove the real page in headless Chromium (playwright-core 1.63 + chromium_headless_shell-1243) with a per-frame getComputedStyle sampler (MutationObserver misses the transform, it is set and cleared in one task): 30/30 checks passed.
- Leave (top backlog card -> done): moved card first frame tx=-1470 ty=0 (lateral animation from 000028 intact); the two siblings below slid upward, first-frame ty=+86.1 each (start below, ease to rest); the two done siblings below the entering card slid downward, ty=-86.1. Every first-frame transform matched the geometrically expected inverted delta within 4px.
- Enter (card back to backlog): moved card tx=+1470; backlog siblings slid downward (ty=-86.1), done siblings slid upward (ty=+86.1). Same match.
- Cards whose position did not change between renders got no transform at all (first run observed this on unchanged done siblings), so flipDiff skips unchanged cards as specced.
- Unchanged refreshes (11 s, no edits) recorded zero transforms; a refresh with the board horizontally scrolled (scrollLeft=266) also recorded zero transforms (scroll-stable guard).
- Reduced motion (prefers-reduced-motion: reduce emulation): state change applied no transforms, board still updated instantly.
- User sanity: modal opens on card click and closes; inline transforms are cleared back to empty after each animation settles.
- All three suites re-run in the worktree: webui, kanban, orchestrator all pass.
- Harness notes for future live tests: chromium_headless_shell works while full chrome fails on this machine ("Failed to create headless user data directory container"); touch -d with a bare time sets a future mtime and silently changes the board sort (sort is updated-desc, so the moved card entered columns at the bottom instead of the top); the daemon reconcile restores deleted .kanban files from the meta/kanban mirror, so delete the mirror branch too when cleaning a throwaway board.
