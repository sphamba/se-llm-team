---
name: "fix: webui polling resets the animated card spinners every refresh"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
The 5s board refresh rebuilds the DOM, which restarts the CSS spinner animation on cards being worked on. Preserve the spinner animation across refreshes.

# Specs
Stop the 5s polling from resetting the task spinners.

Facts: the webui refresh() (src/webui.ts, setInterval(refresh, 5000)) rebuilds the board DOM every 5s. The spinner on cards being worked on (000026, CSS keyframe animation on the doing card) restarts from frame 0 on every rebuild, so the spinner visibly jumps.

Changes (src/webui.ts):
- Preserve the spinner animation across refreshes. Preferred: reuse the existing card element for an unchanged task (keyed by task file) instead of rebuilding it, so the running animation continues.
- Alternative: keep the rebuild but set a negative animation-delay on the new spinner element equal to the time since the task's last state change, so the animation continues where it was.
- Keep the FLIP animation (000028), the cap/unfold (000030), the theme (000041), and the opaque backgrounds (000036) working.
- Do not change the 5s polling interval.

Acceptance:
- A card in doing keeps its spinner running smoothly across two or more refresh cycles (no visible reset).
- State changes still animate correctly (FLIP) and the card content still updates.

Constraints:
- Only src/webui.ts changes.
- HOLD: queue behind 000041 (Ayu, doing) → 000039 (hub frontend, high) → 000033 (agent view) → 000036 (sibling FLIP), all in src/webui.ts.

# Notes
