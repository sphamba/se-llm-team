---
name: "fix: agent log pane; shrink the log font, restore the button size, one row in chronological order"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Correction of the shipped 000070: the smaller font applies to the agent log text (12px to 10px), the agent buttons go back to their original 12px font with 3px 10px padding, and the buttons render side by side in one row, oldest leftmost and the live agent rightmost.

# Specs
Correction of the shipped task 000070 behavior (user feedback): the smaller font size was meant for the agent LOGS, not the agent selector buttons, and the agent buttons must sit side by side (one horizontal row) in chronological order.

Facts:
- 000070 shipped: .agent-btn font-size reduced to 10px, active-state marking (agent-btn-active class), a margin between the button row and the top of #m-log, LOG_CHUNK raised to 81920. The log text (pre#m-log-text) kept its original 12px.
- Pre-000070 original button CSS: .agent-btn { display:inline-flex; align-items:center; border:1px solid var(--border); background:var(--panel); color:var(--link); border-radius:6px; padding:3px 10px; cursor:pointer; font-size:12px; }.
- Current button layout: the live agent button renders first (inline-flex), then each past agent button is its own flex row (.agent-past { display:flex; width:fit-content; margin-top:6px; }) - so past agents stack top to bottom instead of one row.

Changes:
1. Restore the agent buttons to their original size: .agent-btn back to font-size 12px and padding 3px 10px (the pre-000070 values), keeping the border, background, color, and border-radius as they are now. The active-state marking (agent-btn-active) stays.
2. Apply the smaller font size to the agent LOG text instead: pre#m-log-text font-size 12px -> 10px (keep line-height and wrapping as they are).
3. Put the agent buttons side by side in one horizontal row (a flex row, wrap when they do not fit), ordered left to right in chronological order: oldest run leftmost, the newest (live) agent rightmost. Keep the active-class marking, the gap between buttons, and the existing margin between the button row and the top of #m-log.
4. Tests: extend src/webui.test.ts - .agent-btn carries font-size 12px and padding 3px 10px; pre#m-log-text carries font-size 10px; the button container renders one row in chronological order (oldest first, live last). Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- Agent buttons render at the original 12px font with 3px 10px padding, in one horizontal row, oldest leftmost and live agent rightmost.
- The agent log text renders at 10px.
- Active marking and the button/log margin still work.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind 000038 (live-testing): its branch rewrites src/webui.ts (about 110 lines). Promote only after 000038 is done and merged, and rebase line numbers on the merged code.
- Sequence on the webui lane: promote after 000047 (high, same files) is done; the two tasks cannot run in parallel.

# Notes
