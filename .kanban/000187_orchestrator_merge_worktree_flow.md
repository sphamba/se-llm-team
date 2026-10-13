---
name: "feat: orchestrator merges itself; all agents spawn in their worktrees"
priority: "high"
state: "doing"
worktree: "feat/187-orchestrator-merge-worktree-flow"
issuer: "user"
complexity: "complex"
shortName: "orchestrator-merge-worktree-flow"
blockedBy: ""
---

# Summary
Rework the merge pipeline and the worktree lifecycle. The orchestrator runs the git merges itself and updates the task status on successful agent finish; only the reviewer keeps its state decision. The merger agent only resolves conflicts. All four roles spawn with cwd in the task worktree. The worktree lives until done.

# Specs
## Spawn cwd (spawnAgent and its call sites)
- developer, reviewer: unchanged (cwd = worktree dir).
- merger: spawn with cwd = worktree dir, not root (sweepToMerge).
- live-tester: spawn with cwd = worktree dir, not root (the to-live-test branch of rescan).
- The {{WORKTREE}} prompt placeholder now resolves for merger and live-tester (spawnAgent fills it when cwd is not root).
- A task with no worktree attr keeps today's behavior: to-live-test bounces to to-merge; to-merge with nothing to merge goes done with "nothing to merge".

## Exit-code detection (spawnAgent, poll)
- spawnAgent records the agent's exit code: wrap the agent command (sh -c 'agent ... ; echo $? > <path>') writing <slug>.exit next to the pid file, or an equivalent mechanism.
- poll, pid gone: read the exit file. Exit 0 = successful finish: the orchestrator sets the task state to the role's next state (developer -> to-review, merger -> to-merge, live-tester -> done) and clears the pid and exit file. Non-zero or missing = crash: today's dead-pid bounce (WORKING_STATES bounce, dead marker, cooldown, RESPAWN_CAP).
- The reviewer is the exception: it keeps its own state decision (to-merge or back to to-review) via kanban_set_state, so the orchestrator does nothing on its successful finish (the task has already left reviewing). If it exits 0 with the task still in reviewing, leave it for the PM.
- One exit file per task at a time; the state-move hook removes leftovers (janitorPids can sweep strays).

## to-merge flow (sweepToMerge)
Replace the "always spawn a merger" flow with:
1. Keep the gates: reviewer-armed marker, defer while the task's own agent lives, defer while a global merger agent lives, dead cooldown, per-task idle-cooldown marker, ensureWorktree.
2. Orchestrator merges base into the task branch: git -C <worktreeDir> merge --no-edit main.
   - Success: orchestrator merges the branch into main: git -C <root> merge --no-edit <branch>. Then sync the branch to the merged commit: git -C <worktreeDir> merge --ff-only main (a no-op on a fast-forward; needed when the branch-to-main merge made a merge commit, so the live test runs the merged code). Then set the task to to-live-test. Do not delete the worktree. No merger agent spawns on this path.
   - Failure (conflicts): leave the merge in progress in the worktree (do not abort), write the idle-cooldown attempt marker, set mergerLogSlug, spawn the merger (cwd = worktree dir, pidName "merger"), set the task to merging.
   - If the branch-to-main merge at root fails (rare; main moved between the two steps): git -C <root> merge --abort, write the attempt marker, leave the task in to-merge. The next sweep retries after the idle cooldown.

## merger role (agents/merger.md rewrite)
- The merger only resolves the merge conflicts that the failed orchestrator merge left in its worktree, then git commit to conclude the merge. No state moves at all: the orchestrator sets merging at spawn and moves the task back to to-merge on the merger's successful finish (exit 0).
- It starts no merge itself and runs no test suites (the orchestrator retry and the live test validate). It touches only its worktree. Keep: the open-questions section, and the placeholder set. The kanban_set_state re-read guard line goes (no state moves).

## agent prompts drop the state moves
- agents/developer.md: step 5 (set to-review) dropped; the orchestrator moves the task on the developer's successful finish. The kanban_set_state re-read guard line goes.
- agents/live-tester.md: step 3 (set done) dropped; the orchestrator sets done on the live-tester's successful finish. Step 4 (Notes append) and step 5 (findings reported to the PM subagent, which uses kanban_list and kanban_create) stay.
- agents/reviewer.md: steps 5 and 6 stay (the exception: to-review with fixes, to-merge without). The step-6 prose updates to the new flow (the orchestrator merges; the merger only resolves conflicts).

## merging and liveness (keep)
- merging stays owned by the merger agent's liveness poll. WORKING_STATES still maps merging -> to-merge and live-testing -> to-live-test for the crash bounce. pidName "merger" for merging, slug for the rest. RESPAWN_CAP, dead markers, stall detection, janitorPids, global-merger-pid cleanup, and attempt-marker cleanup for non-merge states: unchanged.
- After the orchestrator moves the task back to to-merge (merger exit 0), the next sweep retries the merge through the existing idle-cooldown marker. If conflicts repeat, the loop stays bounded by the cooldowns and RESPAWN_CAP.

## done (doneCleanup, keep)
- doneCleanup already removes the worktree, deletes the branch, clears the attr, and commits on every done sweep. No change. This stays the only worktree deletion point.

## to-live-test
- Spawn the live-tester in the still-existing worktree. It tests the merged commit there (the branch is synced to main after the ff-only sync). Keep: no code edits, the findings flow. agents/live-tester.md: update the "runs from {{ROOT}} on the merged commit" wording to the worktree.

## Tests (tests/orchestrator.test.ts)
- A (happy pipeline): no merger agent on the clean path; the orchestrator moves the developer's task to to-review and the live-tester's to done (agents no longer set states); no merger pid file appears.
- B/I (dead bounce): a non-zero or missing exit file bounces as today.
- G: the live-tester cwd assert changes from the root to the worktree dir; the done move is the orchestrator's (exit 0), not the agent's; worktree removed at done stays.
- K: the conflict path spawns the merger (cwd = worktree); after the merger commits and exits 0 the orchestrator moves to-merge and the retry succeeds; the requeue + idle-cooldown retry and indexed merger logs stay.
- K2: single-merger serialization and both worktrees cleaned stay.
- AL (merger prompt suite-skip on a clean merge): remove or rework. A clean merge spawns no merger.
- New: the exit-file mechanism (exit 0 recorded, read once, cleared after the state move).
- New: when main moves ahead between the two orchestrator merges, the branch lands on the merge commit (ff-only sync) and the live test runs that commit.
- Fold the #188 test rework (D, spawn-args, renderPrompt, tool asserts) together with these where they touch the same helpers.

## Docs
- README.md: the per-state behavior for to-merge/merging/done (who merges, who moves states, worktree lifetime) and the agent cwd table (merger, live-tester now in the worktree).
- skills/se-llm-team/SKILL.md: description and pipeline text; the orchestrator runs the merges and moves the states on successful agent finish; only the reviewer keeps its state decision; the merger only resolves conflicts.

# Notes
