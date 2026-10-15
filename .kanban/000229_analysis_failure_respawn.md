---
name: "fix: stop respawning a failed analysis on every to-merge sweep"
priority: "medium"
state: "doing"
worktree: "fix/229-analysis-failure-respawn"
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

# Open questions

No open user questions; the decision was recorded above. Assumptions to confirm:

- Any exit code counts as attempted: a successful analysis is already skipped silently by the report check, so the marker check only ever catches failures in practice.
- A task re-entering to-merge with the same last run is not re-analysed (one attempt per run); only a fresh run (a new run index) re-fires the analysis.
- Exit markers accumulate one per run in .kanban/.pids while the task exists; bounded by run count, swept when the task is removed from the board.

