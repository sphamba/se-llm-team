---
name: "fix: orchestrator_start tool throws and daemon status lies"
priority: "high"
state: "live-testing"
worktree: "fix/orchestrator-start-tool-throws-and-daemon-status-lies"
---

# Summary
The orchestrator_start tool always throws a TypeError before spawning the daemon, and orchestrator_status/stop report "not running" while a daemon is actually alive. Fix the daemonLog bug and make the singleton lock reliable so status and stop tell the truth.

# Specs
# Need

The PM skill cannot start the orchestrator through its tool, and the tools cannot see a running daemon. Both break the se-llm-team session flow.

# Defect A (verified): orchestrator_start always throws

- index.ts line 10: `const daemonLog = (ctx: ExtensionContext) => join(board(ctx.cwd), ".logs", "orchestrator.log");`
- `board` is `(ctx) => kanbanDir(ctx.cwd)`. So `board(ctx.cwd)` computes `kanbanDir(ctx.cwd.cwd)` = `kanbanDir(undefined)` → `join(undefined, ...)` → TypeError: The "path" argument must be of type string. Received undefined.
- In orchestrator_start, the call order is: existsSync(board(ctx)) → mkdirSync .logs/.pids → openSync(daemonLog(ctx), "a"). The openSync line throws every time, so the daemon never spawns via the tool.
- Fix: `daemonLog` must pass `ctx`, not `ctx.cwd`, to `board`.

# Defect B (verified): status/stop lie about a running daemon

- A daemon runs for this project: pid 420117, started 2026-10-10 18:05, `node src/orchestrator.ts --root /home/phamba/repos/se-llm-team`, spawned a developer agent at 16:44:25Z (see .kanban/.logs/orchestrator.log).
- `.kanban/.orchestrator.lock` does not exist while this daemon runs.
- readPid (index.ts:207) reads that lock → orchestrator_status returns "not running" and orchestrator_stop returns "Orchestrator not running" while the daemon is alive.
- The daemon acquired the lock at startup (src/orchestrator.ts acquireLock, lines 232-244, flag "wx") and releases it on exit/SIGINT/SIGTERM (lines 283-289). The lock vanished during the daemon life. Find the root cause. Candidates to check: stale-pid recovery removing a live lock (pidAlive semantics), another process removing the lock, or the lock never being re-created.
- Required behavior: the lock exists for the whole life of the daemon. If it goes missing, the daemon must self-heal (for example re-acquire during its 30 s rescan when the lock file is absent). A second daemon must still never run (singleton guarantee intact).
- orchestrator_status must report running while a daemon lives and not running after stop. orchestrator_stop must stop the live daemon.

# Constraints

- Minimal diff. No new dependencies. No config key for the lock policy.
- Keep the current tool names and return message shapes.
- Keep the accepted same-file edit race semantics unchanged.

# Acceptance criteria

- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass.
- A manual check: start the daemon (or use the tool against a fixture repo), then orchestrator_status reports running with the pid; after orchestrator_stop it reports not running.
- A second start attempt while a daemon runs does not create a second daemon process.
- Add assert-based checks for the lock lifecycle if practical with the existing fixture patterns (disable GPG signing in fixture repos, as the smoke test already does).

# Notes

- [2026-10-10 19:05] Defect A fixed: daemonLog now passes ctx (not ctx.cwd) to board. One line in index.ts.
- [2026-10-10 19:05] Defect B root cause: the daemon checked its lock only at startup. Evidence: daemon 420117 lives since 18:05, but .orchestrator.lock, the "orchestrator started" log line, and the old task files are gone. The git reflog shows task files deleted and recreated under new names, plus origin/main checkouts, during PM experimentation between 18:05 and 18:44. No in-code path can remove a live daemon's lock: releaseLock matches only its own pid, and the stale-pid recovery needs a dead pid. So an external cleanup of the untracked .kanban files removed the lock mid-life. Two code defects made the loss permanent: the daemon never re-checked the lock, and acquireLock's stale recovery can race (two starters on a stale lock: one rmSyncs the other's fresh lock), with pidAlive treating EPERM (process exists, not signalable) as dead.
- [2026-10-10 19:05] Defect B fixed: every sweep now verifies the lock, re-acquires it when missing, and exits when a live peer holds it, so the singleton stays intact and a lockless daemon heals or quits within one rescan. pidAlive treats EPERM as alive in both files. orchestrator_start returns "Orchestrator already running (pid X)" without spawning, which the PM skill already documents as a no-op. The fs.watch error event is guarded, so a deleted board degrades to polling instead of crashing.
- [2026-10-10 19:05] Tests: kanban.test.ts and orchestrator.test.ts pass. New part C asserts the lock lifecycle: acquire with the daemon pid, a second start attempt exits and does not take the lock, self-heal after a mid-life deletion, release on SIGTERM stop. Manual check with the fixed code on a fixture: status reports running with the pid after start, not running after stop. No leaked processes from the runs.
- [2026-10-10 19:05] Operational note: the running daemon (pid 420117) predates the fix and holds no lock. Stop it and start it again with the new code after merge, or its status/stop keep lying.
- [2026-10-10 19:15] Review pass (commit 1dc0fb8): one fix. Verified defect A (daemonLog passes ctx) and defect B (sweep self-heal, EPERM-as-alive pidAlive in both files, fs.watch error guard) against every Required behavior and acceptance criterion. Ran node src/kanban.test.ts and node src/orchestrator.test.ts, both pass. Part C asserts the full lock lifecycle: acquire with the daemon pid, a second start exits without taking the lock, self-heal after a mid-life deletion, release on SIGTERM stop. No leaked processes from the runs. The message shapes of all three tools are unchanged. No merge conflict risk: the branch leaves the .kanban files unchanged from the merge base, so the task file copy in main survives the merge as is.
- [2026-10-10 19:15] Fix (commit 1dc0fb8): acquireLock's stale-recovery path read the lock unguarded, so a lock that vanished between the failed wx and the read threw out of acquireLock. From the daemon's sweep self-heal that was an uncaught exception in a timer callback, which killed the daemon. From the initial acquire it killed the freshly spawned daemon with a stack trace instead of the clean already-runs exit. The read is now guarded: a vanished lock counts as lost the race and the caller stays out. Tests re-run and pass.
- [2026-10-10 19:15] Residual, left as approved: two starters on a stale lock can still race, one rmSyncs the other's fresh lock, as the developer notes say. The self-heal bounds the damage to one rescan, after which the loser exits. A full fix needs an atomic replace, which the fs module does not offer for remove plus create.
- [2026-10-10 19:30] Review pass (no fixes, commits f159f14 + afe9ea7 + 1dc0fb8): verified every Required behavior and acceptance criterion against the code. Defect A fixed (daemonLog passes ctx to board). Defect B fixed: sweep checks holdsLock each rescan, re-acquires a missing lock, and exits when a live peer holds it, so the singleton stays intact; pidAlive treats EPERM as alive in index.ts and orchestrator.ts; acquireLock's stale-read is guarded so a vanished lock no longer crashes the caller; fs.watch error is guarded and degrades to polling; orchestrator_start returns "Orchestrator already running (pid X)" without spawning when a live pid holds the lock. Message shapes kept, kanban.ts untouched, no new dependencies, no config key. Ran node src/kanban.test.ts and node src/orchestrator.test.ts, both pass. Manual fixture check with the branch code: the lock holds the daemon pid, a second start attempt exits 0 without creating a daemon, SIGTERM stops the daemon and releases the lock, status truth follows the lock. Part C asserts the full lock lifecycle. One stray node process (pid 702700) leaked from a reviewer shell mistake during the manual check, killed and its temp fixture removed; no leaks remain. The branch leaves .kanban unchanged from the merge base, so this copy in main survives the merge with all notes. State set to to-live-test.
