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

# Open questions

