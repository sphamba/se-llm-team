---
name: "feat: agent and subagent link lines in the task detail view"
priority: "medium"
state: "done"
worktree: ""
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

- Implemented in src/webui/page.ts: `#agent-relations` SVG as #m-agent's first child (#m-agent position relative z-index 0, .agent-card z-index 2), path CSS mirroring the board's #relations path plus .relations-hot/.relations-sel at opacity .8, the reduced-motion rule gaining the new selector, a dropCurve helper (bottom-center out, left-edge in, vertical offset span-scaled and capped at 60px, fixed 8px arrival hook), drawAgentRelations (run chain via the board curve(), drops to .agent-subs cards and to every doctor card matched by stripping the trailing ".doctor", svg.__html rewrite gate that re-applies the hover and re-runs markActiveAgent, bail while #modal carries .hidden), hotAgentRelations, a markActiveAgent selection loop over the new paths, per-card onmouseenter/onmouseleave bindings in renderAgent, renderDoctor and fetchSubs, and draw call sites at openTask (after the un-hide, plus a self-clearing #m-box onanimationend redraw once the entrance animation settles), the end of updateOpenTask, after fetchSubs lands, and a once-registered window resize listener.
- Tests first (red confirmed on the #m-agent markup pin), then green: tests/webui.test.ts gained the updated markup pin at :883 (SVG as #m-agent's first child), a new section of string pins (CSS, call sites, hover bindings, hoverHandle re-apply) and function-level runs (dropCurve geometry, drawAgentRelations against a stub DOM covering the run chain, the flex-wrap case, sub and doctor drops, the html gate, the hidden-modal bail and the hover re-apply, hotAgentRelations, markActiveAgent selection for the run, sub and closed-log cases); the stale reduced-motion pin at :571 was updated. `node tests/webui.test.ts` passes.
- Live check on a /tmp/rel-check fixture (4 run logs, 1 sub, a doctor log matched to run 0), Playwright in dark and light: 44 assertions ok, 0 failures. Chains and drops carry the right endpoints, dim 0.3 at rest, hover raises run 0's 3 lines to 0.8 and mouseleave reverts, selection highlights the 3 connected lines and opens the log, dashflow runs, the cards sit above the lines and keep their clicks, and the hover raise survives the entrance-settle rewrite.
- Committed as fc4120c in the worktree.
- Review of fc4120c: diff vs main touches only src/webui/page.ts and tests/webui.test.ts (no server, payload or API changes; the board's #relations layer untouched, curve() reused unmodified). Rendering verified in the diff: #agent-relations SVG as #m-agent's first child, #m-agent relative z-0, svg z-1 pointer-events none, .agent-card z-2, path CSS byte-mirrors the board's #relations path (asserted after selector swap), the reduced-motion rule gains #agent-relations, hover raise/revert bound on run, sub and doctor cards, markActiveAgent lights the selected card's connected lines, the svg.__html-gated rewrite, draw sites at openTask (post-un-hide plus self-clearing entrance-settle onanimationend, real: #m-box runs boxIn), updateOpenTask, fetchSubs and a once-registered resize listener; the :881-882 refresh pins stay intact.
- Shape checks: the doctor match's /\\.doctor$/ in the page.ts source is the template-literal escape (the served page carries /\.doctor$/, which the test asserts); curve(from, box(next), false) is the correct same=false branch (cross-column and wrapped pairs; the side reversal on wrap is curve()'s own minimizing behavior); #m-head is sticky z-1, so the z-0 #m-agent keeps the z-2 cards under it.
- tests/webui.test.ts: exit=0, all assertions passed (one run).
- Open questions closed: the wrap-side reversal and the ~9px left-edge clip are inherent to the spec-pinned curve() reuse (verified live at 375px, recorded in the implemented-commit note); both entries deleted as spec-answered assumptions, no user questions remain.

## Live test (hub-only, worktree commit 8c95600)

- Fixture: /tmp/rel237/repo held a to-review task with 4 run logs (developer.0, developer.1, reviewer.0, live-tester.0), one sub transcript that developer.0 names in /tmp/pi-subagents-1000, one developer.0.doctor.log, and two backlog probes for the board line. The hub served the worktree on port 4383 with an isolated HOME. Playwright ran 30 checks: 29 passed, 1 failed.
- Lines: 5 paths render (3 chain, 1 sub drop, 1 doctor drop). Each chain path runs from a run card's right edge into the next card's left edge. The sub and the doctor leave run 0's bottom edge and enter the card's left side. The doctor card is matched by its stripped handle and sits in its run's column.
- Layering: the svg is #m-agent's first child with z-index 1 and pointer-events none, the cards have z-index 2, and a card click opens the right log. The lines do not block the cards.
- Rest and hover: at rest each path reads stroke-opacity 0.3, stroke-width 1.5, dash 6 4 and the muted stroke. Hovering run 0 raises its 3 connected lines to 0.8. Mouseleave reverts all 5 to 0.3. The sub card raises its drop. The doctor card raises only the doctor drop.
- Selection: the selected run keeps its 3 lines at 0.8 through a poll refresh. A refresh does not rewrite the svg, so the same path nodes keep the dash animation running.
- Wrap: at 375 px the run row wraps (card centres 22, 22, 22, 167) and the chain still connects every adjacent pair right-out to left-in. The sub and doctor drops survive.
- Themes: in dark and light the path stroke equals var(--muted) (rgb(90, 102, 115) and rgb(173, 174, 177)) and 5 paths stay.
- No page or console errors.
- FAIL, reduced motion. In a `reducedMotion: "reduce"` context the board's #relations path reads animation none, but all 5 #agent-relations paths keep animation dashflow. The Specs (Rendering) say prefers-reduced-motion disables the new animation. Cause: the media rule at src/webui/page.ts:163 (served line 79) does carry the new selector, but the base `#agent-relations path` rule at src/webui/page.ts:212 (served line 128) sits later in the same sheet with equal specificity, so `animation: dashflow 1s linear infinite` wins. A fix can move the base rule above the media block, move the reduced-motion rule after the base rule, or raise its specificity.
- Assumptions: "both themes" means the explicit #theme toggle. "Lines behind the cards" rests on z-index, DOM order and a card click-through, with no pixel comparison. The fixture holds no doctor without a run, because the Specs tie every doctor drop to its analysed run. The shipped unit tests were not run (role test policy), and the live check covers the acceptance surface they pin.
