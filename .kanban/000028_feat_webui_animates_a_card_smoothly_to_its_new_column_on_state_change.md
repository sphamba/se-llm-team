---
name: "feat: webui animates a card smoothly to its new column on state change"
priority: "low"
state: "backlog"
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
