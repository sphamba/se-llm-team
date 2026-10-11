---
name: "feat: webui agent log pane; mark the shown agent, smaller buttons, 5x chunk size"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
In the task detail pane's agent log area, mark the button of the currently shown agent log, render the agent buttons at a smaller font size, add a small gap between the buttons and the log div, and raise the log chunk size from 16 KB to about 80 KB for the initial load and scroll-up loads.

# Specs
Webui task detail pane, agent log area (user feedback, facts verified in the current root checkout).

Facts:
- Agent buttons are rendered by client JS renderAgent(t) (src/webui.ts:496-510) into div#m-agent (line 380). Live agent button (line 501): class "agent-btn" with a .spin span; past agents (line 502): class "agent-btn agent-past" with a .check check-mark span. Buttons call openAgentLog('<role>').
- Current button order: the live agent button renders first (leftmost), then past agents in t.agents order. The newest (live) agent is leftmost, so the row is not in chronological order.
- No active/selected marking exists: openAgentLog/openLog (lines 511-523) only toggle hidden on the log pane; buttons never get an active class or style. The displayed log is tracked in logState.handle.
- Button CSS (lines 337-339): .agent-btn { display:inline-flex; align-items:center; border:1px solid var(--border); background:var(--panel); color:var(--link); border-radius:6px; padding:3px 10px; cursor:pointer; font-size:12px; }, .agent-btn:hover { background:var(--hover); }, .agent-past { display:flex; width:fit-content; margin-top:6px; }.
- The log div #m-log (created at line 504 inside #m-agent; CSS lines 343-345) has no margin between the button row and itself; only #m-agent { margin-bottom:12px } (line 341) separates the whole block.
- Chunk size: const LOG_CHUNK = 16384 (line 8). Initial load: openLog -> pullLog("?file="+handle, "init") (515-521). Scroll-up: #m-log pre.onscroll (506-508) and the pollLog history retry (542-543) request &offset=<head>&before=1. Server handler GET /api/agent-log (lines 234-270) uses LOG_CHUNK for both directions and returns { text, head, tail, atStart }.
- Tests: src/webui.test.ts asserts hard 16384 at lines 126-127 and 140, covers tail/offset/before=1 paging (124-150) and renderLogChunk chunk-head split (170-186). No test covers the agent buttons.

Changes:
1. Mark the shown agent: while a log pane is open for an agent, that agent's button gets a visible active class (for example "agent-btn-active"); the class moves when another agent is opened, and no button is marked when no log is open. openAgentLog/openLog set it; renderAgent re-applies it on re-render by comparing the button's role with the currently displayed logState role. Add matching CSS that is clearly distinguishable in both light and dark themes.
2. Chronological button order: render the agent buttons left to right in chronological order, oldest agent leftmost and the newest (live) agent rightmost. Order the past agents by their history order (t.agents / agentHistory order, oldest run first) and render the live agent button last, after the past agents.
3. Smaller button font: .agent-btn font-size 12px -> 10px; the developer may rebalance padding (for example 2px 8px) to keep the buttons readable.
4. Gap between buttons and log: add a small margin (about 6-8px) between the agent button row and the top of #m-log (margin-top on #m-log or equivalent), so the buttons do not touch the log border.
5. 5x chunk size: LOG_CHUNK 16384 -> 81920 (about 5x), used by both the initial load and the scroll-up history load through the same server constant. Paging behavior stays identical (before=1, offset, atStart, partial-line drop, scroll position preservation).
6. Tests: update the hard 16384 assertions in src/webui.test.ts to 81920 (or derive them from an exported constant); keep the full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- With two or more past agents on one task, clicking a button opens that agent's log and that button is visibly marked as the one currently shown; switching agents moves the mark; with no log open, no button is marked.
- Agent buttons read left to right from oldest to newest, with the live agent rightmost.
- Agent buttons render at the smaller font size; there is a visible gap between the button row and the top of the log div.
- Initial load and each scroll-up load fetch about 80 KB per request (5x the old 16 KB); paging still preserves scroll position and reports atStart at the beginning of the file.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind 000067 (doing): its worktree is actively rewriting src/webui.ts (renderLogChunk and the /api/agent-log handler) and src/webui.test.ts. Promote only after 000067 is done and merged, and rebase line numbers on the merged code.
- Note: branch fix/webui-task-detail-card-shows-the-name-twice (task 000058, backlog) carries a committed one-line deletion to src/webui.ts; expect a minor sequential merge when 000058 runs later.

# Notes
- Implemented on feat/webui-agent-log-pane-mark-the-shown-agent-smaller-buttons-5x-chunk-size (commit 96bf334), after 000067 was done, so the hold is cleared. Files: src/webui.ts, src/webui.test.ts only.
- Mark the shown agent: new markActiveAgent() toggles "agent-btn-active" on the button whose data-role matches the open logState role; openLog sets it, closeLog clears it, renderAgent re-applies it on re-render. CSS: orange border (.agent-btn-active) + orange tint (.agent-btn.agent-btn-active, var(--medium-bg)); verified visible in Ayu Light and Ayu Dark by Playwright screenshots.
- Chronological order: renderAgent now pushes past agents first (t.agents order) and the live agent button last, so the row reads oldest to newest, live rightmost.
- Buttons smaller: .agent-btn font-size 12px -> 10px, padding 3px 10px -> 2px 8px; new .agent-live keeps the 6px top margin that .agent-past carried.
- Gap: #m-log got margin-top: 6px.
- Chunk size: LOG_CHUNK 16384 -> 81920, now exported; webui.test.ts imports it for the tail/head assertions. Fixtures resized because the old ones sat below the new chunk: logText 626 -> 2600 lines (166400 bytes, 2+ history pages), bigRecord and pad z-runs 20000/40000 -> 100000 so the split-record and walk-back paths stay exercised.
- Checks: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass; tsc --noEmit clean for src/webui.ts + src/webui.test.ts. Playwright browser check (subagent): button order [reviewer, developer], active mark moves and clears, font-size 10px, #m-log margin-top 6px, 128000-byte log serves text of 81920 with head 46080, history page reaches head 0 with atStart true. Screenshots: /tmp/webui-check-light.png, /tmp/webui-check-dark.png.
- Expect a minor sequential merge with 000058 (one-line deletion in src/webui.ts) when it runs later, per the task Constraints.
- Review (Reviewer, worktree 96bf334): no fixes needed. Diff touches only src/webui.ts and src/webui.test.ts per the Constraints. markActiveAgent() correctly guards on pane visibility, compares b.dataset.role with logState.role (both esc-safe; esc() escapes double quotes), and re-applies the mark after renderAgent rebuilds #m-agent; openLog calls it after unhiding, closeLog after clearing logState, so no stale mark on re-open or toggle-close. Chronological order verified: past agents (t.agents order) then live last. No 16384 remains anywhere; LOG_CHUNK 81920 is used by all three server paths (tail, init, walk-back). Fixtures resized correctly: 2600x64-byte lines = 166400 bytes exercise 2 history pages; bigRecord and pad z-runs 100000 > 81920 keep the split-record and walk-back paths live. Checks re-run in the worktree: kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass; tsc --noEmit (module/target es2023, nodenext) clean; strict-mode-only complaints are pre-existing in untouched code. Live Playwright check (subagent, light theme): button order past-past-live left to right, active class sets/moves/clears, font-size 10px, padding 2px 8px, #m-log margin-top 6px, active border rgb(242,151,24) + tint rgba(235,164,0,.15) vs inactive differ, 134890-byte log serves an exactly-81920-byte window with the documented partial-head-line drop. Hold behind 000067 correctly cleared: 000067 is done, worktree empty, and its commit 498c0d1 is in this branch; main's later 000042 short-name commits touch no webui files, so the merge stays clean.
- Live test (Live-tester): PASS, state set to done. Served the worktree's webui standalone (startWebUi, port 4620) against the real board because the pipeline daemon runs the main checkout's unmerged code. 24/24 Playwright checks passed on tasks 000042 (3 past logs), 000038 (live reviewer, 15 MB log) and 000070 (own live log): 3 chronological buttons with no mark until opened; click sets the active mark, switching moves it, toggle-close and modal close/re-open clear it; active border rgb(242,151,24) + tint rgba(235,164,0,.15) in light and rgb(230,180,80) + rgba(255,180,84,.15) in dark, distinct from idle in both; font-size 10px, padding 2px 8px; #m-log margin-top 6px with a measured 6.0px gap. Backend: a 15 MB live log serves an exactly-81920-byte window on init (head 15212512, tail 15294432) and on before=1 history loads; a 1295-byte log serves whole with atStart true; scroll-up loads history content (len 682 -> 1866) and preserves scrollTop 139. Checks re-run in the worktree: kanban.test.ts and webui.test.ts pass, orchestrator.test.ts passes on re-run (one flaky 'timeout waiting for create mirror commit' on the first run, unrelated to this change, pushed to a fake origin), tsc --noEmit (nodenext, es2023, allowImportingTsExtensions, paseo's @types/node) clean. Screenshots: /tmp/live-test-light.png, /tmp/live-test-dark.png, /tmp/live-test-self.png, /tmp/live-test-history.png.
- Minor finding reported to the PM: the chronological order holds in DOM/reading order (past agents first, live last), but the buttons never sit side by side because .agent-past keeps display:flex (block-level), so they stack vertically top-to-bottom and the live button lands below the past ones, not visually rightmost. Pre-existing stacking; the acceptance's 'left to right, live agent rightmost' is only met in reading order. One-line CSS change (.agent-past display:inline-flex) if a horizontal row is wanted.
