---
name: "feat: rebase merge flow; fast-forward merges only, linear main"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "rebase-merge-flow"
---

# Summary
Replace the two-step merge (main into branch, branch into main as a merge commit) with rebase the branch on main, then merge the branch into main with --ff-only, so main history stays linear. The orchestrator's serialized merge lane plus a back-to-back rebase and ff-merge guarantees the final fast-forward, and a retry re-rebases when main moved. Documentation and merge-flow tests follow.

# Specs
Requested by the user: the merge path changes from merge-then-merge to rebase-then-fast-forward, so main history stays linear with no merge commits.

Current flow (src/orchestrator/pipeline.ts, sweepToMerge() at :58):
- Nothing-to-merge fast path :76-81: no worktree and no branch -> set done. Unchanged.
- Detached-root guard :84-88: git branch --show-current at root empty -> left in to-merge. Unchanged.
- Step 1 :96-97: git merge --no-edit main in the worktree (hardcoded "main" string).
- Conflict detection :98-107: probes rev-parse --verify -q MERGE_HEAD; on conflict spawns the Merger (setState(merging)); other failures requeue.
- Step 2 :113-120: git merge --no-edit <branch> at the root (creates a merge commit); on failure runs git merge --abort, records the attempt marker, requeues.
- Step 3 :122-126: git merge --ff-only main in the worktree (branch sync); then setState(to-live-test).
- Attempt marker and idle cooldown :72-73; RESPAWN_CAP = 5 (src/orchestrator/config.ts:11); doneCleanup :132-157 (merge-base --is-ancestor, branch -d).

New flow (user, 2026-10-13):
- Step 1: git rebase <base> in the worktree. <base> is the root checkout's current branch, resolved live per operation (per #102, never a hardcoded main; reconcile the existing hardcoded "main" string with the live resolution). The detached-root guard stays.
- Conflict handling: a rebase does not set MERGE_HEAD, so conflict detection switches to rebase state (REBASE_HEAD or the rebase-merge directory). On a conflict the Merger agent resolves as today, then stages the files and runs git rebase --continue to conclude the replayed commit (never git rebase --abort). A rebase can stop once per replayed commit: spawn the Merger per conflict round until the rebase completes.
- Step 2: git merge --ff-only <branch> at the project root. No merge commit is created: main becomes the branch's replayed commits on top of the previous main head.
- Step 3 disappears: after the rebase and the ff-merge, the worktree branch head IS the merged commit, so the old branch sync is a no-op by construction.
- On --ff-only failure nothing is in progress, so do not run git merge --abort; record the attempt marker, requeue to to-merge, and the retry runs a fresh rebase then the ff-merge (existing cooldown and cap).

Scheduling guarantee for the final fast-forward (user requirement):
- The merge lane stays serialized, one merger operation at a time per project (#78).
- The rebase and the ff-merge run back-to-back within the same serialized operation, so no other merge can interleave between them. A branch rebased in operation N is merged in the same operation N, before operation N+1's rebase sees main.
- The only remaining way main moves between rebase and ff-merge is a change outside the daemon (hand push); the requeue-and-retry path covers it.

Constraints:
- The worktree branch keeps all its commits; the rebase replays them. No squash.
- The nothing-to-merge fast path and the detached-root guard are unchanged.
- doneCleanup is unchanged: after the ff-merge the branch is an ancestor of main, so is-ancestor and branch -d still hold.
- The conflict policy carries over (#113): the test suites run only when conflicts were resolved, clean merges stay fast.
- Reduced changes elsewhere: the .kanban mirror plumbing, spawn files, and liveness transitions (merging -> to-merge) are untouched.

Documentation to fix (user requirement):
- README.md:77 (and :76, :78-80 where they describe the steps): replace "merges main into the task branch in the worktree ... then it merges the branch into main ... then it fast-forwards the worktree to the merged commit" with the rebase + ff-only flow.
- SPECS.md: the working-tree symlink is broken, so read the file from git history; update its merge-flow wording to the rebase + ff-only flow.
- agents/merger.md: reword the conflict flow: the orchestrator started a rebase of <base> onto the branch, resolve the conflicts, stage, run git rebase --continue, never abort, the base branch wins.
- skills/se-llm-team/SKILL.md:3 and :18 ("merges approved branches into the base branch itself", "the Merger only resolves merge conflicts"): update only where the text describes the old two-step merge.

Tests (tests/orchestrator.test.ts) to rework for the new flow:
- Part A :238, :265 ("merged into main, set to-live-test" log wording), :280; parts E/F :385, :575-578; part G :654-664 (merger-defer timing).
- Part K :760: conflict left in progress :843 (markers appear during the rebase), MERGE_HEAD retry probe :853-855 (becomes rebase-state probe), done :864.
- Part K2 :871 (checkout --theirs stub :781).
- Part K3 :876: simulates main moving with a post-merge hook that fires on the step-1 worktree merge commit (:921, :929-930, :950). A fast-forward merge does not fire post-merge, so rework the race mechanism (for example a post-rewrite hook, which fires after a rebase).
- Part K4 :957 (expects the "merge into main failed" log :984 and no MERGE_HEAD :988; becomes the ff-only refusal path and no rebase in progress), part K5 :990 (:1003).
- No test asserts commit parents or history shape today.

Acceptance:
- node tests/kanban.test.ts, node tests/orchestrator.test.ts and node tests/webui.test.ts all pass.
- Real-daemon fixture check: a task merged through the new flow leaves git log --merges <base> with no new merge commits, the branch's commits sit on top of the previous main head, and a second sequential task's merge fast-forwards cleanly.
- Docs check: README.md, SPECS.md and agents/merger.md no longer describe a worktree merge of main into the branch or a merge commit on main.

# Notes
