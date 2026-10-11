---
name: "fix: stabilize orchestrator.test.ts part G merger-defer timing"
priority: "low"
state: "to-merge"
worktree: "fix/110-stabilize-orchestrator-test"
issuer: "#64"
---

# Summary
Remove the timing flake in part G of src/orchestrator.test.ts ("the merger spawn waits for the task's registered agent to die") so node src/orchestrator.test.ts reliably reaches and executes the newer part AB (task removal). Test-stability fix only; the live-tester/merger defer logic itself behaved correctly in the passing runs.

# Specs
Evidence from the live test of #64:

- Test: node src/orchestrator.test.ts, part G — "the merger spawn waits for the task's registered agent to die".
- Failure: AssertionError: worktree kept while the live-tester pid is alive, at src/orchestrator.test.ts:473.
- Frequency: 1 failure in 3 full runs; the two later runs passed. Timing-dependent, not deterministic.
- Pre-existing: unrelated to task #64's change (commit 1299c21); the flake is in the live-tester/merger defer timing, and src/orchestrator.test.ts part G does not exercise the removal path.
- Impact beyond the assertion: the test file runs its parts sequentially and exits on the first assertion failure, so this flake aborts the run before the newer part AB (task removal) executes — part AB goes unverified in a flaky run.

Goal: make part G wait for the settled state (e.g. poll until the live-tester pid is actually dead / the defer window has elapsed) instead of asserting immediately, so the suite passes deterministically and always reaches part AB. Treat similar to #49 (part D flake fix).

Acceptance:
- node src/orchestrator.test.ts passes across several consecutive full runs (no part G assertion failure).
- Part AB executes and passes in those runs.

# Notes

- [2026-10-11 17:45] Root cause: the linger stub's 5s window is measured from its own start, but its node startup (spawn-to-setTimeout delay) eats into it. Under load the startup delay grew past ~4s, so the stub set to-merge and died ~1s later; the test's fixed 2s sleep then landed after the stub's death AND the whole merger chain (sweep spawns merger, merge, doneCleanup removes the worktree), so the first assertion (`worktree kept while the live-tester pid is alive`) saw the settled state and failed at src/orchestrator.test.ts:473. Fix (commit ba5b262): replaced the fixed 2s sleep with a poll that waits until the registered live-tester pid (read from .pids/<slug>.pid, cleared by the poll once dead) is actually dead, asserting the defer continuously inside the alive window (worktree kept, no spawned merger, no done mirror commit). Once the pid dies, the existing settled waitFors (worktree gone, done mirror commit) run unchanged. While the pid is alive the defer holds deterministically, so the polled assertions cannot false-fail; if a pathological startup delay kills the stub before the first poll iteration, the run still passes and the settled state is verified by the later waitFors.
- [2026-10-11 17:45] Verification: 15 isolated part-G repro loops with the new logic (19 alive-window checks per run) and 8 more under 8 busy-loop processes all passed; 3 consecutive full `node src/orchestrator.test.ts` runs in the worktree passed (~160-170s each, no part G failure). Acceptance part AB: a throwaway branch at c917c6e (the tip carrying 1299c21/part AB) merged with ba5b262 ran the full suite 3 consecutive times, all passed with "... + task removal smoke passed" (part AB) reached and passing in every run. Throwaway worktree and branch removed; the fix branch itself carries only the part G change.
- [2026-10-11 18:20] Review (no fixes needed): verified the poll logic against the source. The pid file name `.pids/<slug>.pid` matches the daemon's pidPath convention (src/orchestrator.ts:112), the live-tester pid is written under the task slug (spawnAgent, line 215), and `pidAlive(0)` returns false so the cleared-file case resolves the poll (line 141). `waitFor` does not catch assertion throws (src/orchestrator.test.ts:160), so the asserts inside the poll callback fail the run immediately, not at the 30s timeout. The defer holds deterministically while the pid lives: sweepToMerge defers on the same `pidAlive(agentPid(root, slug))` predicate (src/orchestrator.ts:615-617), so the polled assertions cannot false-fail; the settled waitFors (worktree gone, done mirror commit, merger spawned, report folded) are unchanged. Failure cleanup still runs via the process exit handler (killAll + cleanupAll). Diff is single-commit ba5b262, src/orchestrator.test.ts only (+23/-6), worktree clean. Reviewer verification: 2 more consecutive full runs in the worktree (~2m40 each), both passed and both reached part AB ("... + reviewer successful-run cap smoke passed"), on top of the developer's 3 full runs, 3 throwaway-branch runs, 15 isolated repro loops and 8 loaded-machine loops. Acceptance met.
- [2026-10-11 18:45] Live test (no issues found): tested the merged result the Merger will produce (a throwaway worktree at ba5b262 merged with main, which carries part AB/task removal, plus the newer parts after it). Ran `node src/orchestrator.test.ts` from the merged worktree 3 consecutive times, all exit 0. Part AB ("... + task removal smoke passed") reached and passing in every run, as were the later parts up to blockedBy failsafe. Then 1 more full run under 8 busy-loop CPU processes (the original flake was load-dependent), exit 0, part AB reached and passing, no part G AssertionError and no `timeout waiting for live-tester pid death`. No assertion or timeout failures in any of the 4 runs. Throwaway worktree and branch removed; the fix branch itself is unchanged (ba5b262, worktree clean).
