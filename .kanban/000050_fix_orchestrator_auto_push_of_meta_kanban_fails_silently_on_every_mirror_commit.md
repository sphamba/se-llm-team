---
name: "fix: orchestrator auto-push of meta/kanban fails silently on every mirror commit"
priority: "medium"
state: "done"
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
- Review of 57f3e4e: approved, no fixes. HEAD holds one commit; the diff against current main touches only README.md, src/orchestrator.ts, src/orchestrator.test.ts.
- Review checked the counter logic: a failed push bumps push-failures.count, the warning logs once at exactly 3 (the 4th failure logs only the per-failure line), a success resets the count to 0, and a stale count after a daemon restart resets on the first successful push. The warning does not repeat past 3 in one streak (by design).
- Review checked the counter file cannot leak: `.kanban/.logs/push-failures.count` stays out of the board mirror because taskFiles picks only .md files directly in .kanban/ and .kanban/ is gitignored. In the catch path log() runs before bumpCounter(), so .logs/ exists before the first counter write.
- Review re-ran the checks in the worktree: node src/orchestrator.test.ts (all smoke parts, including the new push warning smoke), node src/kanban.test.ts, node src/webui.test.ts. All pass.
- Uncovered by tests (accepted, 1-line logic): no direct test of the reset-on-success path. To test it, switch origin from the non-repo path to a bare repo mid-test and assert a second warning streak.
- Live test (2026-10-11 ~09:05-09:13 CEST): stopped the pre-fix daemon and ran the fix code from the worktree (node src/orchestrator.ts --root /home/phamba/repos/se-llm-team) against the real repo and shared board, matching the post-merge daemon configuration. Drove 4 consecutive failed auto-pushes with 4 scratch tasks (one create mirror commit each, 10s scan): .kanban/.logs/push-failures.count went 1, 2, 3, 4; each failure logged the non-fatal line with full stderr (git@github.com Permission denied (publickey), fatal: Could not read from remote repository); the WARNING fired exactly once at the 3rd consecutive failure and did not repeat on the 4th. Verified the counter file is gitignored and absent from the meta/kanban mirror (only .md files on the mirror). README "Board mirror to origin" section present and accurate in the worktree.
- Live test supporting checks: node src/orchestrator.test.ts (all smoke parts, including the new push warning smoke) and node src/kanban.test.ts pass in the worktree. Pipeline work continued normally under the fix daemon (reviewer and developer spawns succeeded).
- Live test found no defect in the change. Two issues found around it, reported to the PM: (1) no supported way to remove a mistaken task from the board (no delete tool; manual file deletion self-heals back from the mirror, and a daemon restart before the next mirror commit restores deleted files); (2) the push-warning counter fires only on exactly 3, so a stale counter above 3 (backup restore, leftover artifact) keeps the warning silent forever where pushes never succeed; the merge-attempts counter avoids this with a >= cap check.
- Reset-on-success path not exercised live (no deploy key, pushes never succeed here), accepted per the note above.
- Environment restored after the test: scratch tasks removed from both the tree and the mirror (mirror cleanup done with the daemon's own plumbing pattern, commit b94d3222), counter artifact deleted so the post-merge daemon starts a fresh failure streak, original daemon restarted from the extension path with the web UI back on port 4242.
