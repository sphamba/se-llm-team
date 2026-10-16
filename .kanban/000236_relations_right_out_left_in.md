---
name: "feat: relation lines always run right out, left in"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "relations-right-out-left-in"
---

# Summary
Collapse curve() to one branch: the line always exits the blocked card's right edge and enters the blocker's left edge, for every column pair. A same-row clamp keeps the S monotone so no pair geometry produces a self-overlapping shape.

# Specs
# Problem
The blocking relation lines have a same-column special rule: when two cards share a column (same x), the curve loops out of both right sides. Otherwise the line picks the side pair that minimizes it (blocker left: out the blocked card's left edge, in the blocker's right edge). The user wants one uniform geometry that always draws a nice shape.

# Fix
curve() (src/webui/board.ts:216-249) collapses to a single branch, always:
- Come out of the blocked card's right edge: x1 = from.x + from.w, y1 = mid(from), control c1x = x1 + d.
- Get in at the blocker's left edge: x2 = to.x, y2 = mid(to), control c2x = x2 - d.
- Keep the span-scaled S-bend offset d = sBend(x1, x2) (capped at 480) with one clamp for nice shapes: when y1 === y2 (same row), d must stay at most half the span (the 40 px bow floor applies only when the span allows it), so the bezier never overshoots the entry point, doubles back, or self-overlaps. The pre-existing 30 px same-row gap (d 40 over a 30 px span, the cross[1] fixture) is the case this clamp fixes.
Remove the same parameter, the same-column loop branch and the blocker-left side-pair branch; relationPaths (src/webui/board.ts:256+) stops computing same-columnness (the stacked-pair share-one-x rule goes with it) and calls curve without it. Update both doc comments.

# Why the shapes stay nice
The #relations SVG sits behind the cards (board.insertBefore first child, z-index 1 vs the cards' z-index 2), so a wrap crossing the card body region (same column, blocker left) hides behind the card bodies and reads as a wrap-around. The only self-overlap risk is same-row pairs, closed by the clamp.

# Constraints
- tests/webui.test.ts:495-519 pins the geometry: the same-column assertions (:498-499 and the stacked-pair :501-502) and the blocker-left cross assertion (:507) change to the new right-out/left-in endpoints (start at from.x + from.w, end at to.x); the blocker-right fixture (:508) changes shape with the clamp. Add an assertion that same-row pairs keep the offsets within the span (c1x <= x2 and c2x >= x1). Update the assertions, never weaken them.
- curve is interpolated into the served page via relationPaths (src/webui/page.ts:335), so a board.ts fix propagates; no page.ts or CSS change.
- The hover highlight (paths carrying endpoint files, 000127/000144) is unchanged; done blockers, ghost refs and unrendered cards still draw nothing.
- No data or API changes.

# Acceptance
- Live check: a blocked task with a blocker in the same column, one column left, and one column right in the same row: every line exits the blocked card's right edge and enters the blocker's left edge, the dash animation flows blocked -> blocker, and the same-row line is a single clean hop with no doubled-back squiggle, in both themes.
- The tests the developer ships (per the role test policy) pass, including the updated geometry assertions.

# Notes
