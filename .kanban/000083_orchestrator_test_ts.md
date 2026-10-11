---
name: "test: orchestrator.test.ts late task-create commit wait is flaky"
priority: "low"
state: "doing"
worktree: "test/83-orchestrator-test-ts"
---

# Summary
node src/orchestrator.test.ts in the 000068 worktree failed 1 of 3 runs with exit 1 and "timeout waiting for late task create commit" in the late create-event smoke part, immediately after the "worktree-cwd board-feed wait" part had passed. src/orchestrator.ts was untouched by the 000068 diff, so this is test flakiness or a timing issue, not a product regression.

# Specs
Found during the live test of 000068 (worktree fix/68-renderlogchunk-drops-blank). Test-only; the daemon output at failure showed "orchestrator started ... web ui disabled (no-webui)".

Evidence:
- node src/orchestrator.test.ts failed 1 of 3 runs in the worktree: exit 1, "timeout waiting for late task create commit" in the late create-event smoke, immediately after the "worktree-cwd board-feed wait" part passed. The other two runs passed (the 000068 live test also re-ran the suite; final result 2 passes after 1 failure).
- src/orchestrator.ts was untouched by the 000068 diff, so this is not a regression from 000068.
- NOT the same flake as done task 000049: that one was the part D "worktree git status shows no .kanban entries" assertion. This one is the smoke test's wait for the late task-create mirror commit (the "kanban: create" mirror commit on refs/heads/meta/kanban).

Suggested direction:
- Make the late create-event wait robust: poll/wait on the mirror ref (or the commit log) with a generous timeout instead of a fixed short timeout, and/or assert on the settled state after the daemon's scan, so a slow scan or a mirror commit folded under another label does not fail the run.
- Reproduce by running node src/orchestrator.test.ts in a loop under load until the failure appears, then keep the fix narrowly test-only.
- Per this project's convention (see 000049), flaky-test fixes ship with the reproduced failure and a green multi-run of the suite.

# Notes
