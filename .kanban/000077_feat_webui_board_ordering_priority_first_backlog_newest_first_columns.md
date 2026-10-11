---
name: "feat: webui board ordering; priority-first backlog, newest-first columns"
priority: "high"
state: "doing"
worktree: "feat/77-webui-board-ordering"
---

# Summary
Backlog column sorts tasks by priority first (highest above) and by most recently updated within the same priority. All other columns order tasks by most recently updated first, with deterministic ties.

# Specs
Order the tasks inside the board columns (user feedback): backlog sorts by priority first, every other column by most recently updated first.

Facts:
- Cards in each column are rendered in the /api/tasks order (file-name/task-number order). render() (src/webui.ts:446) rebuilds all columns and cards in one string.
- Task files carry no stored update timestamp; the file mtime is the natural update signal (the daemon and kanban tools rewrite task files on state changes and note appends).
- Lanes: #38 (hub backend, live-testing) branch rewrites src/webui.ts; #47 (high), #76 (medium), and #77 (high) are queued on the same webui lane.

Changes:
1. /api/tasks exposes each task's update time (from the task file's mtime) so the client can sort; alternatively the server pre-sorts per column - the developer picks the simpler option, keeping the API backward-compatible for existing consumers.
2. Backlog column ordering: highest priority first (critical, high, medium, low); within the same priority, the most recently updated first.
3. Every other column: the most recently updated first (no priority weighting).
4. Ties are deterministic: same priority and same update time falls back to the current task-number order.
5. Tests: extend src/webui.test.ts - backlog sorts priority-desc then update-desc; other columns sort update-desc; ties fall back to task-number order. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- Backlog shows critical tasks above high, high above medium, medium above low; within one priority, the most recently updated task is on top.
- Every other column shows the most recently updated task on top.
- The 5s refresh keeps the ordering stable.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind 000038 (live-testing): its branch rewrites src/webui.ts. Sequence on the webui lane by priority order: 000047 (high), then 000077 (high), then 000076 (medium); the three tasks cannot run in parallel.

# Notes
