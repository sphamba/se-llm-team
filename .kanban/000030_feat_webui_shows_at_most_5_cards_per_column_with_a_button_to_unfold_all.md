---
name: "feat: webui shows at most 5 cards per column, with a button to unfold all"
priority: "low"
state: "backlog"
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
