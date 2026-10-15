---
name: "fix: stop respawning a failed analysis on every to-merge sweep"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#224"
complexity: "moderate"
shortName: "analysis-failure-respawn"
---

# Summary
A failed analysis respawns on every to-merge sweep while the task stays in to-merge, because the runner leaves no report and no doctor log and removes its pid. The mechanism is pre-existing (an early failure loops the same way in the old code), but #224's required prompt files make the trigger easy to reach: a missing agents/analyst.md or agents/doctor.md in the package makes every sweep respawn a failing analysis. Decide whether the hook should fire at most once per run on failure, or the repeated retry is acceptable, then implement or record the decision.

# Specs
# Background
Live-test finding 2 of #224 (state live-testing), task file .kanban/000224_analyst_doctor_prompt_files.md under "# Notes extra: live test (2026-10-15)". Related but not covering: #222 (done) introduced the post-success analysis hook; #224 made the prompt files required.

# Evidence
- /tmp/lt224/spawncheck: three direct spawnRunAnalysis calls produced three "spawned analysis pid=" log lines and three ENOENT failure lines; the runner leaves no report, no doctor log and removes its pid, so the next sweep sees the run as unanalysed.
- /tmp/lt224/spawncheck-old: the pre-change code loops the same way on another early failure - a corrupt .gz log gives three spawns and three "incorrect header check" failures - so this is not a regression.
- The #224 Specs requirement that a failing analysis is logged and the pipeline continues itself holds; only the repetition is at issue. New trigger: since #224 a missing agents/analyst.md or agents/doctor.md makes the analysis fail before any LLM call, and every to-merge sweep yet another failing spawn.

# Work
1. Get the answer to the open question: cap the hook to at most once per run on failure (for example skip the spawn when <base>.analysis.exit exists) or keep today's repeated retry.
2. If capping: implement the guard in the to-merge sweep / analysis-run path (src/analysis-run.ts, src/orchestrator) so a failed analysis is attempted once per run, with a log line explaining the skip; ensure a manual run or a re-queued task is not blocked by a stale marker.
3. Extend the orchestrator/efficiency-analysis tests to pin the chosen behavior (a failed analysis spawns once; the pipeline still continues).

# Acceptance
- With the cap: a run whose analysis already failed is not respawned by later to-merge sweeps, the skip is logged, and a task that leaves and re-enters to-merge can still be analysed. Without the cap: the repeated-retry behavior is recorded as accepted in this task's Notes.
- A failing analysis still never affects the pipeline.
- The affected suite(s) pass.

# Notes

# Open questions
Should the hook fire at most once per run on failure (for example skip when <base>.analysis.exit exists), or is the current repeated retry acceptable?
