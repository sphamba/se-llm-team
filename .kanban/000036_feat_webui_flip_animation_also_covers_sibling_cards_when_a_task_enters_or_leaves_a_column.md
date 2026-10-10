---
name: "feat: webui FLIP animation also covers sibling cards when a task enters or leaves a column"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
Extend the 000028 FLIP animation: when a card enters or leaves a column, animate the sibling cards that shift vertically too, instead of letting them jump.

# Specs
Animate sibling cards on column change (follow-up to 000028).

Facts:
- 000028 (merged) implements FLIP in src/webui.ts: it records positions before a state change and animates the moved card to its new column; unchanged refreshes do not re-animate.
- Gap: when a card leaves or enters a column, the sibling cards in that column jump vertically (they are re-rendered at new positions with no transform).

Changes (src/webui.ts only):
- Extend the FLIP pass: before the DOM update, record the rect of every card element (or at least all cards in the columns that gain or lose a card), keyed by the stable task number. After the update, apply inverted transforms to every card whose position changed, not only the card whose state changed.
- Use the same duration and easing as the moved-card animation from 000028.
- Keep the unchanged-refresh guard: a 5s refresh that renders identical positions animates nothing.
- Respect the reduced-motion setting if 000028 added one.

Acceptance:
- Removing a card from a column slides the cards below upward; adding a card slides them downward.
- The moved card keeps its lateral animation from 000028.
- Unchanged refreshes do not animate.
- Existing tests pass; extend webui.test.ts with an assert-based check for the FLIP diff (which cards get transforms) per repo convention.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000029 (chip fix) → 000030 (cap/unfold) → 000032 (One Dark) → 000033 (agent view), all in src/webui.ts.

# Notes
