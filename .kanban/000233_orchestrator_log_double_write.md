---
name: "fix: orchestrator log lines are written twice"
priority: "medium"
state: "reviewing"
worktree: "fix/233-orchestrator-log-double-write"
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
- Fix (commit 889b0d3): log() in src/orchestrator/log.ts now skips the stdout echo only when fd 1 is the same open file as the log target (fstatSync(1).dev+ino versus statSync(logPath)); a pipe or a terminal still receives the echo.
- Deviation from the preferred fix: an isTTY guard would break the existing suite. runDaemon and the hub/worktree daemon smoke parts assert log() lines from the daemon's piped stdout (about ten harness sites), so the same-file predicate was chosen; it fixes the detached case exactly and keeps those harnesses unchanged and green.
- Test: tests/orchestrator.test.ts part AZ spawns a child with stdout pointing at the log fd (the orchestrator_start stdio shape) and asserts 2 calls write 2 lines; a second child with a piped stdout asserts the echo is kept and the file still gets one line per call. Against the original code the detached case wrote 4 lines for 2 calls (red run confirmed).
- Live check: daemon started with stdout+stderr redirected to .kanban/.logs/orchestrator.log (the orchestrator_start stdio shape) and --no-webui; after SIGTERM, `tail -30 .kanban/.logs/orchestrator.log | sort | uniq -d` printed nothing, and the log held exactly the startup and stop lines.
- Scoped suite: node tests/orchestrator.test.ts passes, part AZ included.
- Left untouched: main()'s --compact-logs branch still runs log(summary) plus an explicit stdout write, so a foreground --compact-logs prints the summary twice; that one-shot CLI path is not the daemon and was already double before this fix.

# Open questions
- Assumption: the same-file (dev+ino) predicate is an acceptable substitute for the spec's preferred isTTY guard, made because the test harnesses read daemon log lines from piped stdout. Confirm.
