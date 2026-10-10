---
name: "fix: orchestrator smoke test leaks daemon processes"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
src/orchestrator.test.ts leaves spawned daemon processes alive after the test ends. More than 10 `node src/orchestrator.ts --root /tmp/orch-smoke-*` processes linger. The test must clean up every process it spawns, also on failure.

# Specs
# Need

Running src/orchestrator.test.ts leaks daemon processes. Verified with ps: pids 208731, 211468, 213029, 216545, 218981, 243221, 245912 all run `node src/orchestrator.ts --root /tmp/orch-smoke-* --rescan-seconds 1 --poll-minutes 0.05` long after their test runs ended. One (pid 527983) even runs the daemon from inside an old task worktree: /home/phamba/repos/se-llm-team/.worktrees/fix/poll-respawns-finished-agents-because-agent-state-updates-never-reach-the-main-board/src/orchestrator.ts with root /tmp/orch-smoke-BJpMJG.

# Required behavior

1. The smoke test kills every daemon process it spawns before it exits, and every agent the daemons spawned.
2. Cleanup must also happen when the test fails or is interrupted (for example process.on("exit") plus explicit child kill calls, same pattern the daemon itself uses for its lock).
3. Do not change what the test asserts. Do not change the daemon code for this task.

# Constraints

- Minimal diff, only src/orchestrator.test.ts (and housekeeping for the leaked processes).
- No new dependencies.

# Acceptance criteria

- `node src/orchestrator.test.ts` passes.
- After the test finishes, `ps aux | grep orch-smoke` shows no processes started by that run.
- The already leaked processes are killed (housekeeping, part of this task).

# Notes
