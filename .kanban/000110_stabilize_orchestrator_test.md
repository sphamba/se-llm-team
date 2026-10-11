---
name: "fix: stabilize orchestrator.test.ts part G merger-defer timing"
priority: "low"
state: "doing"
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
