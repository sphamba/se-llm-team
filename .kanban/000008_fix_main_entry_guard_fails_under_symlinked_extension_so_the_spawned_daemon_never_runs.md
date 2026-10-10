---
name: "fix: main-entry guard fails under symlinked extension, so the spawned daemon never runs"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
orchestrator_start no longer throws, but through the user-level setup (extension at a symlinked path, repo symlinked to ~/.pi/agent/extensions/se-llm-team) the spawned daemon exits silently within a second: 0-byte daemon log, no .orchestrator.lock, no orchestrator.ts process. Fix the main-entry guard in src/orchestrator.ts to compare real paths so main() runs when node loads the daemon through a symlink.

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
