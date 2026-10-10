---
name: "fix: failed agent spawn writes pid 0 and wedges the task in doing"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
When the agent executable is missing, spawnAgent logs the ENOENT but still writes a pid file with 0. pidAlive(0) returns true because kill -0 0 signals the process group, so the poll never fires DEAD_TRANSITIONS and the task stays in doing with no agent, forever. Do not write a pid file when the spawn fails, and make pidAlive treat pid 0 as dead.

# Specs
Found on 2026-10-10 while launching tasks 000008, 000014, 000015 with a broken agent executable (the config pointed at a removed wrapper script).

Symptom:
- spawnAgent logs "agent developer ... failed to start: spawn <path> ENOENT".
- The task still moves to doing, and its pid file in .kanban/.pids/ contains 0.
- pidAlive(0) returns true: kill -0 0 succeeds because pid 0 means the process group of the caller. So poll() sees the agent as alive, never runs the DEAD_TRANSITIONS bounce, and the task wedges in doing with no agent. mergeDone would also defer forever for the same reason if the task reached done.

Recovery used in the session: remove the 0 pid files by hand and set the tasks back to to-do.

Fix:
- Do not write a pid file when the spawn fails (for example, clear the pid file in the spawn error handler, or only write it once the child reports a real pid).
- Make pidAlive return false for pid <= 0 (guard against 0 and negative values).

Acceptance:
- A spawn failure leaves no pid file, so poll() bounces the task per DEAD_TRANSITIONS and the rescan retries the spawn.
- pidAlive(0) returns false.
- A test covers the pid-0 case.

# Notes
- [2026-10-10 20:29] Merge conflict for branch fix/failed-agent-spawn-writes-pid-0-and-wedges-the-task-in-doing, merger spawned (attempt 2).
- [2026-10-10 20:23] Merge conflict for branch fix/failed-agent-spawn-writes-pid-0-and-wedges-the-task-in-doing, merger spawned (attempt 1).

- Found that the pidAlive guard (pid <= 0 returns false) already existed in both src/orchestrator.ts and index.ts, so that spec item needed no code change, only a test.
- Fixed the root cause in src/orchestrator.ts spawnAgent: the pid file and the "spawned" log are now written only when the child reports a real pid. A failed spawn (ENOENT, child.pid undefined) leaves no pid file. Did not add clearPid to the error handler: with the write guard there is no pid file to clear on a spawn failure, and clearing on a later error event could drop the pid of a running agent.
- Exported pidAlive from src/orchestrator.ts for testing.
- Added unit asserts and integration part H to src/orchestrator.test.ts: pidAlive(0) is false, pidAlive(-1) is false, pidAlive(live pid) is true; with a missing executable the daemon logs the spawn failure, .kanban/.pids/ stays empty, the poll bounces doing -> to-do on the dead pid 0, the rescan retries the spawn, and the respawn cap gives up. All asserts pass.
- Ran the full suites: node src/orchestrator.test.ts, node src/kanban.test.ts, node src/webui.test.ts, all passed.
- Committed in the worktree as 7200659 "fix: failed agent spawn writes no pid file; pid 0 covered by a test".
- Review pass: verified the diff against the Specs. spawnAgent writes the pid file and the "spawned" log only when child.pid is truthy; a failed spawn leaves no pid file and the error handler logs "failed to start". Skipping clearPid in the error handler is correct with the write guard. Confirmed the pidAlive guard pre-existed in both src/orchestrator.ts and index.ts (diff only adds the export); index.ts holds no pid-0 wedge path because its daemon pid comes from .orchestrator.lock, written by the daemon itself with process.pid. Test part H covers all three acceptance items: unit asserts for pidAlive(0)/(-1)/live pid, and an integration run proving no pid file, the "agent pid=0 dead without state update, doing -> to-do" bounce, the rescan retry, and the give-up cap. Re-ran all three suites in the worktree, all passed. No fixes needed; state set to to-live-test.
- Live test of commit 7200659, run from the worktree against a scratch project (own git repo and board in /tmp, poll 3 s, rescan 5 s). All acceptance items pass. No issues found.
- Re-ran the shipped suites in the worktree: node src/orchestrator.test.ts, node src/kanban.test.ts, node src/webui.test.ts, all passed. Part H holds the pid-0 asserts and the failed-spawn integration run.
- Direct check: imported pidAlive from src/orchestrator.ts. pidAlive(0) = false, pidAlive(-1) = false, pidAlive(live pid) = true.
- Phase 1, agent config pointed at a missing executable: the task went to-do, the spawn failed with ENOENT, the log shows "failed to start" and no "spawned" line, .kanban/.pids/ stayed empty through 6 spawn attempts, the poll bounced doing -> to-do 5 times ("agent pid=0 dead without state update, doing -> to-do"), each bounce got a rescan retry, and after 5 respawns the log shows the one give-up line "agent died 5+ times, giving up (state doing)". No pid-0 file was written at any time.
- Phase 2, agent config pointed at a sleep wrapper: a real spawn wrote a pid file with the real pid and a "spawned" log line, and the poll kept the task in doing while the agent lived. A kill -9 on the agent made the next poll bounce doing -> to-do with the dead pid in the log, clear the pid file, and the rescan respawned within 500 ms (dead counter 1, task back in doing).
- Phase 2 also held a done task with a hand-written 0 pid file for its agent slug, like the old code left behind: mergeDone did not defer. The branch merged into the main checkout, the worktree was removed, the branch deleted, the worktree attribute cleared, and the done commit made.
- Stopped the daemon with SIGTERM: clean stop, lock released.
- Minor note, not a defect: after the give-up cap the dead counter keeps growing on each poll tick while the pid file stays absent. The code documents this (give-up logged once). Harmless.
- [2026-10-10 22:31] Merger spawned for this branch (attempt 3): found no merge in progress. This branch was already merged as eead03a and the task is done. The only pending merge on arrival was 000011's branch, and another merger resolved it as 51b0d18 while this merger inspected. Verified on main: pidAlive(0) is false, pidAlive(-1) is false, part I holds the pid-0 and failed-spawn tests. No action taken; no state change.
- [2026-10-10 22:25] Merge conflict for src/orchestrator.test.ts resolved on main (merge commit eead03a): both sides had added a part H, main held the symlink-spawn guard test and the branch held the pid-0 and failed-spawn test. The tests do not disagree, so the resolution keeps both: main's part H stays unchanged, and the branch's test follows as part I with renamed locals (rootI, taskI, hi, readI, pidsI) plus the pidAlive import. The merged-in src/orchestrator.ts fix (spawnAgent writes the pid file only for a real pid, pidAlive exported) was already auto-staged. node src/orchestrator.test.ts, node src/kanban.test.ts, and node src/webui.test.ts all pass after the resolution. The .kanban board changes stayed unstaged, per the convention that board changes are not staged into merges.
