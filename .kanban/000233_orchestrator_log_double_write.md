---
name: "fix: orchestrator log lines are written twice"
priority: "medium"
state: "done"
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
- Fix (commit 889b0d3): log() in src/orchestrator/log.ts now skips the stdout echo only when fd 1 is the same open file as the log target (fstatSync(1).dev+ino versus statSync(logPath)); a pipe or a terminal still receives the echo.
- Deviation from the preferred fix: an isTTY guard would break the existing suite. runDaemon and the hub/worktree daemon smoke parts assert log() lines from the daemon's piped stdout (about ten harness sites), so the same-file predicate was chosen; it fixes the detached case exactly and keeps those harnesses unchanged and green.
- Test: tests/orchestrator.test.ts part AZ spawns a child with stdout pointing at the log fd (the orchestrator_start stdio shape) and asserts 2 calls write 2 lines; a second child with a piped stdout asserts the echo is kept and the file still gets one line per call. Against the original code the detached case wrote 4 lines for 2 calls (red run confirmed).
- Live check: daemon started with stdout+stderr redirected to .kanban/.logs/orchestrator.log (the orchestrator_start stdio shape) and --no-webui; after SIGTERM, `tail -30 .kanban/.logs/orchestrator.log | sort | uniq -d` printed nothing, and the log held exactly the startup and stop lines.
- Scoped suite: node tests/orchestrator.test.ts passes, part AZ included.
- Left untouched: main()'s --compact-logs branch still runs log(summary) plus an explicit stdout write, so a foreground --compact-logs prints the summary twice; that one-shot CLI path is not the daemon and was already double before this fix.
- Review: scoped suite tests/orchestrator.test.ts exit=0 with part AZ ("single orchestrator log write passed"). Deviation accepted: the dev+ino predicate meets the acceptance exactly (one write per line when stdout is the log file), is narrower than the isTTY guard (pipes keep the echo), and the spec already allowed dropping the stdout write entirely. Harness rationale confirmed: runDaemon (tests/orchestrator.test.ts:161) plus 15+ daemon spawns pipe stdout and read log lines from it, so an isTTY guard would silence all of them. Cosmetic, non-blocking: the stdoutIsLog comment ends with a stray "---".

## Live test (2026-10-16, merge 889b0d3)

Scope: the detached daemon's double log write. The main checkout was at the merged commit, so the pi extension symlink resolved to the merged code. No unit suite was run (developer/reviewer gate). 14 checks, 0 failed.

A. Real `orchestrator_start` (acceptance). One `pi -p --mode json` session, cwd = scratch git fixture, called the extension tool with `SE_LLM_TEAM_NO_WEBUI=1`. The tool spawned the watched daemon (pid 3794364) with stdio `["ignore", log, log]`.
   - `orchestrator started` x1 and `web ui disabled (no-webui)` x1 in `.kanban/.logs/orchestrator.log`, after a 10 s rescan sweep and after the stop: no duplicate lines.
   - The acceptance command `tail -30 .kanban/.logs/orchestrator.log | sort | uniq -d` printed nothing.
   - Stop with the same pgrp SIGTERM that `orchestrator_stop` sends: `orchestrator stopped` x1, lock removed, watcher and daemon gone.
B. Foreground pipe shape. The merged daemon with a piped stdout kept the echo (`orchestrator started` x1 and `orchestrator stopped` x1 on stdout) and the file held exactly one copy per line.
C. Control. The parent commit (54cf596, `git archive`) in the same detached fd shape wrote `orchestrator started` x2 and `orchestrator stopped` x2 (3 duplicated lines). The duplicate check detects the old bug.

Assumptions:
- The acceptance was exercised through the real pi extension tool on a scratch git fixture with an empty board, so the run produced startup, sweep and stop lines only. Agents, worktrees and merges were not involved, which matches the change's scope (`log()` only).
- The daemon was stopped by its process group SIGTERM (the exact signal `orchestrator_stop` sends). The stop tool itself was not re-run through pi.
- `--compact-logs` (the known, intentionally untouched one-shot double print named in the Notes) was not re-tested.

No finding. No observed behavior contradicts the task's assumptions. The Notes' deviation (the dev+ino same-file predicate instead of an isTTY guard) behaved as described: a pipe keeps the echo, the detached file shape writes once.
