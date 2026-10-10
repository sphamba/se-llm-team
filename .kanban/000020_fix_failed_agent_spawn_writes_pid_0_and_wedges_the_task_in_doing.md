---
name: "fix: failed agent spawn writes pid 0 and wedges the task in doing"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
When the agent executable is missing, spawnAgent logs the ENOENT but still writes a pid file with 0. pidAlive(0) returns true because kill -0 0 signals the process group, so the poll never fires DEAD_TRANSITIONS and the task stays in doing with no agent, forever. Do not write a pid file when the spawn fails, and make pidAlive treat pid 0 as dead.

# Specs
Found on 2026-10-10 while launching tasks 000008, 000014, 000015 with a broken agent executable (the config pointed at a removed wrapper script).

Symptom:
- spawnAgent logs "agent developer ... failed to start: spawn <path> ENOENT".
- The task still moves to doing, and its pid file in .kanban/.pids/ contains 0.
- pidAlive(0) returns true: kill -0 0 succeeds because pid 0 means the process group of the caller. So poll() sees the agent as alive, never runs the DEAD_TRANSITIONS bounce, and the task wedges in doing with no agent. mergeDone would also defer forever for the same reason if the task reached done.

Recovery used in the session: remove the 0 pid files by hand and set the tasks back to to-do.

Fix:
- Do not write a pid file when the spawn fails (for example, clear the pid file in the spawn error handler, or only write it once the child reports a real pid).
- Make pidAlive return false for pid <= 0 (guard against 0 and negative values).

Acceptance:
- A spawn failure leaves no pid file, so poll() bounces the task per DEAD_TRANSITIONS and the rescan retries the spawn.
- pidAlive(0) returns false.
- A test covers the pid-0 case.

# Notes
