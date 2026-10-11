---
name: "test: orchestrator.test.ts part D worktree git-status assertion is flaky"
priority: "low"
state: "doing"
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
