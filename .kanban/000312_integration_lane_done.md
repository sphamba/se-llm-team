---
name: "fix: end the integration task at done on every lane end, never requeue it"
priority: "medium"
state: "live-testing"
worktree: "fix/312-integration-lane-done"
issuer: "user"
complexity: "simple"
shortName: "integration-lane-done"
blockedBy: ""
---

# Summary
The integration lane can still send a task from integration-testing back to to-integration-test, on a crash and on a superseded lane run. Task #305 shows it: its tester exited 0 and wrote its report, then the lane moved to #307 and #305 was requeued, so it will re-run the suite. Make every lane end land at done, and flip the test that pins the bounce.

# Specs
## Problem

The integration lane can send a task from `integration-testing` back to `to-integration-test`. Two paths do this:

1. The tester dies, crashes or is killed: `WORKING_STATES["integration-testing"].next` at `src/orchestrator/liveness.ts:20`.
2. The lane's global slug names another task: `LANES["integration-testing"].next` at `src/orchestrator/liveness.ts:27`.

Task #305 shows the cost and the race:

- Its tester finished with exit 0 at 12:02:40Z and wrote its report.
- #307 took the lane at 12:03:06Z. The spawn cleared the shared `integration-tester.exit` file (`src/orchestrator/spawn.ts:211`).
- The poll at 12:03:48Z saw the slug mismatch and requeued #305 to `to-integration-test`.
- #305 then collected refs #304, #309 and #310 and will run the full suite again.

The lane is report-only. The intent is that the integration task always ends at `done`.

## Change

1. `src/orchestrator/liveness.ts:20`: set `next: "done"` for `integration-testing`. Add a short comment: the lane is report-only, so every end, a crash included, is a completion.
2. `src/orchestrator/liveness.ts:27`: set `next: "done"` for the `integration-tester` lane. Add a short comment: a lane task whose run is gone goes to `done`, never back to the queue.
3. Do not change the logic. The exit-0 path already moves to `done`. The superseded and crash paths now read `done` from the two tables. Keep the `.dead` marker, the dead-streak bump and the exit-file clear as evidence.

## Tests

`tests/orchestrator/integration.test.ts` part 10 (line 464) asserts the crash bounce. Replace it:

- A crashed tester (pid 999999, exit 3) ends the task at `done`. Assert: state `done`, no lane pid, no lane exit file, no task in `integration-testing`.
- Add a superseded case: set a task to `integration-testing`, write the lane pid as a live pid and the lane slug as another task's slug. After the poll the task is `done`, and the shared pid/exit/slug pair is untouched.
- Update the part-10 console.log line and the final summary line.

Run `node tests/orchestrator/integration.test.ts` and `node tests/orchestrator/merge.test.ts`. The merger's superseded test (`merge.test.ts:542`, `merging -> to-merge`) must stay green.

## Docs

Check `skills/se-llm-team/SKILL.md:19` and `docs/architecture.md:28`. Update a line only if it says the lane requeues to `to-integration-test`.

## Out of scope

- The merger lane keeps its `to-merge` requeue.
- The lost exit-code race stays: a new lane spawn within the poll minute clears the finished run's exit file, so the analysis of that run can be skipped. The task state is `done` either way.
- No note about a crashed run is written to the task file. The run log and the `.dead` marker are the evidence.

# Notes

## Implementation
- `src/orchestrator/liveness.ts`: `WORKING_STATES["integration-testing"].next` and `LANES["integration-testing"].next` are now `done`, with comments that the report-only lane always completes.
- `tests/orchestrator/integration.test.ts` part 10: the crash case (pid 999999, exit 3) now asserts `done`, no lane pid, no lane exit file, nothing in `integration-testing`. A new superseded case asserts `done` and that the live pid/exit/slug pair is untouched. The part-10 log line and the final summary line are updated.
- `docs/architecture.md:32`: the crash line no longer says a crashed integration run returns to `to-integration-test`; it says every integration lane end lands at `done`. `skills/se-llm-team/SKILL.md` already said the lane ends at `done`, so it is unchanged.
- Logic untouched: the exit-0 path still moves to `done`, and the `.dead` marker, dead-streak bump and exit-file clear stay.

## Verification
- Red first: `node tests/orchestrator/integration.test.ts` failed at the crash assert with `to-integration-test` vs `done`.
- Green after the change: `node tests/orchestrator/integration.test.ts` exit=0 and `node tests/orchestrator/merge.test.ts` exit=0.
- The full suite is the live tester's gate.

Review of edf27f2 (first pass): approve. Both specs end paths now read `done`, the logic is unchanged, and the tests pin both ends.

- `src/orchestrator/liveness.ts:21` (`WORKING_STATES["integration-testing"].next`) and `src/orchestrator/liveness.ts:30` (`LANES["integration-testing"].next`) are `done`, with the comments the Specs asked for.
- `src/orchestrator/liveness.ts:236` (the non-zero exit path) and `:159` (the stall-kill path) both pass `working.next`, so a crash, a stall kill and a superseded slug all land at `done`. The `.dead` marker, the dead-streak bump and the exit-file clear stay.
- `tests/orchestrator/integration.test.ts:523` asserts `done` for the crash case (pid 999999, exit 3, no lane pid, no lane exit, nothing in `integration-testing`). `tests/orchestrator/integration.test.ts:535` asserts `done` for the superseded case and that the live pid/slug pair is untouched.
- `docs/architecture.md:32` no longer says a crashed integration run returns to `to-integration-test`. `skills/se-llm-team/SKILL.md:19` already said "It ends at done", so the Specs' conditional edit did not fire.
- Tests: `node tests/orchestrator/integration.test.ts` exit=0, `node tests/orchestrator/merge.test.ts` exit=0.
- Non-blocking: the superseded case checks the third member of the shared trio by absence (`existsSync(laneFile(root10, "exit")) === false`, `integration.test.ts:538`) instead of seeding the exit file and asserting it survives. Upgrade path: write `"0"` to the lane exit before the poll and assert the file still holds `0`, which pins "untouched" for all three files rather than two.

