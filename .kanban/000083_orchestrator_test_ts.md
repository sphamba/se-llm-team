---
name: "test: orchestrator.test.ts late task-create commit wait is flaky"
priority: "low"
state: "reviewing"
worktree: "test/83-orchestrator-test-ts"
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
