---
name: "fix: webui modal priority chip is too wide and has bad color; match the card chips"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
In the webui popup details, the priority chip gets min-width 80px and a gray color from the #m-attrs span rule, which overrides the .chip/.p-* styles. Make the modal chip identical to the card preview chips.

# Specs
Fix the modal priority chip styling.

Cause (src/webui.ts, PAGE):
- `#m-attrs span { display: inline-block; min-width: 80px; color: #94a3b8; }` applies to every span in the modal attrs, including the priority chip span (`.chip p-<priority>`).
- The ID selector outranks the class selectors, so the chip renders 80px wide with color #94a3b8 instead of its `.p-*` palette (for example .p-medium: background #dbeafe, color #1d4ed8).

Fix:
- Scope the label style (min-width 80px, gray color) to the label spans only, for example `#m-attrs span:not(.chip)` or a dedicated class on the labels in openTask().
- The chip then keeps its `.chip` sizing (padding 1px 7px, no min-width) and its `.p-*` colors, identical to the card previews.
- Keep the label column look unchanged.

Acceptance:
- The modal priority chip matches the card chip: width fits the text, same background and text color.
- Label rows keep their aligned column.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000025 (batch) → 000026 (spinner) → 000028 (animation), all in src/webui.ts.

# Notes
