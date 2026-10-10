---
name: "fix: main-entry guard fails under symlinked extension, so the spawned daemon never runs"
priority: "high"
state: "done"
worktree: ""
---

# Summary
orchestrator_start no longer throws, but through the user-level setup (extension at a symlinked path, repo symlinked to ~/.pi/agent/extensions/se-llm-team) the spawned daemon exits silently within a second: 0-byte daemon log, no .orchestrator.lock, no orchestrator.ts process. Fix the main-entry guard in src/orchestrator.ts to compare real paths so main() runs when node loads the daemon through a symlink. Reproduced again on 2026-10-10 in the PM session: two tool starts (pids 1210764, 1211470) died within 2 s with no lock and no new log lines; a manual start from the real checkout (node src/orchestrator.ts --root <repo>) stayed alive and locked.

# Specs
Defect found by live test of task 000002 (branch fixed the original throw and the daemon lock lifecycle, but the daemon spawned by the tool still never runs).

Symptom (reproduced twice through a real headless pi session with the extension loaded from a symlink):
- orchestrator_start returns 'Orchestrator starting (pid X), log: ...' instead of throwing.
- The daemon exits silently within a second: the daemon log stays 0 bytes, no .orchestrator.lock is created, and no orchestrator.ts process is alive.
- Because no daemon ever holds the lock, the already-running singleton check never engages.

Root cause (verified): the main-entry guard in src/orchestrator.ts compares import.meta.url with pathToFileURL(resolve(process.argv[1])).href. pi loads extensions with jiti, which keeps the symlink path in import.meta.url, so the tool computes extDir from the symlink path and invokes the daemon through a symlink path. Plain node resolves symlinks when it loads the module, so the daemon's import.meta.url is the real path. The two differ, the guard is false, and main() never runs.

Direct check: node <symlink-path>/src/orchestrator.ts exits silently with no lock; node <realpath>/src/orchestrator.ts runs and locks.

Suggested fix: compare real paths in the guard, for example pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url, guarded with try/catch (realpathSync can throw if argv[1] is missing). Consider also whether import.meta.url should be realpath'ed for symmetric comparison.

# Notes

## 2026-10-10, Developer
- Verified the root cause with a probe: through a symlinked entry path plain node v24 keeps the symlink path in process.argv[1] while import.meta.url is the real path, so the old guard (import.meta.url === pathToFileURL(resolve(argv[1])).href) never matched and main() never ran. Reproduced the silent exit (no lock, no log) with node <symlink>/src/orchestrator.ts --root <repo>.
- Fix in src/orchestrator.ts: replaced the guard with isMainEntry(), which realpaths both sides (realpathSync(process.argv[1]) and realpathSync(fileURLToPath(import.meta.url))) and compares them, in a try/catch that returns false when argv[1] is missing or not an existing file. Both sides realpath'ed, so it holds whichever side is symlinked. Dropped the now-unused pathToFileURL import.
- Regression test in src/orchestrator.test.ts (part H): runDaemon gained an optional script path, and the new part symlinks orchestrator.ts into a temp dir, spawns the daemon through the symlink, and asserts the "orchestrator started" log line and the .orchestrator.lock file.
- All three suites pass: orchestrator.test.ts (pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn smoke), kanban.test.ts, webui.test.ts.
- Committed as e0fbe99 on fix/main-entry-guard-fails-under-symlinked-extension-so-the-spawned-daemon-never-runs.

## 2026-10-10, Reviewer
- Reviewed e0fbe99 (the only branch commit; the 17aebba board commit seen in the log is on main, not on this branch). Fix matches the Specs: isMainEntry() realpaths both sides and compares, try/catch returns false for a missing or nonexistent argv[1], unused pathToFileURL import dropped, resolve kept (still used by parseArgs).
- Ran all three suites: orchestrator.test.ts (including new part H), kanban.test.ts, webui.test.ts, all pass on node v24.20.0.
- Independent checks outside the test: daemon spawned through a symlinked directory (the production shape) starts, locks, stays alive and stops cleanly; import-as-module does not run main and leaks no lock; a nonexistent entry path fails at node's own module load.
- No fixes made. State set to to-live-test.

## 2026-10-10, Live-tester
- Tested e0fbe99 in the production shape from the worktree, against a scratch project (/tmp), without touching the PM's running daemon (pid 1233223, old code from the main checkout). The scratch project had a .kanban board and the extension loaded through a symlink (.pi/extensions/se-llm-team -> worktree), mirroring ~/.pi/agent/extensions/se-llm-team -> /home/phamba/repos/se-llm-team.
- Reproduced the tool's exact spawn shape (spawn(node, [<symlinked extDir>/src/orchestrator.ts, --root, cwd]) with extDir from the symlinked import.meta.url): the daemon ran, logged "orchestrator started (root=..., agent=pi, poll=1min, rescan=10s)", wrote .kanban/.orchestrator.lock, and stayed alive well past the old bug's 1 s silent-exit window. Old code in this shape produced a 0-byte log and no lock.
- Singleton check engages: a second start through the symlink printed "another orchestrator already runs for this project, exiting" (exit 0), left the lock and the first daemon untouched.
- Clean stop: SIGTERM logged "orchestrator stopped", removed the lock, and the process exited.
- Regression: importing orchestrator.ts as a module (even through the symlink) does not run main and leaks no lock.
- All three suites pass on node v24.20.0, fail 0, including the part H symlinked spawn smoke.
- The scratch daemon logged "web ui failed to start, continuing without it": expected, port 4242 was held by the PM daemon, and the code continues without the ui by design.
- Caveat: a full headless pi end-to-end (pi --approve -p with the extension through a symlink and a scratch HOME) could not run in this environment (model-config hang with the scratch HOME, and a hard tool-name conflict when both the user-level and the project-level extension load). The tool's spawn shape was reproduced exactly instead, which is the code path this fix changes. No issues found; no follow-up tasks created.