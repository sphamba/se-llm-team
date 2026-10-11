---
name: "fix: agent log pane; shrink the log font, restore the button size, one row in chronological order"
priority: "medium"
state: "reviewing"
worktree: "fix/76-agent-log-pane"
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

## Developer notes
- Commit aa6da02 on fix/76-agent-log-pane (base c33fd7a); files src/webui.ts and src/webui.test.ts only.
- CSS: .agent-btn back to font-size 12px and padding 3px 10px (border, background, color, radius and .agent-btn-active untouched); #m-log pre font-size 10px (padding, line-height and wrapping untouched).
- Row: renderAgent now wraps the buttons in a new #m-agent-btns div; `#m-agent-btns { display: flex; flex-wrap: wrap; gap: 6px; }` replaces the removed .agent-past/.agent-live block-row rules. #m-agent's margin-bottom and #m-log's margin-top 6px are unchanged. The render order was already past-first/live-last from 000070, so no JS order change was needed.
- Tests: webui.test.ts asserts the .agent-btn 12px / 3px 10px declaration, the #m-log pre 10px, the wrapping flex row, the removed block rules, and that the past-button template appears before the live-button template. Reverting the CSS makes the new assertion fail (mutation-checked).
- Verified: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all green. Typecheck: the repo has no tsconfig, so an ad hoc strict tsc run (typescript + @types/node from another checkout) was compared against HEAD: identical pre-existing 10-error set, no new type errors.
- Headless Chromium against startWebUi(root, {port: 0}) on a temp board (task in doing, developer pid alive, developer/reviewer/live-tester logs): buttons on one row (same y=429.25, x 278.0 -> 371.1 -> 470.2), order Reviewer, Live-tester, Developer (live last), all computed 12px; pre#m-log-text 10px; clicking Developer sets agent-btn-active on it alone; long lines still wrap; screenshot /tmp/fix76-agent-buttons.png. Port 4242 and the production webui were never touched.
- 000047 note: at the time of writing, feat/47-webui-stacked-column (000047) is still in reviewing and unmerged. Its diff does not touch the .agent-btn CSS, the #m-agent area or renderAgent, so the sequential merge is clean (the CSS lives in the PAGE string in both).
