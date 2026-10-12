---
name: "feat: pipeline reorders to review, merge, live-test"
priority: "high"
state: "live-testing"
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

# Notes
Implemented the reorder in the worktree feat/155-review-merge-live-test, commit efef524 (src/orchestrator.ts, src/orchestrator.test.ts, skills/se-llm-team/SKILL.md, agents/reviewer.md, agents/merger.md, agents/live-tester.md). Full suite green: npm test (kanban, orchestrator, webui, extension, index).
- Reviewer cap advance and the clean approval now send to-review -> to-merge; the approval counts as a successful reviewer run (consumeReviewerRun at the start of sweepToMerge) and the armed marker is cleaned there. Log line: "reviewer succeeded N+ times, moving to to-merge".
- The merger sets merging -> to-live-test after a successful merge; the rescan then spawns the live tester on the root checkout (spawnAgent cwd=root, {{WORKTREE}} not substituted), deferred while the project-wide merger pid or the task's own agent pid is alive.
- A to-live-test task whose branch is not merged into the root HEAD (git merge-base --is-ancestor) bounces to to-merge first, so an in-flight task from a daemon still on the old order never gets main tested unmerged. Edge: a to-live-test task with no worktree attr also routes to to-merge, where the "nothing to merge" path sets done without a live test.
- A dead live-testing agent bounces live-testing -> to-live-test (merge already happened); a dead merging agent stays to-merge. A passing live test moves live-testing -> done with no merger spawn; findings still travel as new tasks for the PM.
- Blocker satisfaction is one shared BLOCKER_SATISFIED set (done, to-live-test, live-testing) used by both blockedByUndone and dropDoneBlockers; to-merge and merging keep blocking. dropDoneBlockers log line is now "dropped satisfied blocker ref(s)".
- The old consumeReviewerRun call in the to-live-test branch is kept as stale-armed-marker hygiene; it is a no-op in the normal flow.
- Test stubs updated to the new transitions; part F repurposed to the unmerged-branch bounce; part G reworked (reviewer lingers past the cap advance, merger defers, live tester runs with cwd=root); new part AH2 covers blocker satisfaction for a to-live-test/live-testing blocker. The stub role checks are exclusive if/else-if now, because the merger prompt mentions the Live-tester.
- Deliberately untouched (outside the spec file list): README.md and SPECS.md still describe the old order (README states line 66 and per-state lines 75-79; SPECS.md lines 37-46 and 58-75). Follow-up for the PM.
- The PM restarts the orchestrator daemon to pick up the new order.

Review pass (commit be932c9):
- Fixed one defect vs the Notes' documented edge: the to-live-test sweep guarded the unmerged-branch route with `task.worktree &&`, so a to-live-test task with no worktree attr fell through to a live-tester spawn on the root checkout instead of routing to to-merge (verified with a fixture daemon run before the fix: it spawned live-testers that tested main without the task's change). The condition is now `!task.worktree || merge-base ... === null`, with a distinct "no worktree, moving to to-merge" log line. This also keeps the invariant the code comment itself states (main is never tested without the task's merged change) and matches the pre-existing branch-less handling (sweepToMerge's nothing-to-merge path sets done without a live test).
- Test changes with the fix: part F gains a worktree-less to-live-test task asserting the to-merge route and done without a live test; part AH2's blocker task now carries a merged branch (branch at HEAD), because worktree-less to-live-test tasks no longer cycle in the live-test states. Full suite green, two consecutive npm test runs.
- Spec coverage checked against the diff: reviewer cap -> to-merge (log line and counter reset move with it), merge -> to-live-test, live-test pass -> done with no merger spawn, live-test findings -> PM tasks with the causing task's issuer, bounce re-mapping (live-testing -> to-live-test, merging -> to-merge), blocker satisfaction for to-live-test/live-testing/done refs, in-flight tasks (unmerged to-live-test task requeued to to-merge, to-merge still merges, live-testing pass never re-merges), SKILL.md order statement. All present.
- Residual risk noted, no fix (pre-existing kind of risk, outside this task's scope): a merger that sets to-live-test and then hangs keeps the global merger pid alive, and the live-tester spawn defers on `agentAlive(root, "merger")` with no stall check for to-live-test state agents (the stall check samples WORKING_STATES only). The task waits until the merger process exits. The old order had the same class of wedge (a hung merger blocked all future merger spawns).
- Stated, not silent: README.md/SPECS.md staleness is documented above as a PM follow-up. The agents/*.md prompt changes (reviewer, merger, live-tester) go beyond the spec's file list but are required by it: the pipeline order lives in those prompts.
- Second review pass (no fixes): re-verified spec coverage against `git diff main...HEAD` and the code. Reviewer cap -> to-merge with the log line and counter reset moved and the armed-marker machinery kept (consumeReviewerRun now at the sweepToMerge head, so the approval and the cap advance both count exactly once); merger sets merging -> to-live-test; live tester spawns with cwd=root on the merged commit; live-testing -> done on pass with no merger spawn; findings travel as PM tasks with the task still moving to done; WORKING_STATES bounce re-map (live-testing -> to-live-test, merging -> to-merge); one shared BLOCKER_SATISFIED set (done, to-live-test, live-testing) used by blockedByUndone and dropDoneBlockers, to-merge/merging still blocking, conflicted files never proving satisfaction. Unmerged-branch and no-worktree to-live-test tasks route to to-merge (condition `!task.worktree || merge-base --is-ancestor ... === null`), so an in-flight task from an old-order daemon never gets main tested unmerged. Full suite green on this pass: npm test (kanban, orchestrator, webui, extension, index).
- Verified the stub-ordering risk from the Notes: every test stub checks Merger before Live-tester now (the merger prompt mentions the Live-tester); the loopStub's merger branch exits before its Live-tester check. Suite green confirms no misroute.
- README.md and SPECS.md still describe the old order (README lines 66 and 75-79; SPECS.md lines 37-46 and 58-75), confirmed still stale. No board task exists for it yet: the PM may want to file one docs task for both files.
