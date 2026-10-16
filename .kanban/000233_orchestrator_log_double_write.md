---
name: "fix: orchestrator log lines are written twice"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "orchestrator-log-double-write"
---

# Summary
The daemon writes every orchestrator log line twice: log() appends to the log file and also writes to stdout, and orchestrator_start redirects the daemon's stdout to that same log file. Fix so each line lands once.

# Specs
# Problem
Every se-llm-team orchestrator log line appears twice in .kanban/.logs/orchestrator.log (observed since 2026-10-11, not a regression).

# Root cause
log() in src/orchestrator/log.ts:38-43 writes every line twice: appendFileSync(logPath(root, "orchestrator"), line) plus process.stdout.write(line). orchestrator_start (src/tools.ts:230-234) spawns the daemon as `node --watch orchestrator.ts` with stdio ["ignore", log, log], where the log fd is orchestrator.log itself, so the daemon's inherited stdout is the same file and the stdout write duplicates the direct append.

# Fix
Exactly one write per line when the daemon runs detached. Preferred minimal fix: in log(), write to stdout only when process.stdout.isTTY (the direct append always happens; detached stdout is never a TTY, foreground debugging keeps both). Dropping the stdout write entirely is also acceptable.

# Constraints
- The log file still receives every line, including daemon startup, reconciliation and shutdown lines.
- Crash traces must not be lost: if orchestrator_start's stdio changes, keep stderr pointed at the log fd.
- Role-agent and analysis spawns keep their own stdio fd redirects in src/orchestrator/spawn.ts (a different path, unaffected).
- No hub, webui or board changes.

# Acceptance
- Live check: after orchestrator_start, the fresh run's lines are single: `tail -30 .kanban/.logs/orchestrator.log | sort | uniq -d` is empty for the new lines.
- The tests the developer's fix ships (per the role test policy) pass.

# Notes
