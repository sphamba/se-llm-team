---
name: "fix: push-warning counter fires only on exact equality - stale counter above 3 keeps the warning silent forever"
priority: "low"
state: "done"
worktree: ""
---

# Summary
pushMirror (src/orchestrator.ts) logs its one-time push warning only when bumpCounter returns exactly PUSH_WARN_AFTER (3). A stale counter file above 3 keeps the warning silent forever where pushes never succeed, since the count only resets on a successful push. Fire the warning on >= PUSH_WARN_AFTER (or reset-on-read), keeping one warning per streak.

# Specs
Found during the live test of task 000050 (orchestrator auto-push of meta/kanban). Evidence:

- In src/orchestrator.ts, pushMirror logs its one-time warning only when bumpCounter(root, "push-failures") === PUSH_WARN_AFTER (PUSH_WARN_AFTER = 3, line ~220).
- The push-failures count only resets on a successful push, so a stale counter file above 3 (for example restored from a backup, or a leftover artifact) keeps the warning silent forever in environments where pushes never succeed - the exact situation the warning exists to surface (permanently unreachable origin defeating the mirror and fresh-clone bootstrap).
- The merge-attempts counter in the same file avoids this class of bug with a >= cap check: `if (attempts >= MERGE_ATTEMPT_CAP)` (src/orchestrator.ts, mergeAttempt). Review note: this contrast is stale, the merge-attempts counter no longer exists in the code; the push-failures equality bug is real.

Suggested fix: fire the warning when the counter is >= PUSH_WARN_AFTER (or reset the counter on read), while keeping the once-only behavior - one warning per failure streak, not one per failure. Consider a regression test covering a counter file that already starts above the cap.

Priority low, type fix.

# Notes

- Fix committed in worktree fix/65-push-warning-counter (bd74f70). pushMirror now warns when bumpCounter(root, "push-failures") >= PUSH_WARN_AFTER and a push-warned counter file is unset; the warned file is written with the warning and cleared on a successful push, so the once-per-streak behavior holds while a stale counter above the cap (backup restore, leftover artifact) still warns on the next failed push. Bare >= alone would have warned on every failure past the cap, so the marker file is what keeps it once per streak.
- Regression test added as part T2 in src/orchestrator.test.ts: a fixture with origin pointing at a non-repo path and a pre-seeded .kanban/.logs/push-failures.count of 5; one failed push fires the warning, a second failed push keeps the count at one. Full orchestrator.test.ts, kanban.test.ts and webui.test.ts all pass (node --experimental-strip-types, no pnpm available in this environment).
- Review of bd74f70 passed, no fixes needed. Verified the warned-marker logic against every scenario: fresh streak warns at 3, further failures stay silent, a success resets both the counter and the marker, and a stale counter of 5 warns on the next failed push across a daemon restart. Part T2 asserts exactly what the Specs asked for (pre-seeded counter above the cap, one warning, a second failed push stays silent), and pushMirror runs in the same poll cycle as the commit, so the test ordering holds.
- Review finding 1: the Specs' contrast is stale - the merge-attempts counter and MERGE_ATTEMPT_CAP no longer exist in src/orchestrator.ts (orchestrator.test.ts asserts the counter file is absent). The fix stands on its own evidence, the push-failures equality bug is real.
- Review finding 2: the same equality class of bug exists in the dead-agent counter (poll loop, `${slug}.dead` is never reset, give-up log fires only at === RESPAWN_CAP + 1), out of scope here. Created follow-up task 000109.
- Test runs: orchestrator.test.ts passed in 2 of 3 runs; the one failure was a pre-existing flake in part E (reviewer respawn cap, lock re-acquisition stall), unrelated to this change. kanban.test.ts and webui.test.ts pass.
- No open questions.
- Live test report (live-tester, worktree fix/65-push-warning-counter, bd74f70):

- Result: PASS. No issues found, no new tasks created.
- Ran the full integration suite `node --experimental-strip-types src/orchestrator.test.ts` from the worktree: all parts passed, including `... + push warning smoke passed` (part T) and `... + stale push counter warning smoke passed` (part T2).
- Manual user-like run of the real daemon (`node --experimental-strip-types src/orchestrator.ts --root <tmp> --rescan-seconds 1 --poll-minutes 0.05`, SE_LLM_TEAM_NO_WEBUI=1) in a fresh git repo with `origin` set to a non-repo path:
- Stale counter: pre-seeded `.kanban/.logs/push-failures.count` = 5. One failed push raised the counter to 6 and logged the WARNING once; `push-warned.count` became 1. A second failed push raised the counter to 7 and logged no further warning.
- Recovery: after switching `origin` to a valid bare repo, the next push succeeded, both `push-failures.count` and `push-warned.count` reset to 0, and `refs/heads/meta/kanban` appeared on origin.
- Fresh streak after reset: with `origin` unreachable again, four failed pushes warned exactly once (at the 3rd failure) and left `push-warned.count` = 1. One warning per streak holds across a success-then-failure cycle.
- Merge completed (merger): merged main into fix/65-push-warning-counter in the worktree (merge commit 9845ef2, no conflicts; git auto-merged src/orchestrator.ts, src/orchestrator.test.ts, src/webui.ts, src/webui.test.ts, README.md, .gitignore). No fixes were needed: both sides of the auto-merged files kept the intended behavior, the >= plus warned-marker logic in pushMirror and the T2 stale-counter regression test survived intact.
- Test suites in the worktree after the merge: orchestrator.test.ts all parts passed twice, including `... + push warning smoke passed` (part T) and `... + stale push counter warning smoke passed` (part T2); kanban.test.ts and webui.test.ts all assertions passed.
- Merged fix/65-push-warning-counter into main in the project root as a fast-forward (main now at 9845ef2). No conflicts.

# Open questions
