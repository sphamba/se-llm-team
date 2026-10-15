---
name: "fix: stop respawning a failed analysis on every to-merge sweep"
priority: "medium"
state: "done"
worktree: ""
issuer: "#224"
complexity: "moderate"
shortName: "analysis-failure-respawn"
---

# Summary
A failed analysis respawns on every to-merge sweep while the task stays in to-merge, because the runner leaves no report and no doctor log and removes its pid. The mechanism is pre-existing (an early failure loops the same way in the old code), but #224's required prompt files make the trigger easy to reach: a missing agents/analyst.md or agents/doctor.md in the package makes every sweep respawn a failing analysis. Decide whether the hook should fire at most once per run on failure, or the repeated retry is acceptable, then implement or record the decision.

# Specs
# Background
Live-test finding 2 of #224 (done), task file .kanban/000224_analyst_doctor_prompt_files.md under "# Notes extra: live test (2026-10-15)". Related but not covering: #222 (done) introduced the post-success analysis hook; #224 made the prompt files required.

# Decision (2026-10-15, user)
Cap the hook to at most one failed attempt per run: skip the spawn when <base>.analysis.exit already exists for the run. The described failures (missing prompt file, corrupt log) are deterministic, so repeated retries are doomed spawns in a loop.

# Work
1. Implement the guard in the to-merge sweep / analysis-run path (src/analysis-run.ts, src/orchestrator) so a failed analysis is attempted once per run: skip the spawn when the run's exit marker exists, with a log line explaining the skip.
2. Ensure a manual run or a re-queued task is not blocked by a stale marker.
3. Extend the orchestrator/efficiency-analysis tests to pin the chosen behavior (a failed analysis spawns once; later to-merge sweeps skip it; the pipeline still continues).

# Acceptance
- A run whose analysis already failed is not respawned by later to-merge sweeps, and the skip is logged.
- A task that leaves and re-enters to-merge can still be analysed: no stale marker blocks it.
- A failing analysis still never affects the pipeline.
- The affected suite(s) pass.

# Notes

Implemented 2026-10-15 (worktree fix/229-analysis-failure-respawn, commit 6989371):

- Root cause: a failed analysis (an early throw before the doctor-log write, e.g. a corrupt or unreadable log) leaves only the wrapper's exit file: no report, no doctor log, pid self-removed. The to-merge sweep re-fires spawnRunAnalysis on every sweep while the task sits in to-merge, and the janitor swept per-run analysis exit files on every sweep too, so no marker survived.
- Guard (the user decision above): spawnRunAnalysis skips the spawn when <base>.analysis.exit exists, with the log line "analysis of <raw> already attempted, skipping respawn (exit marker)". One guard at the single spawn point covers all three fire sites: the to-merge sweep, the poll's run-end pass and the poll's self-advanced pass.
- Janitor fix: janitorPids keeps per-run analysis exit files (<slug>.<role>.<n>.analysis.exit) while their task exists, keyed by the leading slug, and sweeps them with the task. Without this the marker would not survive one sweep and the guard would never fire.
- Test: new part AT5 in tests/orchestrator.test.ts, end to end: a to-merge task with a finished run whose log is a corrupt .log.gz; the first sweep spawns the failing analysis once (non-zero exit marker, no report, no doctor log); two later sweeps keep spawned-count at 1 with the skip logged and the marker surviving the janitor; the task stays in to-merge (detached root, the PM-resolves path); a fresh reviewer run (new index) still fires and completes its analysis. Confirmed failing before the fix (the marker did not survive the janitor), passing after; tests/orchestrator.test.ts passes in full (exit 0, 53 parts).
- Manual runs are unaffected: the guard lives in spawnRunAnalysis, not in analysis-run.ts, and a manual run writes no marker, so a manual analysis run is never blocked.

Reviewed 2026-10-15 (reviewer): no fixes.

- All three fire sites call the single guarded spawnRunAnalysis (verified by grep): the to-merge sweep (src/orchestrator/pipeline.ts:76), the poll's run-end pass (src/orchestrator/liveness.ts:187) and the poll's self-advanced pass (src/orchestrator/liveness.ts:216).
- Guard ordering verified in src/orchestrator/spawn.ts: the marker check sits after the report/doctor-log and pid-alive checks, before the spawn, so an in-flight analysis (pid alive, marker not yet written) still skips, and any finished failure hits the guard.
- The janitor's split(".")[0] key is safe: slugs contain only a-z0-9 and hyphens (non-alphanumerics are separators, src/kanban.ts:235).
- tests/orchestrator.test.ts ran in full (exit 0), part AT5 present ("one failed analysis attempt per run passed"): spawn-once, the logged skip, the marker surviving the janitor, the task staying in to-merge, and a fresh run (new index) firing despite the stale marker are all pinned.
- The Open-questions assumptions are confirmed against the code and removed: a success is caught earlier by the report check, so the marker check only catches failures; the marker keys on the run index, so only a fresh run re-fires; markers accumulate one per run and are swept with the task.

## Live test (2026-10-15, merged 7f1e1df)

Merged code (worktree fix/229-analysis-failure-respawn, commit 7f1e1df) vs the pre-fix commit 2e6f617 as a differential control, each on its own board fixture (/tmp/lt229), a fake pi agent as the analysis backend, and a daemon (`--rescan-seconds 1 --poll-minutes 30 --no-webui`, isolated HOME + XDG_CONFIG_HOME). Trigger: a `to-merge` task with a finished run whose log is a corrupt `<slug>.developer.0.log.gz` (the documented early failure: the runner throws before the doctor-log write), plus the stale `<slug>.pid` (dead) and `<slug>.exit` (0) pair. The task file appears after the daemon's startup pass and the poll interval is 30 min, so the startup poll cannot clear the stale pair and every to-merge sweep re-takes the fire site.

Verified on the merged code:
- One failed attempt: the first sweep spawned the analysis once (`spawned analysis pid=... for ...developer.0.log.gz`). The runner exited 1 (`incorrect header check`) leaving `.pids/000229_probe.developer.0.analysis.exit` non-zero, no `.analysis.md`, no `.doctor.log`, and the analysis pid file self-removed.
- No respawn: after 6 s of later sweeps the spawn count stayed 1 and the marker survived (the janitor kept it). The skip line "analysis of ...developer.0.log.gz already attempted, skipping respawn (exit marker)" appeared 8 times.
- Pipeline unharmed: the task stayed in `to-merge`, no `.dead` marker, no `.dead.count`, and the daemon kept sweeping (12 more log lines in the 6 s window).
- Fresh run: a new run (`reviewer.0.log`) fired its own analysis despite the stale `developer.0` marker and completed it (report + doctor log, one spawn, the fake recorded the analyst and doctor calls).
- Manual run: `node src/analysis-run.ts <root> <log.gz> developer` on the failed base succeeded (exit 0, report + doctor log) while the stale marker was present and left it untouched. The daemon did not respawn that base afterwards.

Verified on the pre-fix control (same fixture): the same failed analysis respawned 11 times in 9 s and logged no skip, so the fixture really exercises the reported loop.

Assumptions and notes:
- "Leaves and re-enters to-merge" is tested as the fresh-run case (new run index), per the user decision ("at most one failed attempt per run") and the pinned AT5 behavior: the marker is per run, so only a new run re-fires. A board state round trip with no new run stays capped by design.
- In a default daemon the poll clears the stale `<slug>.pid`/`<slug>.exit` pair on its first pass for a to-merge task, so the sweep loop is bounded by the poll cadence. This fixture pins `--poll-minutes 30` to observe the sweep loop the fix targets. No product issue seen.
- The suites are the developer/reviewer gate and were not run.

