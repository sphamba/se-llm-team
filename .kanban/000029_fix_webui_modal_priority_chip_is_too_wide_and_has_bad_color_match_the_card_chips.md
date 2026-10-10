---
name: "fix: webui modal priority chip is too wide and has bad color; match the card chips"
priority: "low"
state: "done"
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

- HOLD cleared: 000025, 000026, 000028 all done before starting.
- Fix in src/webui.ts (PAGE css): scoped the label rule to `#m-attrs span:not(.chip)` (was `#m-attrs span`), so min-width 80px and var(--faint) no longer hit the priority chip. The chip keeps `.chip` sizing (padding 1px 7px, no min-width) and its `.p-*` colors, identical to the card preview chips; plain label spans keep the aligned 80px column.
- Verified: started the web ui against a temp board and checked the served page contains the scoped rule and no unscoped `#m-attrs span` rule. All three test files (kanban, orchestrator, webui) pass.
- Commit: 06a29c3 on fix/webui-modal-priority-chip-is-too-wide-and-has-bad-color-match-the-card-chips.
- Review (pass): diff main...HEAD is the single one-line css change in src/webui.ts, matching the spec exactly. Verified openTask() renders only the priority chip span with the `chip` class inside #m-attrs, so `:not(.chip)` exempts the chip while every label span keeps min-width 80px and var(--faint). Modal chip markup `chip p-<priority>` is identical to the card chips (line 213 vs 240), so sizing and .p-* palette now match; all css vars exist in light and dark themes. All three test files pass (kanban, orchestrator, webui). No fixes made; state set to to-live-test.
- Live test PASSED, no issues. Ran the webui server from the worktree (startWebUi on 127.0.0.1:4311, throwaway board with one task per priority low/medium/high/critical) and drove the page in headless Chromium. Modal chip computed styles are identical to the card chip for all four priorities: min-width 0px (was 80px), padding 1px 7px, radius 999px, font-size 10px, and per-priority palette (medium: bg rgb(219,234,254) #dbeafe, color rgb(29,78,216) #1d4ed8; critical: bg rgb(254,226,226), color rgb(185,28,28)); width fits the text (31.1-55.1px). Label rows keep the aligned column: every label span keeps min-width 80px, color rgb(148,163,184) var(--faint), right edge 358.0px in all six rows. Dark theme: modal chip and card chip both bg rgb(30,58,138), color rgb(191,219,254); labels keep 80px and dark --faint. Screenshots: /tmp/sellt-000029/1-board.png, 2-modal-medium.png, 3-modal-critical.png, 4-modal-dark-medium.png. Production webui on 4242 untouched; test processes cleaned up.
