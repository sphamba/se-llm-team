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
- Gap: a task created by kanban_create lands at the top of the backlog column. All existing backlog cards shift down and the new card appears; nothing animates today.

Changes (src/webui.ts only):
1. Extend the FLIP pass: before the DOM update, record the rect of every card element (or at least all cards in the columns that gain or lose a card), keyed by the stable task number. After the update, apply inverted transforms to every card whose position changed, not only the card whose state changed.
2. New-card enter case (required): when a card has no previous rect (a task newly created and rendered at the top of the backlog), animate its appearance (fade/slide-in with the same duration and easing as the moved-card animation) and FLIP the existing siblings below it down, so the whole column animates instead of jumping. The FLIP pass must key on task number and handle the absent-previous-rect branch explicitly.
3. Animate the column container: when a column grows or shrinks (a card enters or leaves), animate its height change smoothly. Measure the container height before and after the update and transition between them (or apply the same FLIP pass to the container), with the same duration and easing as the card animation.
4. Card background: give cards an opaque background color matching the column's palette (the elevated surface color per theme) in light and dark modes, so the page background is not visible through a card during animations. Keep the priority chip colors readable.
5. Use the same duration and easing as the moved-card animation from 000028.
6. Keep the unchanged-refresh guard: a 5s refresh that renders identical positions animates nothing (a brand-new card seen by a refresh after its create is a real change, not an unchanged refresh; it still animates per point 2).
7. Respect the reduced-motion setting if 000028 added one.

Acceptance:
- Removing a card from a column slides the cards below upward and the column shrinks smoothly; adding a card slides them downward and the column grows smoothly.
- A new task appearing at the top of the backlog (kanban create) slides the existing backlog cards down smoothly and the new card enters with an animated appearance; no hard jump anywhere in the column.
- The moved card keeps its lateral animation from 000028.
- Cards are opaque (no page background visible through them) in both themes.
- Unchanged refreshes do not animate; the new-card enter animation still fires when a create is picked up.
- Existing tests pass; extend webui.test.ts with an assert-based check for the FLIP diff (which cards get transforms, including the new-card branch) per repo convention.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000039 (hub frontend), 000044 (spinner across refresh), and 000045 (scrollbar to viewport bottom), all in src/webui.ts.

# Notes
