---
name: "fix: model meta moves outside the log pane, above it"
priority: "low"
state: "done"
worktree: ""
blockedBy: ""
issuer: "user"
complexity: "trivial"
shortName: "meta-outside-log-pane"
---

# Summary
Following #146, the model name and thinking level (#m-log-meta) should render outside of the log pane, above it, instead of inside the scrolled pane.

# Specs
Current state: #146 added a #m-log-meta line showing "model · thinking <level>" (muted grey, hidden when absent) but it sits inside the #m-log pane above #m-log-text, so it scrolls with the log content and disappears when the log is scrolled.

Changes (src/webui.ts + src/webui.test.ts only):
- Move the #m-log-meta element outside of #m-log so it renders as a sibling above the pane and stays fixed while the log scrolls (the log pane's own height/scroll behavior from #152 stays untouched).
- pollLog/pullLog keep updating the meta line live each second as they already do; hidden when absent.
- Keep the #146/#147/#148/#140/#122 rendering rules, chunk walk-back, offsets and dedupe untouched.
- Update any src/webui.test.ts assertions that pin the meta line inside the pane.

Tests: the webui suite stays green (run it as the check).

# Notes
- Moved `<div id="m-log-meta" class="hidden"></div>` out of `#m-log` in the page HTML, so it now sits as a sibling directly above the pane and stays fixed while the log scrolls (commit ea327b2).
- closeLog now clears and hides the meta itself: it no longer hides with the pane, so leaving it untouched would keep the stale meta visible after close. openLog still resets it to hidden before the init payload, and pullLog still refreshes it on every payload mode.
- CSS untouched: `#m-log-meta { padding: 6px 10px 0; ... }` still aligns it with the pane's content edge; the pane's own margin/height/scroll rules from #152 untouched.
- Updated the one src/webui.test.ts DOM assertion that pinned the meta inside the pane; `npx tsx --test src/webui.test.ts` passes (all assertions).
- Review (2026-07-18): diff matches the specs; `npx tsx --test src/webui.test.ts` re-run green (1 pass, 0 fail). Verified every show/hide path for the meta line: openLog resets it before init, pullLog refreshes it on every payload mode, closeLog clears it, closeModal goes through closeLog, renderAgent only touches #m-agent-btns so the meta element survives re-renders.
- Review findings: none. The closeLog clear/hide is the one change beyond the literal spec text; it is required, not optional, because #m-log.hidden no longer covers the sibling meta and a stale label would linger after toggling the log closed. It was already documented in these Notes, so not a silent assumption. Assumptions checked: sibling placement inside #m-agent matches the spec wording; no-visual-redesign matches "CSS untouched" intent. Minor nit, not fixed: meta text left edge sits 1px left of the pane text (meta padding 10px vs border 1px + padding 10px); imperceptible at 10px font and not worth a CSS change.
- Live test (2026-07-18, PASS): ran the worktree's own hub (`startHub` from src/hub.ts, temp HOME registry) on 127.0.0.1:45154 serving the real board, then drove a real Chromium through the UI (16/16 user-flow checks passed, no findings).
  - Structure: `#m-log-meta` is a direct child of `#m-agent` and the immediate previous sibling of `#m-log` (not a descendant); hidden and empty before any log opens; the pane keeps `max-height: 70vh; overflow: auto` (computed `700px`/`auto` at a 1000px viewport, #152 intact).
  - Fixed above the pane: after paging history up until the pane overflowed (853 and then 1114 content px vs 698 client px), the meta bounding box top stayed 345px at scrollTop 0, 208 and 416 while the meta text stayed "DeepSeek V4.1 Flash · thinking max" (screenshot /tmp/selive154/shot-log-scrolled.png).
  - Live update: the 1s log poll kept landing while scrolled (5 calls in 2.2s) and kept the meta visible and unchanged.
  - Run switch: opening the developer run replaced the meta with "GLM 5.3 Flash · thinking max".
  - Close: toggling the open run closed the pane and cleared plus hid the meta (text "", display none, no stale label, screenshot /tmp/selive154/shot-log-closed.png); closing the modal did the same; reopening restored the meta.
  - Hidden when absent: an old run without model/thinking records (task #30 live-tester log, API model/thinkingLevel null) kept the meta hidden and empty through a poll, and a later model-bearing run in the same session showed it again (no stuck hidden state).
  - Assumptions of the live test: the served board was the main checkout's real board (the change is view-only, so the test hub read it without modifying anything); the worktree's webui.ts was confirmed served by grepping the new markup from `/`; the scroll case needed history paging because the live run's tail chunk rendered short; the model-less run came from an old gzipped log since all post-#146 runs carry a model.
  - Observed contradiction with the task's stated assumptions: none. The measured meta left edge sits 1px left of the pane text edge (338 vs 339), exactly the reviewer's documented nit; imperceptible, not an issue.
- Merge (2026-07-18, merger): both merges clean. Step 1: merged base branch `main` into `fix/154-meta-outside-log-pane` in the worktree — already up to date, no conflicts, so test suites were skipped per merge protocol. Step 2: re-resolved base branch as `main` and merged `fix/154-meta-outside-log-pane` into it in the project root — fast-forward 59652c3..ea327b2, src/webui.ts +5/-1 lines and src/webui.test.ts 1 line changed, no conflicts. Nothing resolved beyond the fast-forward; no fixes carried.

# Open questions
None.
