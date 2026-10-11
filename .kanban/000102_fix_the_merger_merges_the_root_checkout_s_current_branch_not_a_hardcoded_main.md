---
name: "fix: the merger merges the root checkout's current branch, not a hardcoded main"
priority: "medium"
state: "doing"
worktree: "fix/102-the-merger-merges"
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
