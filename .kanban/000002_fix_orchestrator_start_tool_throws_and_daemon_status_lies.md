---
name: "fix: orchestrator_start tool throws and daemon status lies"
priority: "high"
state: "doing"
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
