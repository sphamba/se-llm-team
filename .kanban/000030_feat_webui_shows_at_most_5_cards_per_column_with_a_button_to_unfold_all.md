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

- Hold satisfied: 000025, 000026, 000028, 000029 all done and merged before I started.
- src/webui.ts: render() slices each column to VISIBLE = 5 cards (sort unchanged, most recently updated first); a column with more renders one toggle button below the cards: "show all (N)" unfolds all, "show less" collapses back to 5. The choice lives in a JS Set keyed by state (expanded), so the 5 s refresh keeps it. Header count still shows the total.
- .toggle styled like the theme button (border, radius, link color, full width).
- Verified with a throwaway DOM-stub check (not committed, constraint limits changes to src/webui.ts): 12-task backlog shows exactly 5 cards + "show all (12)", toggle unfolds to 12 + "show less", render() keeps the choice, toggling again collapses back to 5. It also caught a template-literal quote-escaping bug in the onclick attribute, now fixed.
- node --test src/*.test.ts: all 3 files pass (kanban, orchestrator, webui).
- Committed in worktree as c0204ca.
- Review (state reviewing, worktree c0204ca, clean): pass, no fixes. Diff is src/webui.ts only (10+/2-), constraint met. Checked against every spec line: slice to VISIBLE = 5 with sort unchanged (newest first), one toggle button rendered only when inState.length > 5, expanded Set is module-level so the 5 s refresh keeps the choice, header count still shows the total, empty columns unaffected.
- Reviewer re-verification: node --test src/*.test.ts all 3 pass. Emitted PAGE client JS extracted and node --check clean; the onclick double-escaping through the template literal resolves to onclick="toggleCol('<state>')" which is valid. DOM-stub check reproduced the developer results: 5 cards + "show all (12)" -> 12 + "show less" -> survives render() -> collapses back to 5, columns with <=5 get no button.
- Live test (state live-testing, worktree c0204ca): pass, no issues found. Stopped the running main-checkout daemon, started the daemon from the worktree with root=/home/phamba/repos/se-llm-team, webui came up on port 4242. Restored the main-checkout daemon after the test.
- Drove the page in headless Chrome (playwright-core + system Chrome; script and screenshots in /tmp only, nothing committed): 25/25 checks pass.
- Default view: every column shows at most 5 cards. Backlog (6 tasks) showed exactly 5 cards and a "show all (6)" button. Done (32 tasks) showed exactly 5 cards and a "show all (32)" button. Live-testing (2 tasks) and the empty columns showed no button. Header count kept the total while folded (6 and 32).
- Toggle: clicking unfolded the column to all cards and the button changed to "show less". Columns toggle one by one: done stayed folded while backlog was open, and the reverse. Clicking again collapsed backlog back to 5 with "show all (6)".
- The choice survived two 5 s refreshes, both open and folded, on both columns.
- Existing flow not broken: card click still opens the task modal, Close still hides it.
- Merge note: the daemon defers the branch merge until the live-tester pid dies, so the merge lands after this session ends. Expected per design.
