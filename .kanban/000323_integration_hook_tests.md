---
name: "test: cover the integration hook failure contract and the live-test overlap"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#315"
complexity: "simple"
shortName: "integration-hook-tests"
blockedBy: "#322"
---

# Summary
Two integration-stage contracts have no test: a throw from `ensureIntegrationTask` must be non-fatal, and the integration-tester must run while the covered task's live-tester still runs. Add both assertions.

# Specs
## Problem

Two contracts from the integration stage have no test.

1. A throw from `ensureIntegrationTask` must be non-fatal. The catch in `sweepToMerge` logs `integration task for <slug> failed:`, keeps the merge result and the `to-live-test` state, and does not bounce the task to `to-merge`. `grep -rn "integration task for" tests/` returns nothing.
2. The integration-tester must overlap the covered task's live-tester. That overlap is the stated reason for #311. `tests/orchestrator/integration.test.ts` part 1 captures both agent pids and asserts only the board states.

## Change

1. Add a failure-injection case, in `tests/orchestrator/integration.test.ts` if the fixture fits, otherwise `tests/orchestrator/spawn.test.ts`. Make `ensureIntegrationTask` throw during the merge hook, then assert:
   - the daemon log contains `integration task for <slug> failed:`,
   - the covered task ends in `to-live-test` and does not return to `to-merge`,
   - the merge completed (the log line `fast-forwarded ... set to-live-test`).
   Choose a deterministic trigger and name it in # Notes. A permission trigger on the waiting integration task file (chmod 0444 before the merge, restore after it) is acceptable. Do not add a test-only branch to production code.
2. In `tests/orchestrator/integration.test.ts` part 1, add an assertion that both pids are alive at the same time after both spawn. Reuse `pidAlive` from `src/pid.ts` or a `kill(pid, 0)` check. If the pids are not both alive at the sample point, assert ordering instead: the integration-tester pid file exists before the live-tester exit marker. Name the chosen check in # Notes.

## Adoption

#321 and #322 edit `tests/orchestrator/spawn.test.ts`, so this task is blocked by #322.

## Acceptance criteria

- `node tests/orchestrator/integration.test.ts` exits 0.
- `node tests/orchestrator/spawn.test.ts` exits 0.
- `pnpm test` exits 0.
- A test that passes immediately is acceptable for a coverage task. Say so in # Notes and state what it pins.

# Notes
