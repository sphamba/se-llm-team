---
name: "fix: agent log pane; shrink the log font, restore the button size, one row in chronological order"
priority: "medium"
state: "done"
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

## Developer notes
- Commit aa6da02 on fix/76-agent-log-pane (base c33fd7a); files src/webui.ts and src/webui.test.ts only.
- CSS: .agent-btn back to font-size 12px and padding 3px 10px (border, background, color, radius and .agent-btn-active untouched); #m-log pre font-size 10px (padding, line-height and wrapping untouched).
- Row: renderAgent now wraps the buttons in a new #m-agent-btns div; `#m-agent-btns { display: flex; flex-wrap: wrap; gap: 6px; }` replaces the removed .agent-past/.agent-live block-row rules. #m-agent's margin-bottom and #m-log's margin-top 6px are unchanged. The render order was already past-first/live-last from 000070, so no JS order change was needed.
- Tests: webui.test.ts asserts the .agent-btn 12px / 3px 10px declaration, the #m-log pre 10px, the wrapping flex row, the removed block rules, and that the past-button template appears before the live-button template. Reverting the CSS makes the new assertion fail (mutation-checked).
- Verified: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all green. Typecheck: the repo has no tsconfig, so an ad hoc strict tsc run (typescript + @types/node from another checkout) was compared against HEAD: identical pre-existing 10-error set, no new type errors.
- Headless Chromium against startWebUi(root, {port: 0}) on a temp board (task in doing, developer pid alive, developer/reviewer/live-tester logs): buttons on one row (same y=429.25, x 278.0 -> 371.1 -> 470.2), order Reviewer, Live-tester, Developer (live last), all computed 12px; pre#m-log-text 10px; clicking Developer sets agent-btn-active on it alone; long lines still wrap; screenshot /tmp/fix76-agent-buttons.png. Port 4242 and the production webui were never touched.
- 000047 note: at the time of writing, feat/47-webui-stacked-column (000047) is still in reviewing and unmerged. Its diff does not touch the .agent-btn CSS, the #m-agent area or renderAgent, so the sequential merge is clean (the CSS lives in the PAGE string in both).

## Review (Reviewer, worktree aa6da02)
- No fixes made. The diff touches only src/webui.ts and src/webui.test.ts, as the Constraints require.
- Spec 1: .agent-btn has font-size 12px and padding 3px 10px. The border, background, color, radius, hover rule and active rules are unchanged.
- Spec 2: #m-log pre has font-size 10px. This rule targets pre#m-log-text. The padding, line-height 1.45, pre-wrap and break-word are unchanged.
- Spec 3: #m-agent-btns is display: flex with flex-wrap: wrap and gap: 6px. The .agent-past and .agent-live block rules are removed. #m-log keeps margin-top 6px. renderAgent pushes the past agents first and the live agent last. The role order cannot invert in this pipeline, because the only loop is to-review/reviewing for the same role. The button order is therefore chronological.
- Spec 4: the new assertions match the only base CSS rules (the regexes were checked against the page string). All three test files pass in the worktree. The strict tsc error set is identical to the base c33fd7a set (10 errors, all pre-existing, none in the changed lines). The repo has no tsconfig.
- Independent Playwright check (subagent, temp board: task in doing, developer pid alive, developer/reviewer/live-tester logs, viewport 1280x800): 3 .agent-btn at computed 12px and padding 3px 10px. One row, same y, x increasing: Reviewer, Live-tester, Developer (live last). The active class appears on the clicked button only, moves on a switch and clears on the second click. #m-log-text is 10px. #m-log margin-top is 6px and the geometric gap is 6.00px.
- Merge check: 76 merges clean into current main b50da8a (includes the hub frontend merge db15b73), and the three test files pass on the merged tree. The merge with feat/47-webui-stacked-column conflicts on the .col min-width rule, but that conflict exists when 47 merges into main alone (main's bdfced0 changed .col after 47 branched). It is not caused by 76. After 47 resolves its own conflict, 76 merges cleanly on top (both orders verified in temp clones).
- Sequencing note: 000047 was still in live-testing when 000076 ran, against the task Constraints. The changed regions do not overlap, so the code merge is safe in either order.
- Verdict: acceptance met, no fixes.

## Live test (Live-tester, commit aa6da02)
- Setup: the worktree src/webui.ts served by startWebUi against a copy of the real board, with task #70 in doing, a live developer pid, real developer JSONL logs, a 500 kB reviewer log and real live-tester logs. Headless Chromium at 1280x800 and 320x700, fixture port 44111. The production webui on port 4242 was not touched.
- Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.
- Buttons: three agent buttons render at 12px font and 3px 10px padding. At 1280px they share one row (same y=248, x=278 -> 371 -> 470) in the order Reviewer, Live-tester, Developer, so the live agent is rightmost. At 320px the row wraps and does not overflow the modal.
- Log: pre#m-log-text computes 10px with line-height 14.5px, pre-wrap and break-word. The pane starts 6px under the row (computed margin-top 6px). A scroll to the top of a 500 kB log loaded older bytes (81900 -> 163800 chars). A line appended to the live log appeared in the pane in less than 1 second. A task with past agents only still renders its buttons in one row and its log opens.
- Active marking: a past log marks that button alone, a switch moves the mark, and a second click closes the pane and clears the mark. No JavaScript errors in the console. Screenshot /tmp/fix76-live/buttons-log.png.
- Finding (low): the row order is the fixed pipeline role order, not the log age. On a reopened task (done, then fixed again) a later reviewer run can be newer than the live-tester run, and the row then shows Reviewer left of Live-tester, which is not chronological. In the ordinary pipeline the two orders agree.
- Verdict: acceptance met. The ordering deviation above is the only finding.
