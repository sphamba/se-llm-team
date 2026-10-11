---
name: "fix: restarting the orchestrator must not kill the running agents"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Killing or restarting the orchestrator daemon kills every spawned agent with it. A restart must leave in-flight agents running and logging, with their changes and state intact.

# Specs
# Problem

The daemon spawns agents with `stdio: ["ignore", "pipe", "pipe"]` and pipes stdout/stderr through the write-time compactor (src/orchestrator.ts ~:311-320, the #105 logFeeders path). The pipe read ends live in the daemon process, so when the daemon exits (SIGINT/SIGTERM stop, or process.exit) the read ends close and the agent's next stdout write gets EPIPE and dies.

Verified in production 2026-10-11: `kill <daemon-pid>`, the daemon logged "orchestrator stopped" at 21:59:37.670Z, and both in-flight reviewer agents (tasks #118 and #121) stopped writing at that exact second and were gone (no /proc entry). Reproduces the earlier #52 developer death at a restart. The daemon's stop() and exit handler only kill pushChildren, so the pipes are the kill path.

# Requirement

Restarting (or stopping and starting) the orchestrator must not kill spawned agents. Agents keep running, keep logging to their `<slug>.<role>.<n>.log`, and the new daemon picks them up as alive (pidAlive reads the existing pid files).

# Constraints

- #105's log compaction must keep working, live or retro-active. If the fix redirects agent stdio to the log file fd instead of pipes (a file fd survives the daemon's death), compaction can move to a retro-compact of the finished log at run end - the retro-compact machinery already exists from #105.
- Log path and naming must not change; the webui read path (chunked payload, walk-back, agentHistory) must keep working on the produced logs, live and finished.
- No new dependencies; boring over clever.

# Tests

src/orchestrator.test.ts: start the daemon, let it spawn a fake long-running agent that writes lines continuously, kill the daemon (SIGTERM), and assert the fake agent is still alive and its log still grows after the daemon's death. Files: src/orchestrator.ts and src/orchestrator.test.ts only.

# Notes
