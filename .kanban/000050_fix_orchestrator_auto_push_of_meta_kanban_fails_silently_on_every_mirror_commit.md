---
name: "fix: orchestrator auto-push of meta/kanban fails silently on every mirror commit"
priority: "medium"
state: "doing"
worktree: "fix/orchestrator-auto-push-of-meta-kanban-fails-silently-on-every-mirror-commit"
---

# Summary
The daemon's best-effort auto-push of refs/heads/meta/kanban to origin fails on every mirror commit with an SSH host-key verification error, so the board mirror never reaches origin and the 000034 push/bootstrap half silently never works. Configure SSH for the daemon environment, add a clear one-time warning when pushes keep failing, or document the limitation.

# Specs
Evidence (from live test of 000042 'fix: restore board state lost to stale mirror snapshots'):

- The orchestrator daemon's best-effort auto-push of refs/heads/meta/kanban to origin fails on every mirror commit with "Host key verification failed. fatal: Could not read from remote repository." (see .kanban/.logs/orchestrator.log, at least since 2026-10-10 23:10Z; non-fatal by design).
- Because the push never succeeds, the board mirror never reaches origin, so the 000034 feature (board mirrored to a meta/kanban branch, fresh-clone bootstrap on another machine) cannot work in this environment.
- The cause looks environmental (SSH to origin untrusted/unavailable in this sandbox), not a code bug, but it silently defeats the push half of the mirror feature forever.

Suggested scope (decide after investigation):
1. Configure SSH (known_hosts/key) for the daemon environment so pushes succeed; or
2. Add a clear one-time warning (log/webui) when pushes keep failing consecutively, so the failure is visible instead of silent; or
3. Document the limitation (e.g. in README or the PM skill) for environments where origin is unreachable.

Related but distinct: 000034 (the mirror feature), 000044 (branch-to-tree reconcile), 000045 (mirror commit label swallowing create events), 000046 (fresh-clone bootstrap refs + non-fast-forward push).

# Notes
