---
name: "feat: agent and subagent link lines in the task detail view"
priority: "medium"
state: "doing"
worktree: "feat/237-detail-relation-lines"
issuer: "user"
complexity: "moderate"
shortName: "detail-relation-lines"
---

# Summary
The task detail view shows run columns, subagents and doctor cards with no visual links. Add an SVG layer behind the cards with animated dashed lines: run cards chained left to right (surviving a flex-wrap line break), and vertical lines from each run card's bottom edge into its subagent and doctor cards by their left side, highlighted on hover or selection like the board's relation lines.

# Specs
# Problem
The task detail view shows the agent run columns and their stacked subagent and doctor cards with no visual links. The user wants animated dashed connector lines, like the board's blocking relation lines.

# Links to draw
1. Main run cards left to right: one .agent-col per run in #m-agent-btns (src/webui/page.ts:629-664); the run card is the col's own .agent-card (dataset.handle, no data-sub). Chain each run card's right edge to the next run card's left edge, reusing the board curve() geometry (right-out/left-in, span-scaled S-bend). #m-agent-btns is flex-wrap: wrap, so a narrow screen moves the next run to the following line: the curve still connects the pair (it spans any x/y pair), so the line survives the wrap.
2. Agent to subagents and doctor, vertically: from the main agent card's bottom edge (heading down) to each subagent card in the col's .agent-subs and to each doctor card of that run by their LEFT side (heading right). Doctor cards render inside the analysed run's .agent-col (matched by stripping the trailing ".doctor" from the handle, the #230 rule) and in the residual #m-doctor row: every doctor card connects to its analysed run's main card wherever it renders.

# Rendering (mirror the board's #relations pattern)
- A new SVG layer inside #m-agent (which becomes position: relative), inserted before the cards, pointer-events none, z-index below the cards (the cards get z-index 2 like the board) so the lines paint behind the cards.
- Path style like #relations path: fill none, stroke var(--muted), width 1.5, stroke-opacity .3, dasharray 6 4, the dashflow animation; prefers-reduced-motion disables it (the :163 rule gains the new selector).
- Hover: hovering an agent or subagent card raises its connected lines (a relations-hot-like class at stroke-opacity .8); mouseleave reverts. The paths carry both endpoint handles as data attributes, so the match needs no selector interpolation (the hotRelations pattern, page.ts:407-410, and the onmouseenter binding, page.ts:389-390).
- Selection: markActiveAgent (page.ts:577-585) toggles .agent-card-active; the selected card's connected lines stay highlighted while it is selected.
- Redraw: the lines recompute when the layout changes (modal open, updateOpenTask's renderAgent rebuild on every poll cycle, sub fetches landing, window resize), and the SVG innerHTML is rewritten only on change so the dash animation keeps running across refreshes (the drawRelations pattern, page.ts:412-434). Measurements are relative to the SVG's offset parent with scroll compensation (the cardBox pattern, page.ts:398-405).

# Constraints
- No payload or API changes; the handles already encode the parent run (strip .doctor).
- updateOpenTask and renderAgent keep their behavior; tests/webui.test.ts:881-882 pin the refresh path (the open card updates in place; the refresh never touches the log pane, logState or the log timer) and stay valid.
- The board's #relations layer and its geometry are untouched, except curve() being reused.
- No server changes.

# Acceptance
- Live check: a task with multiple runs, subs and a doctor: the run cards chain left to right with flowing dashes, each sub and doctor card is connected from its run's bottom edge and entered by the left side, the lines sit behind the cards, dimmed at rest, highlighted on hover and while a card is selected, and the chain survives a narrow-screen wrap, in both themes.
- The tests the developer ships (per the role test policy) pass, including the :881-882 pins.

# Notes
