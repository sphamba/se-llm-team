---
name: "feat: webui task detail card shows past agents with green checkmarks and their logs"
priority: "medium"
state: "doing"
worktree: "feat/webui-task-detail-card-shows-past-agents-with-green-checkmarks-and-their-logs"
---

# Summary
The task detail card (000033) shows only the currently running agent. Also show past agents for the task - green checkmark instead of spinner - each opening the existing log pane on click.

# Specs
Extend the task detail card (openTask modal, 000033) from one live agent to the task's agent history.

Facts:
- Agent logs persist per role: .kanban/.logs/{slug}.developer.log, {slug}.reviewer.log, {slug}.live-tester.log.
- One pid file per task (.kanban/.pids/{slug}.pid) holds the CURRENT agent's pid; the task state maps to the current role (doing=developer, reviewing=reviewer, live-testing=live-tester). A role with a log file that is not the live one is a past agent.
- The modal (000033, merged) already renders a live-agent button with spinner and agent name, and a log pane streaming GET /api/agent-log?file=...&offset=... .

Changes (src/webui.ts only):
1. /api/tasks payload: per task add agents[] - one entry per existing role log file, each {role, alive}: alive only for the role matching the task's current state with a live pid; all other roles are past (alive=false).
2. Modal: keep the live agent button (spinner + name). Below it, render one button per past agent with a green checkmark (CSS, theme-aware) and the role name - in pipeline order (developer, reviewer, live-tester), past ones only.
3. Clicking any button (live or past) opens the existing pane streaming that role's log via /api/agent-log?file={slug}.{role}.log...; resolve the log path server-side from the task file and role - never accept a raw path. Polling/live-update rules from 000033 apply; for past agents polling can stop when no new content arrives.
4. Hide past-agent buttons when the task has no role log files.

Acceptance:
- The card shows the live agent with spinner and past agents with green checkmarks.
- Clicking a past agent opens its log with the existing streaming pane.
- Tasks with a single developer log and no other roles show only the live button.
- Existing tests pass; extend webui.test.ts with an assert-based check for the agents[] payload (per repo convention).

Constraints:
- Only src/webui.ts changes (frontend + API).
- Conflicts are minor and merger-resolvable: modal area is distinct from 000036's FLIP render and 000054's /api/agent-log parse; webui.test.ts additions overlap 000036/000054 only by file.

# Notes
