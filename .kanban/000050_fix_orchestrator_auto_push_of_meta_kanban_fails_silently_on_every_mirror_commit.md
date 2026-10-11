---
name: "fix: orchestrator auto-push of meta/kanban fails silently on every mirror commit"
priority: "medium"
state: "reviewing"
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

- Investigated the environment: origin is git@github.com:sphamba/se-llm-team.git (SSH) and ~/.ssh/ held no known_hosts and no key. Host-key verification was the first failure cause; after accepting the host key, pushes still fail with "Permission denied (publickey)", because this environment has no deploy key and registering one needs user credentials. Scope option 1 (configure SSH so pushes succeed) is therefore not completable by an agent here; the user must add a deploy key to the GitHub repo for pushes to work.
- Environment half-fix applied during investigation: github.com's host key is now in ~/.ssh/known_hosts (via StrictHostKeyChecking=accept-new), so push failures now surface the real auth error instead of "Host key verification failed".
- Implemented option 2 (the code change): pushMirror counts consecutive failures in .kanban/.logs/push-failures.count (existing readCounter/bumpCounter helpers, survives daemon restarts). After 3 consecutive failures it logs a one-time WARNING naming the consequence (board mirror not reaching origin, fresh-clone bootstrap cannot work) and the SSH remediation (known_hosts entry, deploy key). A successful push resets the count, so a later failure streak warns again. Per-failure non-fatal logging is unchanged.
- Implemented option 3: new README section "Board mirror to origin" documents the auto-push, its SSH requirement, and the warning.
- Test part S added to src/orchestrator.test.ts: fixture with origin pointing at a non-repo path, four tasks created one per sweep (one create mirror commit = one failed push each, four in a row); asserts the warning fires after the 3rd failure and is logged exactly once per failure streak. First attempt with 4 tasks up front failed because the first create commit folds all new files into one whole-board commit, so the test now creates one task per sweep.
- Checks: node src/orchestrator.test.ts all smoke parts pass (including the new "push warning smoke"); node src/kanban.test.ts passes.
- Committed 57f3e4e in worktree fix/orchestrator-auto-push-of-meta-kanban-fails-silently-on-every-mirror-commit (README.md, src/orchestrator.ts, src/orchestrator.test.ts).
