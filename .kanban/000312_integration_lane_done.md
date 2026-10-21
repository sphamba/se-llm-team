---
name: "fix: end the integration task at done on every lane end, never requeue it"
priority: "medium"
state: "done"
worktree: ""
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

## Live test (2026-10-21)

Lane: daemon e2e with a fake agent. Merged tree `edf27f2` (worktree `fix/312-integration-lane-done`), control `HEAD^ = 0b2a816`, one fixture root per tree, one driver (`node driver.mjs <repo> <label>`). Both daemons printed their start line, so the flags took effect: `orchestrator started (root=.../root, agent=.../fake-agent.cjs, backend=pi, poll=0.01min, rescan=1s)`. The fake agent records each spawn and exits 3 for the integration-tester role, 0 for every other role. The crash end is a real spawn of the lane by the daemon sweep, not a hand-written pid file.

| Claim (Specs line) | Merged edf27f2 | Control 0b2a816 | Verdict |
| --- | --- | --- | --- |
| Crash end target: "set `next: "done"` for `integration-testing`" (Change 1) | log line `agent pid=976539 exited 3 without success, integration-testing -> done` | log line `agent pid=980678 exited 3 without success, integration-testing -> to-integration-test` | merged PASS, control FAIL |
| Crash end state: "A crashed tester (pid 999999, exit 3) ends the task at `done`" (Tests) | task state `done` | task state `to-integration-test` | merged PASS, control FAIL |
| Crash end clears the lane pid: "no lane pid" (Tests) | `integration-tester.pid` present = false | false | PASS both |
| Crash end clears the lane exit: "no lane exit file" (Tests) | `integration-tester.exit` present = false | false | PASS both |
| Crash end leaves nothing in the lane: "no task in `integration-testing`" (Tests) | tasks in `integration-testing` = 0 | 0 | PASS both |
| Crash evidence stays: "Keep the `.dead` marker, the dead-streak bump and the exit-file clear as evidence" (Change 3) | `000001_integration_of_921.integration-tester.0.dead` present = true, `<slug>.dead.count` = 1 | marker true, count 1 | PASS both |
| Superseded end target: "set `next: "done"` for the `integration-tester` lane" (Change 2) | log line `its integration-tester run is over (superseded or unrecorded), integration-testing -> done` | log line `... integration-testing -> to-integration-test` | merged PASS, control FAIL |
| Superseded end state: "After the poll the task is `done`" (Tests) | task state `done` | task state `to-integration-test` | merged PASS, control FAIL |
| Superseded leaves the shared pid: "the shared pid/exit/slug pair is untouched" (Tests) | pid file holds the live holder pid 976839 | same live holder pid 981014 | PASS both |
| Superseded leaves the shared slug: same Specs line | slug file holds `000003_integration_of_923` | same slug | PASS both |
| Superseded leaves the shared exit: same Specs line, seeded with `0` | exit file holds `0` | `0` | PASS both |
| Exit-0 path keeps green: "The exit-0 path already moves to `done`" (Change 3) | dead pid with exit `0` ends at `done`, lane pid cleared = true | `done`, lane pid cleared = true | PASS both |
| Crash doc retired: "Update a line only if it says the lane requeues to `to-integration-test`" (Docs) | `docs/architecture.md` matches for `crashed integration run returns to to-integration-test` = 0, for `lands at done` = 1 | 1 and 0 | merged PASS, control FAIL |
| Skill doc already correct: same Docs line, `skills/se-llm-team/SKILL.md:19` | matches for `It ends at done` = 1 | 1 | PASS both |

Assumptions that shaped the checks:

- The crash claim runs the documented user path: a card in `to-integration-test`, the daemon sweep spawns the configured integration-tester in the root checkout, the fake tester exits 3, and the poll reads the wrapper's exit file. The evidence is the daemon log transition line plus the task file state and the lane sidecars.
- The superseded claim cannot be reproduced on demand from user actions, because the window is the race #305 shows. The driver builds that exact leftover state on a live daemon: a card in `integration-testing`, the lane pid file holding a live `sleep` pid, `integration-tester.exit` seeded with `0`, and the lane slug naming another card in `to-integration-test`. This closes the review's non-blocking note: the exit file is seeded and asserted to survive, so "untouched" covers all three lane files, not two.
- Expected values are the merged-tree truth and do not change with the tree label, so the control failures are the proof that the change is what makes the claims pass. The merged tree shows no red check.
- Fixture env: `HOME` and `XDG_CONFIG_HOME` point inside the fixture, `SE_LLM_TEAM_NO_WEBUI=1`, config `pollMinutes: 0.01`, `backlogIdleMinutes: 0`, `maxParallel: 0`, `retryIdleMinutes` left at its default.
- Not exercised: `node tests/orchestrator/integration.test.ts` and `node tests/orchestrator/merge.test.ts` (the Specs name them as a gate; a live tester never runs a `*.test.ts` file or a suite), and the merger lane's `to-merge` requeue (Specs out of scope).

Cleanup: the driver stopped the daemon with SIGTERM, killed the seeded lane holder and any analysis pid, and recorded no live pid afterwards. A `ps` scan anchored on both fixture roots returned no line. Artifacts: `/tmp/lt312/{merged,control}/result.json` and `/tmp/lt312/run-{merged,control}.log`.

No findings.
