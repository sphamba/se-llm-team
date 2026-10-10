---
name: "fix: stop mergeDone bumping merge attempts and logging give-up past the cap"
priority: "low"
state: "done"
worktree: ""
---

# Summary
In mergeDone (src/orchestrator.ts), past the 3-attempt merge cap every sweep still bumps the merge-attempts counter and logs the give-up line again, so a stuck-conflict task grows .kanban/.logs and the counter file unboundedly. Log the give-up only once and stop bumping past the cap.

# Specs
Found in the live test of task 000010. Pre-existing, not a regression from that fix.

Cause: in mergeDone (src/orchestrator.ts, ~line 254), bumpCounter(<slug>.merge-attempts) runs before the cap check. A stuck-conflict task stays done with a worktree, so every rescan calls mergeDone again. Past MERGE_ATTEMPT_CAP (3), each sweep adds +1 to the counter and writes "still conflicts after 3 attempts, left for manual resolution" again.

Effect: .kanban/.logs and the counter file grow on every sweep (10s scan) until the conflict is resolved.

Fix:
- Check the attempts value before bumping, or do not bump once past the cap.
- Log the give-up line only once; match the dead-agent poll, which already logs its give-up once.

Acceptance:
- After the cap, a sweep does not change the counter file and does not add a new give-up log line.
- Before the cap, counter bumps, merger spawns, and conflict logs stay the same.
- Existing tests pass.

# Notes
- [2026-10-10 20:38] Merge conflict for branch fix/stop-mergedone-bumping-merge-attempts-and-logging-give-up-past-the-cap, merger spawned (attempt 1).

- Fix in mergeDone (src/orchestrator.ts): the counter is now read with readCounter before any bump. Below the cap the behaviour is unchanged (bump, conflict log, merger spawn at attempts 1-3). At the cap the give-up line is written once with a single final bump (counter lands at cap+1), and every later sweep finds attempts > cap, returns false, and touches neither the counter file nor the log.
- New orchestrator.test.ts part J: fixture with a real conflicting branch (fix/conflict vs main, both edit README.md), a done task pointing at that branch, and a stub merger that dies without resolving. Asserts mergers spawn on attempts 1 and 3 but never 4, the counter freezes at 4, the give-up line appears exactly once, and after 3 more sweeps neither the counter nor the log changes; the task stays done for manual resolution.
- All suites pass: orchestrator.test.ts (parts A-J), kanban.test.ts, webui.test.ts. Committed as a3709bf in the worktree.
- Review pass: verified the fix against the specs. mergeDone now reads the counter before any bump: attempts 1-3 keep the old behaviour (same bump, same "spawning merger (attempt N)" numbers, same conflict note), the give-up is written once with a single final bump at the cap (counter lands at 4), and every later sweep reads attempts > cap and returns early without touching the counter file or the log. A daemon restart cannot re-log the give-up, since the persisted counter stays past the cap.
- Ran all suites in the worktree: orchestrator.test.ts (parts A-J, including the new merge cap smoke with a real conflicting branch), kanban.test.ts, webui.test.ts. All pass. No fixes needed.
- Live test: ran the daemon from the worktree against a scratch git project (/tmp) with a done task pointing at a worktree branch that conflicts with main on README.md, and agent config set to /usr/bin/false (stub merger that dies without resolving, so the cap path is exercised). Sweeps every 2s. Result: attempts 1-3 kept the old behaviour ("merge conflict ... spawning merger (attempt 1/2/3)", three merger spawns, counter bumped to 3); the next sweep wrote the give-up line exactly once and the counter landed at 4; no spawn ever logged "attempt 4". Seven further sweeps left the counter file and orchestrator.log byte-identical (md5 compared before and after), and the task stayed done with its worktree for manual resolution. Also verified a daemon restart: with the persisted counter past the cap, four more sweeps logged nothing merge-related (only lifecycle lines), the counter stayed at 4, and the give-up line count stayed at 1. All three suites pass in the worktree. No issues found.
- [2026-10-10 20:52] Merge resolution: the only conflict was in src/orchestrator.test.ts, where main's conflict-skip test (part J, task 000028) and this branch's merge-cap test both replaced the same tail region. Kept main's part J as-is and renumbered the branch's test to part K (renamed root/task/j/slug/attempts/giveUps identifiers to K). Both part J and part K are now in the file, and the import line already carried setWorktree from both sides. src/orchestrator.ts auto-merged cleanly (the branch's mergeDone fix plus main's conflicted-file guard in rescan and poll are separate regions); verified the staged file has both. Unstaged an unrelated .kanban/000031 file that the daemon had staged mid-merge, so the merge commit holds only the merge resolution. All three suites pass on the merged main (orchestrator.test.ts parts A-K, kanban.test.ts, webui.test.ts). Merge commit 6dd7f92.
