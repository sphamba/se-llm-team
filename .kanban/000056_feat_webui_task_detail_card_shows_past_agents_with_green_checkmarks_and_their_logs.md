---
name: "feat: webui task detail card shows past agents with green checkmarks and their logs"
priority: "medium"
state: "done"
worktree: ""
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

- [2026-10-11 09:07] Implemented per specs, commit 358c345 in feat/webui-task-detail-card-shows-past-agents-with-green-checkmarks-and-their-logs. (Re-appended: an earlier notes append was lost when the to-review transition and the spawned reviewer rewrote this file.)
- Server: /api/tasks payload adds agents[] (one {role, alive} entry per existing role log file, pipeline order developer/reviewer/live-tester, only the state-mapped role with a live pid is alive); extracted shared currentPid helper, agentInfo now uses it; log path resolution stays server-side in agentLogPath (already validated per 000054), client only sends {slug}.{role} handles.
- Modal: live agent button unchanged (spinner + name); past agents render below it as agent-past buttons with a theme-aware green checkmark (check span, var(--low-fg)), hidden with the whole agent area when a task has no role logs; every button toggles openAgentLog(role) which reuses the existing streaming pane.
- Polling: past-agent polls stop after one empty poll (logs of dead agents are frozen); pullLog now pins the logState reference so an in-flight response from a superseded open or role switch cannot write into the new view.
- webui.test.ts: agents[] checks added (empty for no logs, single live developer, past reviewer after live developer in pipeline order, dead state-mapped agent is past, reviewer log streams via /api/agent-log, checkmark span shipped in the page). webui/kanban/orchestrator tests all pass; served client JS syntax-verified.
- [2026-10-11 09:33] Re-review pass (commit 358c345): same conclusion, no fixes needed. Confirmed the 09:20 findings independently: full test suites pass (webui, kanban, orchestrator), served client JS parses (node --check), live /api/tasks agents[] payload and checkmark span verified on a temp board. The 09:20 state transition to to-live-test did not persist on the board (state was still reviewing), so it is set here.
- [2026-10-11 09:20] Review (commit 358c345, diff main...HEAD = src/webui.ts + src/webui.test.ts only): no fixes needed. Verified per spec - agentHistory adds agents[] (existsSync per pipeline role, alive only for the state-mapped role with a live pid via the shared currentPid helper); live button keeps spinner + name, past buttons render below it in pipeline order with a green theme-aware checkmark (.check uses var(--low-fg), green in both palettes #aad94c/#86b300); every button calls openAgentLog(role) which toggles or opens the existing pane and streams {slug}.{role} handles, path resolved server-side in the untouched agentLogPath; past-agent polling stops after one empty poll; empty agent area stays hidden (#m-agent:empty). Ran webui/kanban/orchestrator suites, all pass; re-verified the served client JS syntax and the live /api/tasks agents[] payload on a temp board (empty list and past reviewer entry both correct). Known ceiling, within spec: after the timer stops for a past log it will not auto-resume if the same role later becomes live again and its log grows; the user re-clicks the button to reopen. State set to to-live-test.
- [2026-10-11 09:40] Third review pass (commit 358c345): same conclusion, no fixes needed. Independently verified: diff main...HEAD touches only src/webui.ts + src/webui.test.ts, all suites pass (webui/kanban/orchestrator), shipped client JS parses, agents[] payload and pipeline order correct. State transition to to-live-test aborted: the board had already moved to live-testing (prior reviewer passes 09:20/09:33 plus pipeline progression), so no state change is made from this session.
- [2026-10-11 10:05] Parallel review pass (commit 358c345): same conclusion, no fixes needed. Ran against the worktree before the merger pruned it: webui and kanban suites pass, orchestrator smoke failed once with the detail lost to a short capture, then passed 2/2; the branch predates main's cd3f0a9 part-D flake fix, so the one failure matches the known flake, already fixed on main. Branch lagged main by 4 merged branches; none touch webui.ts or webui.test.ts, so the merge stays clean (agents[] code confirmed present on main after the merge). This session saw state reviewing at the start and done on re-read, so the state transition is aborted per the pipeline rule.
- [2026-10-11 09:52] Live test (commit 358c345): PASS, no issues found. Ran the orchestrator from this worktree against a temp board (5 fabricated tasks on port 4342, real webui + Playwright headless browser, real live pids for state-mapped roles, stale log files for past roles). All acceptance criteria verified: (1) /api/tasks agents[] payload correct in all 5 scenarios - live-only (doing), past developer + live reviewer (reviewing, pipeline order), all three roles (live-testing), no logs (backlog, no agents[] entries), stale developer log only (past checkmark, no spinner); (2) modal renders the live agent button with spinner first and past agents below it with green checkmarks in pipeline order (Live-tester, check Developer, check Reviewer); (3) clicking any button opens the existing streaming pane with that role's log (verified developer/reviewer/live-tester content), re-click toggles closed; (4) past-agent polling stops after one empty poll (2 requests to stop: init + one poll at offset=end, then the timer cleared - 0 requests in the following 4 s), live log keeps polling (3 requests in 3.2 s); (5) tasks with no role logs hide the whole agent area; (6) checkmark is theme green in both palettes (#86b300 light, #aad94c dark, screenshots captured). Repo suites all pass (webui/kanban/orchestrator); agents[] assertions confirmed present in webui.test.ts. Temp board, temp daemon, and sleeper pids cleaned up. Known ceiling within spec confirmed: a past log's polling does not auto-resume when the role becomes live again; the user re-clicks the button. The doubled name in the modal attributes is already tracked as 000058, not re-reported. State set to done.