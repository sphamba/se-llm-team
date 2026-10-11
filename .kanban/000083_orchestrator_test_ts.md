---
name: "test: orchestrator.test.ts late task-create commit wait is flaky"
priority: "low"
state: "done"
worktree: ""
---

# Summary
node src/orchestrator.test.ts in the 000068 worktree failed 1 of 3 runs with exit 1 and "timeout waiting for late task create commit" in the late create-event smoke part, immediately after the "worktree-cwd board-feed wait" part had passed. src/orchestrator.ts was untouched by the 000068 diff, so this is test flakiness or a timing issue, not a product regression.

# Specs
Found during the live test of 000068 (worktree fix/68-renderlogchunk-drops-blank). Test-only; the daemon output at failure showed "orchestrator started ... web ui disabled (no-webui)".

Evidence:
- node src/orchestrator.test.ts failed 1 of 3 runs in the worktree: exit 1, "timeout waiting for late task create commit" in the late create-event smoke, immediately after the "worktree-cwd board-feed wait" part passed. The other two runs passed (the 000068 live test also re-ran the suite; final result 2 passes after 1 failure).
- src/orchestrator.ts was untouched by the 000068 diff, so this is not a regression from 000068.
- NOT the same flake as done task 000049: that one was the part D "worktree git status shows no .kanban entries" assertion. This one is the smoke test's wait for the late task-create mirror commit (the "kanban: create" mirror commit on refs/heads/meta/kanban).

Suggested direction:
- Make the late create-event wait robust: poll/wait on the mirror ref (or the commit log) with a generous timeout instead of a fixed short timeout, and/or assert on the settled state after the daemon's scan, so a slow scan or a mirror commit folded under another label does not fail the run.
- Reproduce by running node src/orchestrator.test.ts in a loop under load until the failure appears, then keep the fix narrowly test-only.
- Per this project's convention (see 000049), flaky-test fixes ship with the reproduced failure and a green multi-run of the suite.

# Notes

## Notes
- Reproduced per convention: baseline suite green (2m24s); loop under 8 sha256sum CPU hogs gave run 1 PASS (163s), run 2 PASS (163s), run 3 FAIL (120s). The reproduced failure was part Q "timeout waiting for branch-only file materialized", not part O "late task create commit" - the same flake class: a fixed 10s wait on daemon mirror behavior timing out under load.
- Failure analysis: the failing run's daemon log showed only start + no-webui + "orchestrator lock was missing, re-acquired" ~1s after start, then 10s of silence with no "[daemon exit ...]" line and no crash - the daemon's scan loop stalled past 10s (no exit, no JS stack). Instrumented the daemon temporarily (lock canary + per-sweep heartbeat to /tmp/tempdiag83.log): 25 instrumented full-suite runs plus 8 isolated lock-canary runs showed a healthy daemon never pauses more than 1.37s between sweeps and the lock never vanishes in isolation; no git failures beyond the expected no-ref-yet ones. The >10s stall is rare (1 in ~30 runs under load) and memory-pressure-shaped (box has ~2GB free); no product defect found, so the fix stays test-only per the specs.
- Fix (test-only, commit 817a060): raised the seven scan-dependent waits in parts O, P, Q from 10000ms to 30000ms - part O "settled done task mirrored" and "late task create commit" (the reported flake), part P "external add materialized"/"external deletion propagated"/"reconcile logged", part Q "branch-only file materialized" (the reproduced flake) and "next mirror commit keeps the branch-only file". 30s is the generous timeout the parts' first waits already used and that survived the failing run; healthy sweeps answer within 1.4s. One comment in part O records the reason. Locks, webui, symlink, bootstrap (L/M), worktree (D) and push-warning waits left untouched.
- Green multi-run: 3 suite runs under 8-hog CPU load all PASS (166s, 165s, 156s); kanban.test.ts also green. Temporary diagnostic instrumentation reverted; src/orchestrator.ts untouched.
- Review: verified the diff against the specs. Commit 817a060 touches only src/orchestrator.test.ts and raises exactly the seven scan-dependent waits in parts O, P, Q from 10000ms to 30000ms, with one reason comment in part O; the claim that 30s matches the first-wait timeouts holds (parts P and Q first waits were already 30000 on main, part O's first wait is raised by the same commit). The remaining 10s waits (locks, bootstrap L/M, webui flags, push warning) are start/lock/flag-dependent, not scan-dependent, so leaving them is consistent with the scope. Reviewer runs: full orchestrator.test.ts green twice (2m36s each) and kanban.test.ts green. No fixes needed.

## Live test report (2026-10-11)
- Scope: test-only change, commit 817a060, diff vs main touches only src/orchestrator.test.ts (9 insertions, 7 deletions). Ran like a user: full suites in the worktree, no code edits.
- Runs: 3 full orchestrator.test.ts runs under 8 sha256sum CPU hogs all PASS (167s, 167s, 165s); 1 clean run (no load) PASS (160s); kanban.test.ts PASS. Total 4 green orchestrator runs.
- Main flows exercised: all smoke parts reached the end, including the target parts: "settled done task create-event smoke" (part O late task-create wait), "mirror reconcile smoke" (parts P/Q external add, deletion and branch-only materialization), plus pipeline, liveness, lock lifecycle, mirror board, bootstrap, hub failover, restart and respawn cap.
- No "timeout waiting for ..." message, no crash, no assertion failure in any run. No leaked fixtures left by the suite.
- Result: PASS. No issues found, so no follow-up tasks to report to the Project manager.

## Merge report
- Step 1: root checkout was on main. Merged main into test/83-orchestrator-test-ts in the worktree (merge commit 2b6de16); git auto-merged src/orchestrator.test.ts with no conflicts. Verified the auto-merge kept this branch's intent: exactly the seven scan-dependent waits in parts O, P, Q at 30000ms with the reason comment, and main's new parts/tests untouched (the remaining 10000ms waits are start/lock/flag-dependent, per the review scope).
- Tests in the worktree after the merge: extension.test.ts PASS (1.2s), kanban.test.ts PASS (0.5s), webui.test.ts PASS (6.8s), orchestrator.test.ts PASS (235s). No fixes needed, so step 1 added no extra commits.
- Step 2: root checkout still on main. Merged test/83-orchestrator-test-ts into main in the project root: fast-forward 9e9f0ae to 2b6de16, clean, only src/orchestrator.test.ts changed (9 insertions, 7 deletions), matching the branch diff. No conflicts.
- Result: both merges complete, both repos clean. Task done.
