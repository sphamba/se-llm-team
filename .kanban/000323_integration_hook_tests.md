---
name: "test: cover the integration hook failure contract and the live-test overlap"
priority: "low"
state: "to-live-test"
worktree: "test/323-integration-hook-tests"
issuer: "#315"
complexity: "simple"
shortName: "integration-hook-tests"
blockedBy: ""
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

## Delivered

- `tests/orchestrator/integration.test.ts` part 16 ("a throw from the merge hook is non-fatal") and part 17 ("the integration-tester overlaps the covered live-tester"). Both are coverage pins, and both passed on the first run: they pin behavior that already exists, as the acceptance criteria allow.
- Deviation from Spec 2: a dedicated part 17 replaces the "add to part 1" wording. Part 1 holds both pids as `process.pid` (`mergeTask` calls `hold(root, LANE)` and `hold(root, slug)`), so it can never sample a real overlap. Part 17 runs its own fixture: one rescan merges and opens the waiting integration task, the next rescan spawns both stubs in one pass.
- Failure trigger for part 16: `chmod 0444` on the waiting integration task file before the merge, restored to `0644` right after it. The test runs as uid 1000, not root, so the hook's `updateAttrs` write throws `EACCES` and the catch logs `integration task for <slug> failed: EACCES: permission denied, open '<file>'`. No test-only branch was added to production code.
- Part 16 also asserts that the merge line `fast-forwarded main to feat/covered-N, set to-live-test` is present and that the waiting task keeps its name, Specs and `to-integration-test` state, so nothing partial survived the throw.
- Overlap check for part 17: `pidEntry` + `pidAlive` from `src/pid.ts` on `<slug>.pid` and `integration-tester.pid`, sampled after both stubs record their spawn. Both pids were alive at the sample point, so the ordering fallback was not needed. The part also asserts the board holds `live-testing` and `integration-testing` at that moment.
- Negative proof that the pins are not vacuous: removing the hook's `try`/`catch` makes part 16 fail on the missing log line, and returning early from `sweepToIntegrationTest` while a task is `live-testing` makes part 17 fail. Both mutations were reverted, and `src/orchestrator/pipeline.ts` is unmodified.
- The local `stopLane` helper became `stopAgent(root, name)` with `stopLane` delegating to it, so part 17 can also kill the live-tester stub.
- `node tests/orchestrator/integration.test.ts` exits 0 (all 18 parts).

## Blockers

- `node tests/orchestrator/spawn.test.ts` exits 1 at the base as well, with the same wait `timeout waiting for the integration task runs to done and folds into the mirror`. Proof: at HEAD `d51a72e` == main `d51a72e`, with this test edit stashed, the suite exits 1 with that same first line. #322 (`create_retry_once`) owns `spawn.test.ts` per the Adoption section and its state is `live-testing`, not `done`, so that acceptance line cannot run here. `pnpm test` is the full suite, which is the live tester's gate.

Review of 57bd6e4 (first pass): the Specs hold, and both pins bind real production behavior.
- Spec 1 is met at the predicate: `setState to-live-test` and the fast-forward log precede the hook, and the only writer of `integration task for ... failed:` is the catch around `ensureIntegrationTask` (`src/orchestrator/pipeline.ts:318`, `src/orchestrator/pipeline.ts:320`), asserted at `tests/orchestrator/integration.test.ts:642`.
- Spec 2's move to a dedicated part 17 is sound, not a dodge: part 1 writes `process.pid` into both pid files (`tests/orchestrator/integration.test.ts:101`), so it cannot sample two live agents, and part 17 asserts `pidAlive` on both pids at one sample (`tests/orchestrator/integration.test.ts:680`).
- Tests: `node tests/orchestrator/integration.test.ts` exit=0 (18 parts); `node tests/orchestrator/spawn.test.ts` exit=1 on `timeout waiting for the integration task runs to done and folds into the mirror`.
- Note: that red is pre-existing, not this change's: `spawn.test.ts` and all of `src` are unmodified from main, and #322 owns that file per Adoption. It needs a separate task after #322 lands.
- Note: part 16's `chmod 0444` trigger needs a non-root uid, so under root the write succeeds and the `EACCES` assertion fails. Guard with `process.getuid?.() === 0` only if a root runner ever appears.
- Note: `pnpm test` is the live tester's gate and was not run here.

## Merge resolution (rebased onto 41ad23b)

- One conflict, `tests/orchestrator/integration.test.ts`: both sides appended a new part at the end of the file. The base added part 16 (user hold skips the integration lane) and the replayed commit added its own part 16 and part 17. Both sides keep their tests, so the resolution keeps the base part 16 verbatim and renumbers the replayed parts to 17 and 18, with their suffixed identifiers renumbered too. The two closing summary lines became one.
- `node tests/orchestrator/integration.test.ts` exits 0 after the rebase, all 19 parts.
- `npm test` exits 1. The first failure line is `timeout waiting for the integration task runs to done and folds into the mirror` in `tests/orchestrator/spawn.test.ts`. This branch does not touch that file and does not touch `src`: `git diff --stat 41ad23b..HEAD` lists only `tests/orchestrator/integration.test.ts`, and the failure reproduces on base `41ad23b` alone. It is a pre-existing red on the new base, not this change.
- The Blocker entry above was recorded against base `d51a72e`. The base now holds the user-hold commits (`c27fdb8`, `41ad23b`) and the same red is still there.
- Durable guidance: when both sides append a numbered test part, the numbers collide and the parts are module-scope consts. Keep both sides and renumber the replayed parts, suffixed identifiers like `root17` and `waiting16Path` included.

# Open questions
