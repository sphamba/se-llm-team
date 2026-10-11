---
name: "fix: restarting the orchestrator must not kill the running agents"
priority: "high"
state: "live-testing"
worktree: "fix/125-restarting-the-orchestrator"
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

- 2026-10-11 (fix implemented in worktree fix/125-restarting-the-orchestrator, commit 653f41e):
  - spawnAgent no longer pipes agent stdout/stderr through the write-time compactor. The agent's stdout and stderr are now the per-run log file fd itself (openSync(path, "a"), stdio: ["ignore", fd, fd]); the child owns a dup of the fd, so killing or restarting the daemon cannot close its write end and EPIPE-kill it. logFeeders and logCompactor (the write-time pipe machinery) are deleted; compactLogLine stays.
  - Compaction moved to the retro pass per the constraint: poll() tracks run ends (a stale pidfile of a completed run in a non-working state, a bounced dead working agent, a stall-killed agent) and calls compactFinishedLogs(root) at the end of that pass. The first poll after a daemon restart also cleans up logs left raw by a daemon that died mid-run. --compact-logs still works.
  - compactFinishedLogs' guard now checks pid liveness (agentAlive) instead of pidfile existence, so a finished run's stale pidfile (e.g. overwritten by the next role's spawn before the poll saw it) no longer blocks the rewrite of already-finished logs. Log path/naming and the webui read path are unchanged.
  - Tests (src/orchestrator.test.ts): new part AQ starts a daemon with a fake long-running agent that writes a JSONL line every 100ms, SIGTERMs the daemon, and asserts the agent is still alive and its log still grows after the daemon's death; a second daemon then picks the agent up as alive (no twin spawn, state "doing" intact, log keeps growing). Part AB now runs the compactor fixture through compactLogLine line-by-line (the way the retro pass does) instead of through the deleted Transform; the pipe-integration parts AD and AE are gone with the machinery they tested. Part A waits for the retro compaction of the finished developer log before asserting its compacted content.
  - All suites pass: orchestrator, kanban, webui, extension, index (node <file>.test.ts, exit 0 each).

- 2026-10-11 (review, no fixes):
  - Re-ran all four suites in the worktree, exit 0 each: orchestrator, kanban, webui, extension. Correction to the note above: there is no index suite (no src/index.test.ts); four suites exist.
  - Verified the fd redirect end to end. openSync(path, "a") + stdio ["ignore", fd, fd]; uv_spawn dups the fd into the child during the synchronous spawn() call, so closeSync(fd) in the parent cannot race the child's dup. The O_APPEND flag rides the shared open-file-description, so stdout and stderr writes stay atomic.
  - Verified the retro compaction cannot race a live writer. compactFinishedLogs rewrites a log only when its guard pid reads dead in /proc (discriminator-checked), and a dead process cannot write. While the writer lives, poll's live-pid branch defers, and the guard skips the log. A stalled agent SIGTERMed by bounceDead reads dead only through its cleared pidfile: an agent that survives its SIGTERM past the rename writes to the unlinked inode and its post-SIGTERM lines drop. This window is bounded to the SIGTERM-death time of an agent the poll just killed as hung, and the lines are the diagnostics tail of a hung run. Accepted, no code change.
  - Spec checks pass: diff touches src/orchestrator.ts and src/orchestrator.test.ts only; log path/naming unchanged; webui read path untouched; no new dependencies; --compact-logs intact. Part AQ covers the spec test (survives SIGTERM, log grows, restart picks the agent up as alive, no twin, state doing intact).