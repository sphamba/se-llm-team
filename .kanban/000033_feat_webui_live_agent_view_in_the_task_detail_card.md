---
name: "feat: webui live agent view in the task detail card"
priority: "medium"
state: "doing"
worktree: "feat/webui-live-agent-view-in-the-task-detail-card"
---

# Summary
In the webui task detail card, show a button with a spinner and the agent name when an agent is working on the task. Clicking it shows the agent's text with live updates, smart auto scroll, and on-demand fetch of earlier history when scrolling up.

# Specs
Live agent view in the task detail card (modal).

Facts:
- The orchestrator writes agent logs to .kanban/.logs/{task-slug}.{role}.log and pid files to .kanban/.pids/{name}.pid (spawnAgent, src/orchestrator.ts). A task in doing has a developer, in reviewing a reviewer, in live-testing a live-tester; the pid file tells whether it is alive.

Changes (src/webui.ts only):
1. /api/tasks payload: add per-task agent info computed from the pid file and state: role (developer/reviewer/live-tester), alive (pid alive), and a safe handle for the log path resolved server-side from the task file (never accept a raw path from the client).
2. New endpoint GET /api/agent-log?file=...&offset=... : returns the agent log content from a byte offset (tail mode), or a chunk before an offset (history mode). Reject unknown files; resolve the log path on the server from the task file name.
3. Task detail card (openTask modal): between the attributes (#m-attrs) and the task body (#m-body), when an agent is alive, render a button with a small spinner (CSS, theme-aware, consistent with 000026) and the agent name.
4. Clicking the button opens a pane with the agent's text:
   - Initial load fetches only the last chunk of the log (tail), not the whole file.
   - Poll for new content about every 1 s and append it, while the pane is open and the agent is alive.
   - Auto scroll to the bottom on new content only when the user is at the bottom; no auto scroll when the user scrolled up to read history.
   - When the user scrolls to the top of the loaded content, fetch the earlier history chunk on demand (history mode) and prepend it, keeping the scroll position stable.
5. Close the pane and stop polling when the modal closes.

Acceptance:
- The button appears only for tasks with a live agent, with spinner and agent name.
- The pane streams new agent text live; auto scroll works at the bottom and pauses when reading history.
- Scrolling up fetches earlier history on demand without breaking scroll position.
- Closing the modal stops polling.
- Existing tests pass; extend webui.test.ts with a check for the new endpoint (assert-based, per repo convention).

Constraints:
- Only src/webui.ts changes (frontend + API).
- HOLD: queue behind 000028 (animation) → 000029 (chip fix) → 000030 (cap/unfold) → 000032 (One Dark), all in src/webui.ts.

# Notes
