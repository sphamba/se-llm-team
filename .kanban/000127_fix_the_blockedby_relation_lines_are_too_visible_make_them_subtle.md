---
name: "fix: the blockedBy relation lines are too visible; make them subtle"
priority: "medium"
state: "done"
worktree: ""
complexity: "simple"
blockedBy: ""
---

# Summary
The blockedBy relation lines on the board draw at full opacity and stand out too much behind the task cards; make them subtle, and highlight the lines of a hovered task (more opaque while hovering). Also, cross-column lines between columns far apart flatten into a near-straight diagonal; shape those as an S so they hug the cards at both ends and cross in the middle. Same-column and adjacent-column lines already look good.

# Specs
# User observation (2026-10-12)

Same-column loops and lines between columns next to each other look good. Lines between columns FAR apart look wrong: the single cubic with the fixed 40px bow flattens over the long span and reads as a straight diagonal. Those must look like an S.

# 1. Subtle lines (src/webui.ts ~:746, src/webui.test.ts)

#relations path draws stroke: var(--muted) at full opacity, stroke-width 1.5. Add transparency so the lines read as subtle hints behind the semi-transparent cards, not a dominant overlay:

- Add stroke-opacity around 0.3 (0.25-0.35, pick what reads subtle in both themes), or use a color-mix with transparent - one approach, no new variables.
- Keep the dash animation (dashflow), stroke-dasharray, pointer-events: none, the z-index layering from #124 (lines above column containers, below cards, modal on top), and the prefers-reduced-motion static-dash rule intact.
- src/webui.test.ts: assert the path rule carries the reduced opacity (e.g. stroke-opacity set and below 1).

# 2. S-shape for far-apart columns (curve(), src/webui.ts ~:620-646, src/webui.test.ts)

curve() returns one cubic "M x1 y1 C c1x y1, c2x y2, x2 y2" with c1x/c2x offset by the fixed bow 40. For cross-column relations where the horizontal span between the endpoints is large, the curve must read as an S: leave horizontally from the source card, cross in the middle, and arrive horizontally into the target card.

- Scale the control offsets with the horizontal span for cross-column curves, e.g. c1x = x1 ± max(bow, span * 0.35) and c2x = x2 ∓ max(bow, span * 0.35) with the span = |x2 - x1| and the proportion/cap the developer picks (cap so extreme widths do not overshoot the board).
- Same-column loops keep the current fixed bow untouched, and adjacent-column lines keep today's look (the span there is small, so a threshold or the cap naturally keeps the fixed-bow behaviour - make sure adjacent columns do NOT change appearance).
- The endpoints, the side-pair choice, the direction (blocked -> blocker so the dashes flow towards the blocker) and the recompute triggers (5s refresh, transitionend, resize, fold changes) stay intact.
- src/webui.test.ts: assertions that a far-apart pair produces control offsets proportional to the span (S shape) while a near pair and a same-column pair keep the fixed bow.

# 3. Hover highlights the task's lines (src/webui.ts, src/webui.test.ts)

Hovering a task card raises the opacity of that task's blocked-by lines (all paths drawn FROM that card towards its blockers), reverting on mouseleave:

- The render already builds one path per relation; keep them keyed by the blocked task's file so the hovered card's paths are reachable without re-deriving geometry.
- On card mouseenter, add a class to those paths (e.g. .relations-hot) that raises stroke-opacity clearly above the subtle base (e.g. 0.8); on mouseleave remove it. A short transition on stroke-opacity keeps it smooth; the dash animation continues.
- Do not break #124's layering (paths stay below the cards) or pointer-events: none (the hover comes from the cards, not the SVG).
- Bind by dataset like the existing card handlers (a hand-written task file name can hold quotes); rebindings survive the 5s refresh (the sync reuses card nodes, so bind like openTask's delegation or rebind on render).
- src/webui.test.ts: the hot rule carries the raised opacity, and the card hover wiring exists (e.g. the delegation handler adds/removes the class by the hovered card's file).

# Complexity

simple (user-ordered 2026-10-12). Files: src/webui.ts and src/webui.test.ts only.

# Notes

- Implemented in worktree fix/127-the-blockedby-relation, commit 12ebabd. All 5 test files pass.
- Subtle lines: #relations path now carries stroke-opacity: .3 plus transition: stroke-opacity .15s ease; the .relations-hot rule raises it to .8. Dashflow, stroke-dasharray, pointer-events: none, the #124 z-index layering and the reduced-motion static-dash rule untouched.
- S-shape: curve() scales the cross-column control offsets with the horizontal span (span * 0.35, capped at 480, floored at the fixed bow 40), so far-apart columns bend into an S that leaves and arrives horizontally and crosses in the middle. Same-column loops and near pairs keep the fixed 40px bow (the small span never exceeds the floor).
- Hover: relationPaths() now returns { file, d } keyed by the blocked task's file; drawRelations writes data-file onto each path and makeCard binds onmouseenter/onmouseleave to hotRelations(file, on), which toggles .relations-hot by dataset comparison (no selector interpolation, safe for quoted file names). Binding sits in makeCard, whose nodes the 5s refresh reuses, so it survives refreshes.
- Tests: relationPaths assertions moved to the .d field plus a keyed-file assert; new asserts cover the S offsets (span * 0.35), the 480 cap, fixed bow for same-column and adjacent pairs, horizontal tangents, base opacity in (0, 1), hot opacity above base, the transition, and the hover wiring on the served page.
- Review (2026-10-13): verified against all three spec items, no fixes needed. Commit 12ebabd checked: stroke-opacity .3 with .15s transition, dashflow/pointer-events/z-index/reduced-motion intact; sBend caps control points inside the endpoint span (no board overshoot even above the 480 cap), adjacent columns keep the fixed bow (real board gap 10px, span never reaches the floor); hover binding survives refresh because syncBoard reuses card nodes keyed by file, and the dataset match is quote-safe. All 5 test files pass (webui, extension, kanban, orchestrator, index); worktree clean. State set to to-live-test.
- Live test (2026-10-13): passed, no issues found. I served the worktree web UI with a scratch hub (worktree src/hub.ts, an isolated HOME and port 4599/4600) and drove it with headless Chromium. Boards: one synthetic board with all three geometry cases, and the real board (the live .kanban, 133 tasks). Checks: 24/24 geometry, style and hover checks on the synthetic board, 4/4 extra hover checks, 8/8 on the real board. No unit suite was run.
- Subtle lines: every served path reports stroke-opacity 0.3 in the light theme and in the dark theme. The dashflow animation, the stroke-dasharray, pointer-events: none, the .15s stroke-opacity transition, the #124 stacking (#relations 1, cards 2, modal 3) and the prefers-reduced-motion animation: none rule are intact.
- S shape: on the real board the far relation #128 to #127 spans 652px and the two control offsets are 228.2px each (span * 0.35). The curve leaves and arrives horizontally, both endpoints sit on the card edges, and the curve midpoint is exactly at the span centre (633.0). The adjacent pair (span 32) and the same-column loop keep the fixed 40px bow. The dashed direction is still blocked to blocker.
- Hover: hovering #128 raises only its own path to 0.8 and marks it .relations-hot. All other lines stay at 0.3. A mouseleave reverts the line. A task with two blockers lights both of its paths. Hovering a blocker or an unrelated card lights nothing. The hot state survives the 5s refresh. Clicking still opens the detail card above the lines.
- Before and after check: the unfixed main checkout served stroke-opacity 1 and a flattened cubic for the far pair (control at x2 - 40). The worktree serves 0.3 and the S. The change is live and visible.
- Observation, no action: in the light theme the 0.3 lines are very faint at 1600px width, though still visible, and the dark theme reads a little stronger. This is inside the spec range of 0.25 to 0.35, and the hover reveal makes the lines of the hovered task easy to find. The user can ask for a different value in the range if wanted.
- Worktree left untouched. No code was edited. Screenshots of both boards are in /tmp/lt127-synth-light.png, /tmp/lt127-synth-dark.png, /tmp/lt127-synth-hover.png, /tmp/lt127-real-light.png, /tmp/lt127-real-dark.png and /tmp/lt127-real-hover.png.
- Merge (2026-10-13): state was already merging at start. Step 1: base branch main (root checkout); git merge main in the worktree reported Already up to date, main was already an ancestor of 12ebabd, so no conflicts and no test run (clean-merge rule). Step 2: base branch still main; git merge --no-edit fix/127-the-blockedby-relation in the project root fast-forwarded main 40a5996 to 12ebabd, touching only src/webui.ts and src/webui.test.ts (66 insertions, 13 deletions). No conflicts, nothing to fix, worktrees clean. State set to done.