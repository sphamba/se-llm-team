---
name: "fix: defer done merge while task agent pid is alive"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
The orchestrator's done+merge path must not merge and clean up a task while its registered agent is still alive; in a live test the merge destroyed the live-tester session mid-run and its report was lost.

# Specs
Found during the live test of task 000001 (fix: commit kanban tasks only on create and done).

Problem: The orchestrator's done+merge path does not check the task's registered agent pid before it merges and cleans up. In a live test, the daemon merged a task's branch, removed the task's worktree, deleted the branch, and made the done commit while the task's live-tester agent was still alive (the pidfile in .kanban/.pids/ held the live tester pid). The worktree removal destroyed the live-tester session working directory mid-test, which left that session with a dead bash tool and no way to restore it (.worktrees/ was read-only), and the live-tester report landed outside the done commit.

Suggested fix: Defer or skip the done merge (mergeDone) while the task's agent pid is alive, and process the merge when the agent dies (the liveness poll already moves live-testing to done on agent death).

# Notes

- mergeDone (src/orchestrator.ts) now also checks the task's registered agent pid (the .kanban/.pids/<slug>.pid file written by the developer/reviewer/live-tester spawn) and returns false (defers merge and done commit) while that pid is alive, alongside the existing merger pid check. The next rescan sweep processes the merge once the pid is dead; no new machinery is needed, since the rescan loop retries every sweep.
- Added orchestrator.test.ts part G: a live-tester stub sets done, appends its report, then lingers 5s. While alive, the worktree stays and no done commit runs; after exit, the merge runs and the report is folded into the done commit.
- Both test suites pass (orchestrator.test.ts, kanban.test.ts). Committed as ada9112 in the worktree.
- Review: code matches the spec. Part G was verified as a real regression test: it fails against main's orchestrator.ts (merge, worktree removal and done commit run while the stub lingers) and passes with the fix. Both suites re-run green in the worktree; worktree left clean.
- Edge cases checked: pidfile already cleared by the liveness poll (agentPid returns 0, merge proceeds); manually done task with a hung agent defers the merge, which is the requested behavior; a stale pidfile whose pid is reused by an unrelated process could defer the merge indefinitely, but that is the same accepted exposure as the existing merger pid and lock checks and the window is negligible (left as is).
- Live test passed. Sandbox root /tmp/llt-000010 ran the worktree daemon (1s rescan) with fake done tasks, real worktree branches and pid files.
- Defer: a done task with a live agent pid in .kanban/.pids/<slug>.pid (a sleeper process) stayed unmerged through 5+ sweeps. No merge commit, no done commit, worktree and branch intact, branch content not in main. Main's code merges this on the first sweep.
- Merge after death: after I killed the sleeper pid, the next sweep merged the branch, removed the worktree, deleted the branch, cleared the worktree field and made the kanban: done commit.
- Stale pidfile: a done task with a dead pid in its pid file merged on the next sweep with no wait.
- Merger pid: with a live pid in <slug>.merger.pid the merge-attempt counter froze across sweeps; after the kill, attempts resumed. A conflicting branch still runs the merger flow: 3 attempts, then "still conflicts after 3 attempts, left for manual resolution".
- Both test suites pass from the worktree (node --test, 2/2). orchestrator_status reports the real daemon running.
- One minor pre-existing issue, not a regression from this fix: past the 3-attempt merge cap, mergeDone bumps the counter and logs the give-up line on every sweep, so a stuck-conflict task grows .kanban/.logs unboundedly. Reported to the project manager; task 000019 created.
