---
name: "fix: stop mergeDone bumping merge attempts and logging give-up past the cap"
priority: "low"
state: "backlog"
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
