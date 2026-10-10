---
name: "feat: webui animates a card smoothly to its new column on state change"
priority: "low"
state: "done"
worktree: ""
---

# Summary
In the webui, when a task changes state between refreshes, animate the card smoothly from its old column to its new column instead of re-rendering from scratch.

# Specs
Smooth state-change animation in the board.

Changes (src/webui.ts):
- render() currently replaces board.innerHTML on every 5 s refresh, so a state change jumps the card to the new column with no transition.
- When new data arrives, compare the previous task states by file. For a task whose state changed, animate the card from the old column to the new column: use the FLIP technique (measure the old position, move the DOM node, invert the transform, play it), or the smallest equivalent with CSS transitions.
- A refresh with no state changes must not re-animate anything.
- No new dependencies, no assets.

Acceptance:
- A task that moves state glides into its new column.
- Unchanged tasks stay still across refreshes.
- Existing tests pass.

Constraints:
- Only src/webui.ts changes.
- HOLD until 000026 merges: it rewrites render() (spinner) in the same file; this applies on top. Queue: 000025 → 000026 → this.

# Notes
- Implemented FLIP in render() (src/webui.ts only, on top of the merged 000026 spinner rewrite): capture every card rect before the innerHTML replace, compare states by file, then for cards whose state changed set translate(dx,dy) with transition none, force reflow, and play transform back to none over .4s ease. Unchanged, new, and removed cards never animate, so a refresh with no state changes re-animates nothing. Leftover inline styles are cleared before measuring and on transitionend; prefers-reduced-motion disables the glide. No new dependencies or assets. Checks: extracted the PAGE script and node --check passed; node src/kanban.test.ts, src/webui.test.ts, src/orchestrator.test.ts all pass. Commit da7a51c.
- Review (no fixes needed): diff vs main touches only src/webui.ts (+26/-1), no dependency changes, HOLD satisfied (000026 merge is in main). All three test files pass. Ran a 13-branch mock-DOM simulation of the extracted render(): first render animates nothing, no-change refresh animates nothing, a state change animates only the moved card with the correct invert offset (translate(-210px,0px) for backlog to doing), transitionend clears the inline transition, new/removed/zero-delta cards never animate, prefers-reduced-motion skips the glide, and the click handler is re-attached. Verify the live glide in a browser (move a task with kanban_update and watch the 5 s refresh) before setting done.
- Live test PASSED, no issues. Ran the orchestrator daemon from the worktree against a throwaway board (project .kanban/se-llm-team.json override, webui on 127.0.0.1:4311) and drove the page in headless Chromium: board renders 8 columns and 3 cards. Flipped a card backlog -> doing on disk and watched the 5 s refresh: transitionstart(transform) fired at the FLIP invert (m41=-432.2px, the 2-column distance backlog -> doing; glide starts at the card's exact old row and rises into doing), transitionend 395 ms later at m41=0, matching the .4s ease; a mid-glide frame sampled at -345.7px; screenshots (/tmp/sellt-shots/1-before.png, 2-mid-glide.png, 3-after.png) show the card in flight between the columns and landed at the top of doing with the working spinner. Unchanged cards kept identical rects across the refresh and fired zero transitions; a no-change refresh fired zero transitions and left no inline styles; the initial render animates nothing; with prefers-reduced-motion the glide is skipped and the card still lands in the new column. Inline styles are cleared on transitionend. node src/kanban.test.ts, src/webui.test.ts, src/orchestrator.test.ts all pass.
