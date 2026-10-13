---
name: "feat: rebase merge flow; fast-forward merges only, linear main"
priority: "high"
state: "done"
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

Implemented the rebase merge flow (commit rebase-merge-flow):

- Rewrote `sweepToMerge()` in src/orchestrator/pipeline.ts: the base branch is resolved once at the detached-root guard (`git branch --show-current` at the root, per #102) and reused for the rebase. Step 1: `git rebase <base>` in the task worktree; on failure the flow writes the attempt marker, detects a stopped rebase via `git rev-parse --git-path rebase-merge` (resolved with `isAbsolute` against the worktree dir; REBASE_HEAD is not used, it lingers after a completed rebase on git 2.43) and spawns the Merger with the task in merging, otherwise logs "rebase failed, left in to-merge for the retry". Step 2: `git merge --ff-only <branch>` at the project root; on failure the marker is written and the task requeues with no `git merge --abort`. Then to-live-test with "fast-forwarded <base> to <branch>, set to-live-test". The old three steps (worktree merge of main, root merge --no-edit, worktree ff-only sync) are gone.
- Rewrote agents/merger.md for the rebase flow: resolve only the conflicts, the base branch's side is `--ours`, stage and conclude with `GIT_EDITOR=true git rebase --continue`, never `git rebase --abort`; repeat per conflict round.
- Updated README.md merge-flow bullets and skills/se-llm-team/SKILL.md line 18 to the rebase + ff-only flow.
- Reworked tests/orchestrator.test.ts: all conflict-resolving stubs (roleStub, cmd-merger.cjs, slow-merger.cjs, argvStub) use the rebase form (`git checkout --ours` + `GIT_EDITOR=true git rebase --continue`); merge-success asserts use the new per-branch wording; part K3's main-moves-mid-merge race moved from a post-merge to a post-rewrite hook (a fast-forward fires no post-merge) with `autoScheduleMinutes: 0.08` so the retry runs, plus asserts that main carries no merge commits and the exact linear history; part K2 gained a no-merge-commits-on-main assert; part K4 now covers the ff-only refusal on a dirty root (no MERGE_HEAD, no rebase-merge dir, no merger spawn, marker written); part AL's merger-prompt asserts follow the rewritten merger.md.
- npm test fully green (kanban, orchestrator, webui, extension, index suites), exit 0.
- The merge commit 5b55b26 is unsigned: the gpg agent was unreachable from the worktree session (read-only ~/.gnupg); prior commits in the repo are signed, so the merger or PM may want to note the signature gap.

# Open questions

None. Assumptions made (confirm or correct):

- The base branch for both the rebase and the fast-forward is the project root checkout's current branch, resolved live per merge operation (per #102); a detached root refuses the merge and waits for the PM.
- "Fast-forward merges only" means `git merge --ff-only` from the project root after the rebase; a dirty root checkout refuses it and the task requeues with the attempt marker.
- A conflict resolution that nullifies every replayed commit can silently drop those commits (git's default empty-commit handling); the branch keeps its commits only where the resolution leaves content.
- The conflict policy from #113 carries over: test suites run only when conflicts were resolved, clean merges stay fast.

Review (reviewer session, fix commit 80f843d, unsigned):

- Verified the git-behavior claims on git 2.43: a stopped rebase leaves the rebase-merge directory (an absolute path in a linked worktree; the isAbsolute branch covers the relative shape), a rebase already in progress fails with exit 128 and leaves the directory intact, so the conflict path respawns the Merger; REBASE_HEAD lingers after a completed rebase, so the rebase-merge probe is the right check; a replayed commit that becomes empty is dropped with exit 0 (no stop round), which confirms the empty-commit assumption above.
- Confirmed the rebase conflict semantics: --ours is the base side, --theirs is the replayed commit; all merger stubs in tests/orchestrator.test.ts use the rebase form. No old-flow strings (merge --no-edit, merge --abort, a MERGE_HEAD success probe, "merged into main") remain in src/ or tests/.
- Ran the acceptance suites: orchestrator exit 0 (all smoke parts), webui exit 0, kanban three passes exit 0.
- Confirmed all four assumptions above against the code and observed git behavior.
- Review finding, fixed in 80f843d: agents/live-tester.md still told the live-tester the orchestrator "synced your worktree to the merged commit" (the old step-3 sync). Reworded to the rebase-flow outcome: the worktree is at the merged commit. No test asserts the old text.
- Review finding, fixed outside the diff: .kanban/AGENTS.reviewer.md still carried the old convention (a task branch merges main into itself before to-merge; "the Merger then fast-forwards or merges cleanly"). Rewrote the section for the rebase flow. .kanban/AGENTS.live-tester.md keeps the #187/#189 merge-flow recipes as historical records; left untouched.
- SKILL.md line 3 stays unchanged, correctly: "merges approved branches into the base branch itself" holds under the rebase flow.
- Main moved past this branch's base during review (main at 7553736, task #200). No pre-merge: the orchestrator's rebase handles a moved base at merge time, and #200 (webui CSS) cannot conflict with this change.

Review 2 (reviewer session, no fixes):

- Re-read the full diff and re-checked all acceptance points: pipeline.ts carries the live base resolution, the rebase + ff-only steps, the rebase-merge conflict probe with the isAbsolute handling, no abort on a failed fast-forward, and no step-3 sync. No old-flow strings (merge --no-edit, merge --abort, MERGE_HEAD, "merged into main", a worktree sync step) stay in src/, tests/, README.md, agents/ or skills/.
- Confirmed the untouched surfaces: liveness.ts has no merge-flow logic (state machine only), and .kanban/AGENTS.merger.md and .kanban/AGENTS.developer.md are empty templates, so no old recipes live there. .kanban/AGENTS.live-tester.md keeps historical recipes only.
- Ran npm test: all five suites green, exit 0.
- No new findings. The task is ready to merge. Main is at 7553736 (task #200, src/webui only); the rebase at merge time covers it, and no file overlap exists with this branch's six files.

Merger (merge of main into the branch, commit 2b5cd9b, unsigned):

- The orchestrator's merge of main (7553736: #197 board hygiene, #200 webui) into the branch stopped on conflicts in src/orchestrator/pipeline.ts and tests/orchestrator.test.ts. A previous merger run had already resolved and staged all five files but exited before the commit; this run verified the staged resolution and concluded the merge. Resolution checked: main's #197 change (rescan re-reads the board before dropDoneBlockers/promoteBacklog, promoteBacklog comment reworded) sits in the branch's rewritten pipeline.ts with the rebase sweepToMerge untouched; the webui files and webui.test.ts carry main's #200 changes only; main's part AW test (same-sweep unblock) appends after the branch's reworked tests. No conflict markers and no old-flow strings (merge --no-edit, merge --abort, MERGE_HEAD success probe) remain in the merged tree; the webui files are byte-identical to main.
- The merge commit 2b5cd9b is unsigned for the same reason as 5b55b26: the gpg agent is unreachable from the worktree session (read-only ~/.gnupg).

Live test (live-tester session, merged commit 2b5cd9b):

- Harness: a scratch bare origin, a clone with a scratch board, an isolated HOME, and a role-aware fake agent. The daemon ran the merged `src/orchestrator.ts` from this worktree with `--root <fixture> --rescan-seconds 1 --poll-minutes 0.05` and `autoScheduleMinutes: 0.05`. The fixture root branch was `trunk`, not `main`. Each probe task was a `to-merge` task with an existing worktree, so the real daemon drove the real merge path. The fake agent identified its role from the `-p` prompt, so every spawn, cwd and prompt was observable.
- Clean merge, two tasks in sequence: b1 and b2 both rebased and fast-forwarded (`fast-forwarded trunk to b1/b2, set to-live-test`). `git rev-list --merges <base>..trunk` is 0, every new commit has exactly one parent, and each branch tip sits on top of the previous root head. No merger was spawned.
- Conflict path: b3 changed `shared.txt` against b1's change. The rebase stopped, the daemon logged `rebase conflicts, merger spawned to resolve them`, and the merger ran with cwd `.worktrees/b3`. It resolved with `git checkout --ours` plus `git add` plus `GIT_EDITOR=true git rebase --continue`, never an abort. The retry fast-forwarded trunk to b3. The base side won (`shared.txt` = `b1`).
- Per-round merger spawn: b6 carried two commits that both conflict. Round 1 stopped on `shared.txt`, the merger resolved it and exited 0 (`merging -> to-merge`). The retry found the rebase still in progress (exit 128) and spawned a second merger process (new pid, same cwd). Round 2 stopped on `file_e.txt`, the second merger resolved it and exited 0. The third pass fast-forwarded trunk to b6. Both replayed commits are present and non-empty, because each one also added a unique file that `--ours` does not nullify.
- Fast-forward refusal on a dirty root: b4 changes `dirty.txt` and a local edit to the same file sat at the root. `git merge --ff-only b4` failed with git's own message (`... would be overwritten by merge ... Aborting`). The task stayed in `to-merge` with the attempt marker. No `MERGE_HEAD` and no rebase state existed after the refusal, so no abort command ran. After `git checkout -- dirty.txt`, the retry (after the cooldown) fast-forwarded trunk to b4.
- Live base resolution (#102): the daemon merged into the checked-out branch `trunk` and never touched `main`. This proves the base is read from the root checkout, not hardcoded.
- Live-tester spawn after the merge: for b1, b2 and b6 the live-tester cwd was the task worktree and its HEAD equalled the root HEAD, so the worktree was at the merged commit with no separate sync step.
- Prompt delivery: the recorded `-p` payloads for the merger and the live-tester are byte-identical to the shipped `agents/merger.md` and `agents/live-tester.md` at the merged commit.
- Docs: at the merged commit, README.md, agents/ and skills/ carry no old-flow wording. SPECS.md does not exist at HEAD (deleted in b5e551c, an ancestor of this branch), so the docs bullet "SPECS.md no longer describes a worktree merge of main into the branch" holds vacuously. This is the only Specs item that contradicts the current tree: the file named in the docs check is gone.
- Live-test assumptions: the fake merger always resolves with `--ours` (the documented policy), the fixture root branch is `trunk`, and a fake live-tester sleeps so the merged worktree and branch stay inspectable. No user flow of the change was left unrun.
- Findings: none. The change behaves as the Specs describe. No Project-manager follow-up task is needed. The only technical difficulty was in my own first fixture attempt (the setup script deleted the fake agent), which is not a product issue.
