---
name: "fix: defer done merge while task agent pid is alive"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The orchestrator's done+merge path must not merge and clean up a task while its registered agent is still alive; in a live test the merge destroyed the live-tester session mid-run and its report was lost.

# Specs
Found during the live test of task 000001 (fix: commit kanban tasks only on create and done).

Problem: The orchestrator's done+merge path does not check the task's registered agent pid before it merges and cleans up. In a live test, the daemon merged a task's branch, removed the task's worktree, deleted the branch, and made the done commit while the task's live-tester agent was still alive (the pidfile in .kanban/.pids/ held the live tester pid). The worktree removal destroyed the live-tester session working directory mid-test, which left that session with a dead bash tool and no way to restore it (.worktrees/ was read-only), and the live-tester report landed outside the done commit.

Suggested fix: Defer or skip the done merge (mergeDone) while the task's agent pid is alive, and process the merge when the agent dies (the liveness poll already moves live-testing to done on agent death).

# Notes
