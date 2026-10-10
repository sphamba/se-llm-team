---
name: "fix: guard task state transitions and done merges against in-flight agent sessions"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Concurrent role sessions raced on one task during the 000007 live test, and the done+merge path destroyed an in-flight session. Neither an agent nor the daemon may set a task to done or run mergeDone while that task's agent pid is still alive, and role prompts and the PM skill must tell agents to re-check the task state before each transition.

# Specs
# Need

Guard task state transitions and the done+merge path on agent liveness so a still-running agent session can never lose its worktree, cwd, and shell tools mid-session.

# Facts (evidence from the 000007 live test)

- The daemon spawned two live-tester sessions for the same task: pid 784012 at 17:43:46 UTC and pid 811222 at 17:54:29.
- While pid 811222 was still alive and recorded in .kanban/.pids/, the task reached done at 17:56:56. The poller cannot set done while a pid is alive, so a concurrent session must have set it.
- The rescan then merged the branch and removed the worktree under the still-running session (pid 811222). That session lost its cwd, every shell tool died for the rest of the session, and the .worktrees/feat mount refused all writes (EROFS), so it could not recover or finish its checks.

# Required behavior

1. Liveness guard on transitions: an agent or the daemon must not set a task to done, and the daemon must not run mergeDone for a task, while that task's agent pid (as recorded in .kanban/.pids/) is still alive. Refuse or defer the transition instead.
2. Role prompts (developer, reviewer, live-tester) and the PM skill should instruct agents to re-check the task state before each transition (read the task's frontmatter state before calling kanban_update or kanban_set_state, and skip the transition if another session has already moved or finished the task).
3. Cover the guard with tests in the orchestrator test suite (e.g. mergeDone and done transitions with a fake live pid are refused/deferred).

# Constraints

- Keep the existing states and pipeline flow unchanged; only add the liveness guard and prompt/skill guidance.

# Acceptance criteria

- Setting done or running mergeDone for a task with a live agent pid is prevented by the daemon, and a concurrent agent cannot do it either.
- Role prompts and the PM skill mention re-checking the task state before each transition.
- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass.

# Notes
Discovered by the live-tester of task 000007; its session was destroyed mid-check by the merge under its cwd.
