---
name: "fix: push-warning counter fires only on exact equality - stale counter above 3 keeps the warning silent forever"
priority: "low"
state: "reviewing"
worktree: "fix/65-push-warning-counter"
---

# Summary
pushMirror (src/orchestrator.ts) logs its one-time push warning only when bumpCounter returns exactly PUSH_WARN_AFTER (3). A stale counter file above 3 keeps the warning silent forever where pushes never succeed, since the count only resets on a successful push. Fire the warning on >= PUSH_WARN_AFTER (or reset-on-read), keeping one warning per streak.

# Specs
Found during the live test of task 000050 (orchestrator auto-push of meta/kanban). Evidence:

- In src/orchestrator.ts, pushMirror logs its one-time warning only when bumpCounter(root, "push-failures") === PUSH_WARN_AFTER (PUSH_WARN_AFTER = 3, line ~220).
- The push-failures count only resets on a successful push, so a stale counter file above 3 (for example restored from a backup, or a leftover artifact) keeps the warning silent forever in environments where pushes never succeed - the exact situation the warning exists to surface (permanently unreachable origin defeating the mirror and fresh-clone bootstrap).
- The merge-attempts counter in the same file avoids this class of bug with a >= cap check: `if (attempts >= MERGE_ATTEMPT_CAP)` (src/orchestrator.ts, mergeAttempt).

Suggested fix: fire the warning when the counter is >= PUSH_WARN_AFTER (or reset the counter on read), while keeping the once-only behavior - one warning per failure streak, not one per failure. Consider a regression test covering a counter file that already starts above the cap.

Priority low, type fix.

# Notes

- Fix committed in worktree fix/65-push-warning-counter (bd74f70). pushMirror now warns when bumpCounter(root, "push-failures") >= PUSH_WARN_AFTER and a push-warned counter file is unset; the warned file is written with the warning and cleared on a successful push, so the once-per-streak behavior holds while a stale counter above the cap (backup restore, leftover artifact) still warns on the next failed push. Bare >= alone would have warned on every failure past the cap, so the marker file is what keeps it once per streak.
- Regression test added as part T2 in src/orchestrator.test.ts: a fixture with origin pointing at a non-repo path and a pre-seeded .kanban/.logs/push-failures.count of 5; one failed push fires the warning, a second failed push keeps the count at one. Full orchestrator.test.ts, kanban.test.ts and webui.test.ts all pass (node --experimental-strip-types, no pnpm available in this environment).
- No open questions.

# Open questions
