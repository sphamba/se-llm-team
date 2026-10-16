---
name: "feat: relation lines always run right out, left in"
priority: "medium"
state: "done"
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
- Collapsed curve() (src/webui/board.ts) to one right-out/left-in branch; relationPaths no longer computes same-columnness and calls curve(from, to). Both doc comments updated.
- Same-row clamp: d = Math.min(d, (x2 - x1) / 2), the signed half-span, so a same-row blocker left of the blocked card gets a negative offset and the collinear cubic stays monotone (the controls land on the midpoint). A magnitude clamp would leave that pair retracing the line.
- tests/webui.test.ts geometry assertions updated: same-column, stacked-pair and blocker-left endpoints now start at from.x + from.w and end at to.x; the same-row 30 px fixture pins the halved offset (c1x = c2x = midpoint, c1x <= x2, c2x >= x1); the 000127 S-scaling fixtures moved to different rows so the span-scaled S still applies.
- Checked: `node tests/webui.test.ts` passes (red first: the new same-column, left-edge assertion failed against the old branch).
- Review: verified against the specs (one right-out/left-in branch, sBend kept with the 480 cap, signed same-row clamp, same and side-pair branches plus same-columnness removed, both doc comments updated, endpoint and within-span assertions per the constraints, no page.ts or CSS change, hover wiring and skip rules unchanged). Scoped suite re-run: `node tests/webui.test.ts` exit 0.
- Closed the same-row clamp question: the spec's purpose clause (never overshoot the entry point, double back, or self-overlap) and the Summary's "keeps the S monotone" rule out the magnitude reading, which would retrace the line; the signed clamp is the spec-consistent reading.

## Live test (#236)
Interface: hub-only fixture served from the merged worktree by startHub on 127.0.0.1:4371; Playwright/Chromium over the live page and /api/tasks. Fixture: blocked card `000301_FIXTURE_blocked.md` (to-do, blockedBy "#401, #402, #403, #999") with blockers in `doing` (same stacked-pair x), `backlog` (one column left, same row) and `to-review` (one column right, same row), plus a done blocker and the dangling #999.

Result: 48 checks, 0 failed.
- Only 3 paths render: the done blocker and the dangling ref draw nothing.
- Every path starts at the blocked card's right edge midpoint and ends at the blocker's left edge midpoint, for all three column pairs.
- Controls match the served formula sBend (40 floor, 0.35 * span, 480 cap) with the signed same-row clamp: left same-row blocker d = -362.80 (both controls at the midpoint), right same-row 32 px gap d = 16 (both controls at the midpoint).
- Same-row lines are one clean hop: x'(t) keeps a single sign over 201 samples and x(t) stays inside the endpoints. The cross-row same-column S wrap keeps its intended shape.
- Dash animation: dashflow on all three; stroke-dashoffset decreases (-2 px at 200 ms, -8 px at 800 ms), so dashes travel blocked -> blocker.
- Both themes through the real #theme toggle: light #fcfcfc / dark #10141c, identical path d per theme, theme-colored dashed stroke (rgb(173,174,177) light, rgb(90,102,115) dark; 6/4 dashes).
- Hover wiring unchanged: blocked card lights all 3 paths, the left blocker lights only its own, none before hover. No console or page errors.
- Differential control over the same fixture from parent 89f2c76: old same-column ends at the blocker's RIGHT edge, old left blocker starts at the blocked card's LEFT edge, old right same-row gap doubles back (dx +140/-61); merged all three are right-out/left-in and both same-row lines are monotone.
- Source read (the suite is not run): tests/webui.test.ts:495-561 pins the new endpoints for the same-column, left and right cases, the within-span controls, the halved 30 px bow and the span-scaled S.

Assumptions:
- "One column left/right in the same row" is the blocked card in to-do with blockers in backlog (left) and to-review (right); "same column" is the stacked pair's shared x (doing).
- The page draws the paths during the 200 ms card entrance transform, so endpoints sit ~1.5 px off until the next 5 s board poll redraws them. This draw order predates the change; the check samples after the poll.
- The unrendered-ref skip (folded or absent card) was source-read in the shipped test, not live-checked.

No open user/client questions.
