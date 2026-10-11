---
name: "feat: webui shows at most 5 cards per column, with a button to unfold all"
priority: "low"
state: "done"
worktree: ""
---

# Summary
In the webui, cap the cards displayed per column at 5. When a column holds more, show a button below the cards that unfolds all of them.

# Specs
Cap the visible cards per column.

Changes (src/webui.ts):
- In render(), show at most 5 cards per column (sorted as today, most recently updated first per 000025).
- When a column holds more than 5, render a button below the cards, for example "show all (12)".
- Clicking the button unfolds the column to all cards; clicking again ("show less") collapses back to 5. One toggle button.
- Keep the expanded/collapsed choice in a JS Set keyed by state, so the 5 s refresh (render()) does not reset it.
- The column header count already shows the total; keep it.

Acceptance:
- At most 5 cards visible per column by default.
- The button appears only when the column holds more than 5.
- The choice survives refreshes.
- Existing tests pass.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000025 (batch) → 000026 (spinner) → 000028 (animation) → 000029 (chip fix), all in src/webui.ts.

# Notes
- The work was already completed by an earlier run of this task: commit 99c4520 "feat: webui shows at most 5 cards per column with a toggle to unfold all" (2026-10-10), merged into main via ca8569f. This session verified the implementation against the specs instead of re-writing it.
- Verified in the current code (src/webui.ts): VISIBLE = 5; render() slices each column to 5 cards with the sort unchanged (most recently updated first); one toggle button below the cards appears only when a column holds more than 5, labeled "show all (N)" collapsed and "show less" expanded; the choice lives in the `expanded` Set keyed by state name, declared outside render(), so the 5 s refresh keeps it; the header count still shows the total.
- Verified the commit touches only src/webui.ts (12 lines), as the constraints require. Worktree clean and at main (cb6e1c4), so no new commit was needed.
- Tests: node src/webui.test.ts, node src/kanban.test.ts, node src/orchestrator.test.ts all pass (webui.test.ts reports all assertions passed; orchestrator.test.ts reports all smoke parts passed).
- Review (2026-10-11): re-verified independently against the specs. Commit 99c4520 is reachable from main (merge ca8569f), worktree HEAD equals main (cb6e1c4), git diff main...HEAD empty. All spec points hold: 5-card cap, single toggle button below the cards shown only when a column exceeds 5, "show all (N)"/"show less" labels, module-scope `expanded` Set keyed by state survives the 5 s refresh, header count unchanged, sort unchanged. The `\\'` escaping in the toggle onclick is correct because the client script is embedded in a server-side template literal. Only src/webui.ts touched (12 lines). Tests re-run and pass. No fixes needed; state set to to-live-test.
- Live test (2026-10-11, this session): started a fresh webui from the worktree on port 4243 against the shared board (backlog 8, done 43 tasks) and drove it with a headless Chromium (Playwright). All checks passed. Default: every column shows at most 5 cards; empty and small columns (to-do 0, doing 1, live-testing 1) show no button; backlog and done show "show all (8)" / "show all (43)" below the cards. Click "show all (8)": all 8 backlog cards unfold, label changes to "show less", header count stays 8. After the 5 s auto-refresh the column stays expanded (choice survives render()). Other columns stay capped at 5 while one column is unfolded. Second click: column collapses back to 5 cards, label returns to "show all (8)". Card detail modal opens on card click and closes on overlay click. Screenshots: /tmp/webui-fold-collapsed.png, /tmp/webui-fold-expanded.png. Note: a full page reload resets the choice to collapsed; the spec only requires surviving the 5 s refresh, so this is not a defect. Existing tests re-ran from the worktree and pass (webui, kanban, orchestrator). No issues found; state set to done.
