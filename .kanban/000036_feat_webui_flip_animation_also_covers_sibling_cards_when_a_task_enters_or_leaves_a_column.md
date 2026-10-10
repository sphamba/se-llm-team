---
name: "feat: webui FLIP animation also covers sibling cards when a task enters or leaves a column"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
Extend the 000028 FLIP animation: when a card enters or leaves a column, animate the sibling cards that shift vertically too, instead of letting them jump.

# Specs
Animate sibling cards, column height, and opaque card backgrounds on column change (follow-up to 000028).

Facts:
- 000028 (merged) implements FLIP in src/webui.ts: it records positions before a state change and animates the moved card to its new column; unchanged refreshes do not re-animate.
- Gap: when a card leaves or enters a column, the sibling cards in that column jump vertically, and the column container snaps to its new height. Cards also have a transparent background, so the page background shows through during animations.

Changes (src/webui.ts only):
1. Extend the FLIP pass: before the DOM update, record the rect of every card element (or at least all cards in the columns that gain or lose a card), keyed by the stable task number. After the update, apply inverted transforms to every card whose position changed, not only the card whose state changed.
2. Animate the column container: when a column grows or shrinks (a card enters or leaves), animate its height change smoothly. Measure the container height before and after the update and transition between them (or apply the same FLIP pass to the container), with the same duration and easing as the card animation.
3. Card background: give cards an opaque background color matching the column's palette (the elevated surface color per theme) in light and dark (One Dark) modes, so the page background is not visible through a card during animations. Keep the priority chip colors readable.
4. Use the same duration and easing as the moved-card animation from 000028.
5. Keep the unchanged-refresh guard: a 5s refresh that renders identical positions animates nothing.
6. Respect the reduced-motion setting if 000028 added one.

Acceptance:
- Removing a card from a column slides the cards below upward and the column shrinks smoothly; adding a card slides them downward and the column grows smoothly.
- The moved card keeps its lateral animation from 000028.
- Cards are opaque (no page background visible through them) in both themes.
- Unchanged refreshes do not animate.
- Existing tests pass; extend webui.test.ts with an assert-based check for the FLIP diff (which cards get transforms) per repo convention.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000030 (cap/unfold) → 000033 (agent view) → 000039 (hub frontend), all in src/webui.ts.

# Notes
