---
name: "feat: webui agent log pane; mark the shown agent, smaller buttons, 5x chunk size"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
In the task detail pane's agent log area, mark the button of the currently shown agent log, render the agent buttons at a smaller font size, add a small gap between the buttons and the log div, and raise the log chunk size from 16 KB to about 80 KB for the initial load and scroll-up loads.

# Specs
Webui task detail pane, agent log area (user feedback, facts verified in the current root checkout).

Facts:
- Agent buttons are rendered by client JS renderAgent(t) (src/webui.ts:496-510) into div#m-agent (line 380). Live agent button (line 501): class "agent-btn" with a .spin span; past agents (line 502): class "agent-btn agent-past" with a .check check-mark span. Buttons call openAgentLog('<role>').
- No active/selected marking exists: openAgentLog/openLog (lines 511-523) only toggle hidden on the log pane; buttons never get an active class or style. The displayed log is tracked in logState.handle.
- Button CSS (lines 337-339): .agent-btn { display:inline-flex; align-items:center; border:1px solid var(--border); background:var(--panel); color:var(--link); border-radius:6px; padding:3px 10px; cursor:pointer; font-size:12px; }, .agent-btn:hover { background:var(--hover); }, .agent-past { display:flex; width:fit-content; margin-top:6px; }.
- The log div #m-log (created at line 504 inside #m-agent; CSS lines 343-345) has no margin between the button row and itself; only #m-agent { margin-bottom:12px } (line 341) separates the whole block.
- Chunk size: const LOG_CHUNK = 16384 (line 8). Initial load: openLog -> pullLog("?file="+handle, "init") (515-521). Scroll-up: #m-log pre.onscroll (506-508) and the pollLog history retry (542-543) request &offset=<head>&before=1. Server handler GET /api/agent-log (lines 234-270) uses LOG_CHUNK for both directions and returns { text, head, tail, atStart }.
- Tests: src/webui.test.ts asserts hard 16384 at lines 126-127 and 140, covers tail/offset/before=1 paging (124-150) and renderLogChunk chunk-head split (170-186). No test covers the agent buttons.

Changes:
1. Mark the shown agent: while a log pane is open for an agent, that agent's button gets a visible active class (for example "agent-btn-active"); the class moves when another agent is opened, and no button is marked when no log is open. openAgentLog/openLog set it; renderAgent re-applies it on re-render by comparing the button's role with the currently displayed logState role. Add matching CSS that is clearly distinguishable in both light and dark themes.
2. Smaller button font: .agent-btn font-size 12px -> 10px; the developer may rebalance padding (for example 2px 8px) to keep the buttons readable.
3. Gap between buttons and log: add a small margin (about 6-8px) between the agent button row and the top of #m-log (margin-top on #m-log or equivalent), so the buttons do not touch the log border.
4. 5x chunk size: LOG_CHUNK 16384 -> 81920 (about 5x), used by both the initial load and the scroll-up history load through the same server constant. Paging behavior stays identical (before=1, offset, atStart, partial-line drop, scroll position preservation).
5. Tests: update the hard 16384 assertions in src/webui.test.ts to 81920 (or derive them from an exported constant); keep the full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- With two or more past agents on one task, clicking a button opens that agent's log and that button is visibly marked as the one currently shown; switching agents moves the mark; with no log open, no button is marked.
- Agent buttons render at the smaller font size; there is a visible gap between the button row and the top of the log div.
- Initial load and each scroll-up load fetch about 80 KB per request (5x the old 16 KB); paging still preserves scroll position and reports atStart at the beginning of the file.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind 000067 (doing): its worktree is actively rewriting src/webui.ts (renderLogChunk and the /api/agent-log handler) and src/webui.test.ts. Promote only after 000067 is done and merged, and rebase line numbers on the merged code.
- Note: branch fix/webui-task-detail-card-shows-the-name-twice (task 000058, backlog) carries a committed one-line deletion to src/webui.ts; expect a minor sequential merge when 000058 runs later.

# Notes
