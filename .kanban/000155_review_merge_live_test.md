---
name: "feat: pipeline reorders to review, merge, live-test"
priority: "high"
state: "doing"
worktree: "feat/155-review-merge-live-test"
blockedBy: ""
issuer: "user"
complexity: "complex"
shortName: "review-merge-live-test"
---

# Summary
Live-tester agents do not modify the code, so the pipeline order changes to review -> merge -> live-test: the live test runs on the merged commit on main. The live test still reports problems for the PM as it does now, including technical difficulties encountered during testing. Tasks in to-live-test, live-testing and done stop counting as blocking.

# Specs
Current mechanics: consumeReviewerRun's reviewer-cap path moves to-review -> to-live-test ('reviewer succeeded N+ times, moving to to-live-test'); the live tester runs in the feature worktree (unmerged commit) and on success moves to-live-test -> to-merge; the merger merges and moves merging -> done; the dead-pid bounce maps a dead live-testing agent to to-merge; dropDoneBlockers and the promotion gate count a blockedBy ref as satisfied only when the blocker is done.

Changes (src/orchestrator.ts + src/orchestrator.test.ts + skills/se-llm-team/SKILL.md):
- Reviewer-cap path moves to-review -> to-merge directly (the log line and counter reset move with it; the armed-marker machinery stays).
- The merger, after a successful merge, moves merging -> to-live-test instead of done; the rescan spawns the live tester for the task.
- The live tester runs against the merged commit on main (the daemon's own main checkout), not the feature worktree.
- A passing live test moves live-testing -> done (no merger spawn; the code is already merged).
- A live test with problems keeps the current reporting: finding tasks created for the PM with the causing task's issuer, including technical difficulties encountered during testing, and the task still moves to done (problems travel as new tasks, the merged code is already on main).
- The dead-pid bounce re-maps: a dead live-testing agent bounces live-testing -> to-live-test (respawn the live tester; merge already happened), a dead merging agent stays to-merge.
- Blocker resolution: a blockedBy ref to a task in to-live-test, live-testing or done counts as satisfied everywhere blockers are evaluated (promotion gate, dropDoneBlockers, conflict checks); to-merge and merging keep blocking.
- SKILL.md's pipeline description states the new order (review -> merge -> live-test) and that the live test runs on the merged commit.
- Existing in-flight tasks under the old order keep working: a to-merge task still merges; a live-testing task that passes moves done under the new rule (never re-merges).

Tests: the orchestrator suite covers the reordered pipeline (reviewer cap -> to-merge; merge -> to-live-test; live-test pass -> done; live-test findings -> done + finding tasks; bounce re-mapping; blocker-satisfaction for to-live-test/live-testing/done refs); the suite stays green.

After implementation the PM restarts the orchestrator daemon.
