---
name: "feat: webui live agent view in the task detail card"
priority: "medium"
state: "done"
worktree: ""
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
- Implemented in worktree feat/webui-live-agent-view-in-the-task-detail-card, commit eb4c12f. Only src/webui.ts and src/webui.test.ts changed, per the constraint.
- Server: /api/tasks now carries agent: { role, alive, log } for working-state tasks (doing -> developer, reviewing -> reviewer, live-testing -> live-tester), computed from the state and .kanban/.pids/{slug}.pid (pidAlive mirrored locally, since webui cannot import orchestrator without a cycle). log is only a handle ({slug}.{role}); GET /api/agent-log rebuilds the real path from the task file name, checks it against taskFiles, and 404s unknown files or non-agent handles. Tail mode (no offset) returns the last 16KB chunk with head/tail/atStart cursors; an offset returns bytes from the offset (poll); before=1 returns the chunk before the offset (history).
- Client: renderAgent puts a button (reused .spin spinner + capitalized role name) plus a hidden #m-log pane between #m-attrs and #m-body only when an agent is alive. Opening the pane fetches the last chunk only, polls every 1s while open and the agent is alive (poll stops when the agent dies, pane stays readable), auto scrolls to the bottom only when the user is at the bottom, and on scroll-to-top fetches the earlier chunk and prepends it with the scroll position kept stable (busy guard against overlapping fetches). closeModal calls closeLog, which clears the interval and state.
- Tests: webui.test.ts extended with the agent payload (null for backlog, deep-equal for a doing task with a live pid, stale pid -> alive false), tail/poll-from-offset/history asserts including full-file reconstruction from the three chunks, and 404 rejects. All three test files pass (webui, kanban, orchestrator).
- Review of eb4c12f: found one functional bug. The #m-log pane carried a hidden class, but no CSS rule hid it (the page only had #modal.hidden), so the pane showed at once and the button never showed or hid it. Fix 65b43ac adds #m-log.hidden { display: none; } and a test assert for it.
- Review also found: #m-agent kept its margin-bottom when empty, so every task without a live agent got a double gap between the attributes and the body. Fix 65b43ac adds #m-agent:empty { display: none; }.
- Review checked the server logic against src/orchestrator.ts: the pidAlive mirror matches, the pid and log file names match spawnAgent, and the taskFiles check blocks path traversal in the log handle. Tail, poll, history, and 404 asserts all hold. All three test files pass after the fix.
- Re-review of 65b43ac (second pass): re-verified the server logic against src/orchestrator.ts (default pidName is the slug for developer/reviewer/live-tester spawns, so .pids/{slug}.pid is right; the merger pid {slug}.merger is a non-agent handle and 404s; the role regex plus the taskFiles check blocks traversal), the tail/poll/history cursor math, and every new test assert. All three test files pass.
- Found one remaining race: the scroll-to-top history fetch could land inside a poll's busy window and never re-fire (no further scroll event while parked at the top), so earlier history stayed unfetched until the user scrolled again. Fix 0b0c9fb: the pollLog tick now retries the history pull when the pane sits at scrollTop 0 with more history available (atStart false), and polls normally otherwise.
- One orchestrator.test.ts run failed when executed in the same batch as kanban.test.ts; it passed standalone and on repeated combined runs. The file does not import webui.ts, so this is a pre-existing flake in the slow smoke test, not caused by this branch.
- main advanced to 6160719 (kanban_list) during the review: no file overlap with this branch, and its additive kanban.ts changes leave getTask/setState, which webui.test.ts uses, untouched, so the merge stays clean.
- Third review pass (0b0c9fb): re-checked the server contract against src/orchestrator.ts (pidAlive mirror matches, pid and log names match spawnAgent, the merger pid name {slug}.merger 404s, taskFiles blocks traversal, chunk reads stay at 16KB) and the fix itself: the poll tick retries a scroll-to-top that landed in a busy window, and the busy guard stops overlap. All three test files pass. No fixes this pass.
- Two theoretical races left, both judged too narrow to fix: a pullLog response that resolves after the pane is closed and reopened can apply to the new state, but each response is internally consistent and the next poll re-syncs (needs two toggles inside one localhost round-trip), and the poll tick can pull one extra history chunk when the tail chunk fits the pane without scrolling, which stops after that one pull.
- Live test (0b0c9fb): PASS. Ran the daemon from the worktree (node src/orchestrator.ts --root <sandbox>, --poll-minutes 120 to keep the sandbox board stable) with a sandbox project: tasks in doing/live-testing/reviewing with live pid files and fixture logs (one static 40KB, one growing 1 line/0.5s, one killable), one backlog task without an agent. Drove the dashboard with a headless browser, 37 checks, all pass. Board renders 4 cards; button with spinner and role name only for live agents (Developer/Reviewer/Live-tester); backlog card and dead-agent card show no button and no double gap (#m-agent:empty). Pane hidden until the button click, visible after; polls ~1s while open and alive (2+ requests in 3.2s); content grows live and auto scroll sticks to the bottom; scrolling up pauses auto scroll while appends continue; returning to the bottom sticks again. Toggle off hides the pane and stops polling, toggle on resumes. Closing the modal stops polling (0 requests in 2.6s). Agent death mid-test stops polling within ~6s (page refresh + tick) and the button disappears on the next card open; the pane stays readable.
- Live test history: a 40KB log loads the last 16KB only (16384 chars, not line 1), at the bottom after init. A deliberate scroll to the top prepends exactly one 16KB chunk with the scroll position kept stable (scrollTop delta == scrollHeight delta within 2px); a second scroll to the top reaches the file start (line 1); no further history requests once atStart (0 in 2.2s). With history responses held 600ms, the pane state before the prepend was sampled deterministically.
- Live test API (curl): tail returns head 23646/tail 40030/atStart false; poll from offset returns the bytes after it; history returns the 16KB before the offset; before=1&offset=0 returns empty with atStart true; tail+2 history chunks reconstruct the file byte-exact. 404 for unknown file, merger handle, traversal attempt (../../secrets.developer), empty handle, and wrong suffix. /api/tasks carries agent {role, alive, log} per working task and null for backlog, never a raw path.
- Live test checks: all three test files pass in the worktree (webui, kanban, orchestrator). No issues found; the three failures hit during testing were test-harness bugs (writer redirect, wheel distance, stale pid from a previous run), not app bugs. Sandbox and daemon cleaned up; the main pipeline daemon was untouched.
