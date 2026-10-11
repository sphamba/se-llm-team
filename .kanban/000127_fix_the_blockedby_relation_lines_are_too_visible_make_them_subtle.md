---
name: "fix: the blockedBy relation lines are too visible; make them subtle"
priority: "medium"
state: "backlog"
worktree: ""
complexity: simple
blockedBy: "#118, #126"
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

# Complexity

simple (user-ordered 2026-10-12). Files: src/webui.ts and src/webui.test.ts only.

# Fix

#relations path (src/webui.ts ~:746) draws stroke: var(--muted) at full opacity, stroke-width 1.5. Add transparency so the lines read as subtle hints behind the semi-transparent cards, not a dominant overlay:

- Add stroke-opacity around 0.3 (0.25-0.35, pick what reads subtle in both themes), or use a color-mix with transparent - one approach, no new variables.
- Keep the dash animation (dashflow), stroke-dasharray, pointer-events: none, the z-index layering from #124 (lines above column containers, below cards, modal on top), and the prefers-reduced-motion static-dash rule intact.
- src/webui.test.ts: assert the path rule carries the reduced opacity (e.g. stroke-opacity set and below 1).

# Complexity

simple (user-ordered 2026-10-12). Files: src/webui.ts and src/webui.test.ts only.

# Notes
