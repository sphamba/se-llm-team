---
name: "feat: orchestrator merges itself; all agents spawn in their worktrees"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "orchestrator-merge-worktree-flow"
blockedBy: "#186"
---

# Summary

Rework the merge pipeline and the worktree lifecycle. The orchestrator runs the git merges itself. The merger agent only resolves conflicts. All four roles spawn with cwd in the task worktree. The worktree lives until done.

# Specs

## Spawn cwd (spawnAgent and its call sites)
- developer, reviewer: unchanged (cwd = worktree dir).
- merger: spawn with cwd = worktree dir, not root (sweepToMerge).
- live-tester: spawn with cwd = worktree dir, not root (the to-live-test branch of rescan).
- The {{WORKTREE}} prompt placeholder now resolves for merger and live-tester (spawnAgent fills it when cwd is not root).
- A task with no worktree attr keeps today's behavior: to-live-test bounces to to-merge; to-merge with nothing to merge goes done with "nothing to merge".

## to-merge flow (sweepToMerge)
Replace the "always spawn a merger" flow with:
1. Keep the gates: reviewer-armed marker, defer while the task's own agent lives, defer while a global merger agent lives, dead cooldown, per-task idle-cooldown marker, ensureWorktree.
2. Orchestrator merges base into the task branch: git -C <worktreeDir> merge --no-edit main.
   - Success: orchestrator merges the branch into main: git -C <root> merge --no-edit <branch>. Then sync the branch to the merged commit: git -C <worktreeDir> merge --ff-only main (a no-op on a fast-forward; needed when the branch-to-main merge made a merge commit, so the live test runs the merged code). Then set the task to to-live-test. Do not delete the worktree. No merger agent spawns on this path.
   - Failure (conflicts): leave the merge in progress in the worktree (do not abort), write the idle-cooldown attempt marker, set mergerLogSlug, spawn the merger (cwd = worktree dir, pidName "merger"), set the task to merging.
   - If the branch-to-main merge at root fails (rare; main moved between the two steps): git -C <root> merge --abort, write the attempt marker, leave the task in to-merge. The next sweep retries after the idle cooldown.

## merger role (agents/merger.md rewrite)
- The merger only resolves the merge conflicts that the failed orchestrator merge left in its worktree, then git commit to conclude the merge, then sets the task back to to-merge.
- It starts no merge itself and runs no test suites (the orchestrator retry and the live test validate). It touches only its worktree.
- The orchestrator sets state merging at spawn; the merger no longer sets it. Keep: re-read before each kanban_set_state, the open-questions section, and the placeholder set.

## merging and liveness (keep)
- merging stays owned by the merger agent's liveness poll. WORKING_STATES still maps merging -> to-merge and live-testing -> to-live-test. pidName "merger" for merging, slug for the rest. RESPAWN_CAP, dead markers, stall detection, janitorPids, global-merger-pid cleanup, and attempt-marker cleanup for non-merge states: unchanged.
- After the merger commits and moves the task to to-merge, the next sweep retries the merge through the existing idle-cooldown marker. If conflicts repeat, the loop stays bounded by the cooldowns and RESPAWN_CAP.

## done (doneCleanup, keep)
- doneCleanup already removes the worktree, deletes the branch, clears the attr, and commits on every done sweep. No change. This stays the only worktree deletion point.

## to-live-test
- Spawn the live-tester in the still-existing worktree. It tests the merged commit there (the branch is synced to main after the ff-only sync). Keep: no code edits, step 3 sets done whatever the test result, the findings flow. agents/live-tester.md: update the "runs from {{ROOT}} on the merged commit" wording to the worktree.

## Tests (tests/orchestrator.test.ts)
- A (happy pipeline): no merger agent on the clean path; assert the orchestrator merged branch into main and moved to to-live-test, and that no merger pid file appears.
- G: the live-tester cwd assert changes from the root to the worktree dir; worktree removed at done stays.
- K: the conflict path spawns the merger (cwd = worktree), the requeue + idle-cooldown retry and indexed merger logs stay; add: after the merger resolves and the retry fires, the orchestrator merge succeeds and no merger runs again.
- K2: single-merger serialization and both worktrees cleaned stay.
- AL (merger prompt suite-skip on a clean merge): remove or rework. A clean merge spawns no merger.
- Add one test: when main moves ahead between the two orchestrator merges, the branch lands on the merge commit (ff-only sync) and the live test runs that commit.

## Docs
- README.md: the per-state behavior for to-merge/merging/done (who merges, worktree lifetime) and the agent cwd table (merger, live-tester now in the worktree).
- skills/se-llm-team/SKILL.md: description and pipeline text; the merger now only resolves conflicts; the orchestrator runs the merges.

# Notes
