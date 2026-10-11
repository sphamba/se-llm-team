---
name: "fix: the merger merges the root checkout's current branch, not a hardcoded main"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
Worktrees and merges must base on the HEAD of the checkout the PM and orchestrator were spawned from, resolved live per operation - never a hardcoded main. The orchestrator side already does this; the hardcode lives in agents/merger.md's two merge steps (reworked by #78).

# Specs
User decisions settled: the base is resolved LIVE per operation (every worktree creation and merge resolves the root checkout's current HEAD/branch at that moment; nothing pinned); the merge target is whatever branch the root has checked out at merge time, even if it moved since spawn.

Facts (main 35ba118 + #78's clean worktree 50b42de, verified): ensureWorktree src/orchestrator.ts:552-566 creates with `git(root, ["worktree","add", join(".worktrees",wt), "-b", wt], true)` - no start-point, so the branch bases on the root checkout's live HEAD (whatever branch is checked out); mergeDone :594-631 merges with `git(root, ["merge","--no-edit", branch])` :607 - into whatever branch the root has checked out (HEAD of cwd=root). Nothing in src/orchestrator.ts hardcodes "main" (grep: zero literal matches). #78 (reviewing, worktree .worktrees/feat/78-to-merge-and, clean) rewrites the flow: toMergeSweep :605-638 (global merger pid gate, idle cooldown, ensureWorktree + spawnAgent merger cwd=root) and doneCleanup :642-666 (`git merge-base --is-ancestor wt HEAD`, HEAD-relative - fine). agents/merger.md (as rewritten on #78's branch) :12-13 hardcodes main twice: step 1 `git merge main` in the worktree; step 2 `git merge --no-edit {{WORKTREE_NAME}}` in the project root; :17 abort via `git merge --abort`. The orchestrator records no base state in .kanban/; root comes solely from --root argv.

Changes:
1. agents/merger.md: replace both hardcoded merge steps with live resolution - the merger resolves the base branch of the project root checkout at the start of each merge (e.g. `git -C {{ROOT}} branch --show-current`); step 1 merges that resolved base into the task's branch in the worktree; step 2 merges the task branch into the base branch from the project root (which is the checked-out branch by construction). Detached HEAD in the root: no branch to resolve - log a warning, refuse the merge, leave a Note, requeue to to-merge (never merge into an unexpected place; the PM resolves manually).
2. The abort/requeue path stays `git merge --abort` in whatever repo is dirty before requeueing (unchanged from #78).
3. README.md: the merge-flow wording says "the project root's current branch" instead of main (both merge steps), and notes the detached-HEAD refusal.
4. No orchestrator.ts change on main: ensureWorktree (live HEAD base) and the merge-into-checked-out-branch behavior already match; doneCleanup's HEAD-relative merge-base already matches.

Tests: the merger prompt template change is verified by the live test; orchestrator.test.ts's to-merge coverage (from #78) must stay green; no new orchestrator test needed (no code change).

Acceptance: a merger run against a root checked out on any branch X merges X into the task branch and the task branch into X; a detached root refuses with a Note; full suite green.

Constraints:
- Files: agents/merger.md, README.md.
- HOLD behind #78 (reviewing on feat/78-to-merge-and, which rewrites agents/merger.md - this task rebases its two merge steps on the merged #78 text).

# Notes

- Verified the hold is lifted: #78 (agents/merger.md rewrite) is merged (01136ea), so this task landed on the post-#78 text. Worktree HEAD matched main (d93e444) before the change.
- Verified no orchestrator.ts change is needed on the current main: ensureWorktree creates with `worktree add -b wt` (no start-point, live HEAD base), doneCleanup uses `git merge-base --is-ancestor wt HEAD` (HEAD-relative), and grep finds zero literal "main" in merge logic.
- agents/merger.md: replaced both hardcoded merge steps with live resolution. Both steps now resolve the base branch of the project root checkout at the start of the step (`git -C {{ROOT}} branch --show-current`); step 1 merges that base into {{WORKTREE_NAME}} in the worktree, step 2 re-resolves (the root may have moved) and merges {{WORKTREE_NAME}} into the resolved base from the project root. Added the detached-HEAD refusal: no merge, warning in the final output, a Note that the root checkout is detached, requeue to to-merge; the PM resolves manually. The abort/requeue path (`git merge --abort` in the dirty repo) is unchanged from #78.
- README.md: the merging-state line now says the merger resolves the project root's current branch at the start of each merge (both merge steps) and notes the detached-HEAD refusal.
- Tests: node src/kanban.test.ts (all assertions passed), node src/orchestrator.test.ts (16 smokes passed, includes #78's to-merge coverage), node src/webui.test.ts (all assertions passed). First webui run failed because it was launched with SE_LLM_TEAM_NO_WEBUI=1, which the webui test does not expect; rerun without it passed. The merger prompt change itself is verified by the live test per the specs.
- Commit bd37fb2 on fix/102-the-merger-merges (2 files, +7/−4).
- Review pass: diff main...HEAD touches only agents/merger.md and README.md, as the constraints require. Both merge steps now resolve the base with `git -C {{ROOT}} branch --show-current` (step 2 re-resolves, since the root may have moved), the detached-HEAD path refuses, leaves a Note, and requeues to to-merge, and the `git merge --abort` requeue path is unchanged. README merging-state wording matches. Diff vs main for src/ is empty, as spec item 4 requires. Reran all three suites in the worktree: kanban.test.ts, orchestrator.test.ts, webui.test.ts (without SE_LLM_TEAM_NO_WEBUI) all green.
- Review finding (cosmetic, left out of scope): src/orchestrator.ts comments at :606, :641, :661 still say the merger merges main ("merges main into the branch worktree and then the branch into main", "merged the branch into main before setting", "content is already in main"). Constraints limit this task to agents/merger.md and README.md and spec item 4 forbids an orchestrator.ts change, so these prose comments stay; they describe behavior that is now branch-agnostic and should be reworded in a future docs pass.
- Review verdict: no fixes needed, ready for live test.
- Live test (pass): ran the worktree's orchestrator (`node src/orchestrator.ts --root <fixture> --no-webui`) so it read this branch's agents/merger.md, against two throwaway git roots. Fixture A: root checked out on branch `alt` (not main; `main` had an unmerged main-only commit, `alt` had an alt-only commit, the task branch `fix/1-demo` had a task commit). The spawned merger ran step 1 as `cd .worktrees/fix/1-demo && git merge alt --no-edit` and step 2 as `cd <root> && git merge --no-edit fix/1-demo`; both resolved `alt` at step start (`git -C <root> branch --show-current`). Result: `alt` gained the task commit, `main` stayed untouched, the orchestrator logged `merged fix/1-demo` and removed the worktree and branch, state `done`. Fixture B: root detached at `alt`'s tip. The merger ran no merge (log has only `branch --show-current`/status checks), left a Note that the root checkout is detached, set the state back to `to-merge`, and left every ref unchanged. No issue found.
- Suites rerun in the worktree: `node src/kanban.test.ts` (all assertions passed), `node src/orchestrator.test.ts` (exit 0, 16 smokes passed), `node src/webui.test.ts` with `SE_LLM_TEAM_NO_WEBUI` unset (all assertions passed).
- Live-test verdict: pass. No new tasks needed.