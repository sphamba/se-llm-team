---
name: "test: orchestrator.test.ts part D worktree git-status assertion is flaky"
priority: "low"
state: "live-testing"
worktree: "test/orchestrator-test-ts-part-d-worktree-git-status-assertion-is-flaky"
---

# Summary
Part D of src/orchestrator.test.ts is flaky: the "worktree git status shows no .kanban entries" assertion failed once and passed on re-run, because the test asserts git status right after polling for the .kanban symlink, while the daemon's syncBoard finishes the wt-excludes configuration a few steps after symlink creation. Make the test wait for the settled state before asserting. Test flakiness only, not a product defect (settled state verified correct).

# Specs
File: src/orchestrator.test.ts, part D — the execSync("git status --porcelain") check right after the waitFor for the worktree board symlink, around line 276; assertion: "worktree git status shows no .kanban entries".

Failure observed: assertion failed once in a live test of task 'chore: merge origin/main into main' and passed on re-run.

Race explanation: the test polls every 250 ms for the .kanban symlink and then immediately runs `git status --porcelain`. The daemon's syncBoard writes the per-worktree wt-excludes file and runs `git config extensions.worktreeConfig` / `git config --worktree core.excludesFile` a few steps AFTER the symlink is created. When the test's poll lands in that window, git still shows the symlink as untracked and the assertion fails. The settled state is correct — a manual fixture check confirmed clean git status, empty ls-files, excludes file configured — so this is test flakiness, not a product defect.

Suggested fix direction: make the test wait for the settled state before asserting git status — for example wait until `git config --worktree core.excludesFile` is set, or until the wt-excludes file exists in the worktree git dir — instead of waiting only for the symlink.

# Notes

- The fix was already absorbed by commit 790722e (reconcile task, landed 27 min after this task was created). It removed the direct "worktree git status shows no .kanban entries" assertion and replaced it with a waitFor that polls `git status --porcelain` every 250 ms (10 s budget) until no .kanban entries show, before the `git ls-files` and blanket `git add -A` assertions.
- Checked against the spec's suggested direction: polling git status itself is the settled-state wait, and a stronger one than waiting for the wt-excludes file to exist (syncBoard writes the file two steps before `git config --worktree core.excludesFile`, so file-exists alone would still race). Convergence requires the excludes config to be applied, and there is no false positive: with the symlink confirmed present, git status stays dirty until the config lands.
- Removed one dead leftover in the same block: the symlink waitFor passed an ignored `rootD` argument (waitFor takes four params). Committed as 9a40d36 on the worktree branch.
- Verification: node src/orchestrator.test.ts passed 4/4 runs (three against 790722e, one after the cleanup), including part D (shared board).
- Review: no fixes needed. Confirmed the race explanation against syncBoard in src/orchestrator.ts: the order is symlink, skip-worktree pass, wt-excludes write, `git config extensions.worktreeConfig`, then `git config --worktree core.excludesFile`, so the settled state requires the last config step and polling `git status --porcelain` is the only correct wait (no false positive: with the symlink confirmed present by the prior waitFor, it stays untracked until the config lands). The one-line cleanup (9a40d36) is correct: waitFor takes four params, so `rootD` was an ignored fifth argument.
- Review verification: node src/orchestrator.test.ts passed in the worktree (all smoke parts, including part D shared board). The branch (base 87f3240, which contains main's fix 790722e) carries only the cleanup; main's newer changes touch the test file at lines 118/257/751+, so the future merge into main is clean. This is the only `git status --porcelain` in the test file, so no other part shares the race.
