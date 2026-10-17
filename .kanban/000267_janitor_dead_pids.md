---
name: "chore: janitor dead pid files in .kanban/.pids"
priority: "low"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "janitor-dead-pids"
---

# Summary
The rescan janitor sweeps only orphan .exit files and legacy per-task merger pids, so generic pid files in .kanban/.pids/ accumulate forever (13 splitter pids, 6 analysis pids today). Extend janitorPids to sweep pid files of dead processes whose task no longer tracks them, keeping every live process's file.

# Specs
Goal: .kanban/.pids/ must not accumulate dead pid files. Extend the existing janitor, same style and guards.

Facts (audited 2026-10-17):
- janitorPids (src/orchestrator/pipeline.ts:248-283) matches only orphan ".exit" files (removed when no board task matches the name) and legacy "*.merger.pid" (removed when the process is dead and the task is not in merging). Every other file hits the bare "continue" at pipeline.ts:264, so generic ".pid" files are never swept.
- Inventory of .kanban/.pids/ today: 13 "<slug>.splitter.pid", 6 "<slug>.<role>.<n>.analysis.pid", 106 analysis ".exit" files, no legacy merger pids left. Per-task agent pids "<slug>.pid" have the same accumulation whenever they exist.
- The project-wide merger pid ("merger.pid") is live state and must never be swept.

Rules for the new sweep (mirror the existing legacy-merger branch):
1. Never remove a running process's pid file: guard with pidAlive(pid, disc) from src/pid.ts (the /proc starttime discriminator), as the legacy-merger branch already does.
2. Never remove pid files the poll and analysis still read: keep per-task pid files while their task is in a state that tracks the process. Grep the readers first (liveness.ts poll, analysis-run.ts, spawn.ts) and derive the exact keep-states from them; working states (doing, reviewing, live-testing, merging) plus to-do while a splitter runs are the expected set.
3. Sweep a generic "<name>.pid" file when its task is gone from the board or no longer in a keep-state AND its pid is dead. Keep the project-wide "merger.pid" always (the legacy "*.merger.pid" branch stays as-is).
4. Analysis ".exit" files of done tasks also accumulate (106 today) but are out of scope: the .exit sweep keeps them while the task exists by design (one-failed-attempt guard #229). Do not touch the .exit branch.

Test: in tests/orchestrator/ (spawn.test.ts already covers pid files), seed a dead orphan pid file (task gone or done) and assert the janitor removes it; assert a live pid file and a keep-state task's pid file survive; existing janitor and pid asserts stay green.

Acceptance: node tests/orchestrator/spawn.test.ts (or the file holding the new scenario) passes, pnpm test passes.

# Notes

- Extended janitorPids (src/orchestrator/pipeline.ts) with a generic pid branch: a dead `<slug>.pid` is swept only when the slug is not on the board, a dead `<slug>.splitter.pid` only when its task is not in to-do, and a dead `<slug>.<role>.<n>.analysis.pid` always (its wrapper self-removes on a clean exit, so a survivor is a killed analysis; spawnRunAnalysis reads it only while alive). `merger.pid` is never swept, and the legacy `*.merger.pid` and `.exit` branches are unchanged.
- Deviation from the expected keep-states: a board task's per-task pid is kept in every state, not only the working ones. The liveness poll reads `<slug>.pid` for every non-merging board task (exit code, armed reviewer marker, dead-streak clear) and clears the file itself, and poll.test.ts part B waits for that dead-streak clear on a done task's stale pid, so sweeping it in the janitor races the poll and loses those reads. Dead per-task pids accumulate only for tasks removed from the board.
- New coverage: tests/orchestrator/sweep.test.ts part AP (8 asserts): dead orphan per-task and analysis pids, a done task's splitter and analysis pids; a live orphan pid, a board task's per-task pid, a doing task's per-task pid and a to-do task's splitter pid survive the first rescan.
- Checks (scoped, full suite not run): the new scenario failed red before the fix and passed after; tests/orchestrator/sweep.test.ts, poll.test.ts, split.test.ts, analysis.test.ts and spawn.test.ts all green.

- Re-review at 995b317: prior claims hold (liveness.ts:136 reads the task's own pid for every non-merging state and clears it itself at liveness.ts:170-171; startTodo pipeline.ts:42-51 reads the to-do splitter pid as the ran-marker; spawn.ts:289 wrapper self-removes the analysis pid; poll.test.ts part B:67-75 waits on the stale-pidfile counter clear, confirming the poll-race deviation). Rules 1, 3 and 4 are settled by the diff (pidAlive guard, merger.pid skipped before the branches, .exit branch untouched); the red-before half of the checks claim is provable from the diff (the old `if (!f.endsWith(".merger.pid")) continue;` kept every generic pid). The keep-states deviation is confirmed by code, so the Open question is deleted. Totals: 8 new asserts in sweep.test.ts part AP; all 13 tests/orchestrator/ suites green at 995b317 (analysis, hub, log fast in parallel; config, daemon, merge, poll, promote, singleton, spawn, split, sweep, worktree serial). No fixes.

## Live test (2026-10-17)

- Daemon e2e on a scratch repo (`git init`, 3 tasks done/to-do/merging plus orphan pid names), merged worktree code at 995b317, `--rescan-seconds 1`, `pollMinutes: 5` so the poll stays out of the window and the janitor is the only remover. Result: 23 checks, 0 failed.
- Swept: orphan per-task pid, orphan analysis pid, a done task's splitter pid, a done task's dead analysis pid, a done task's legacy merger pid, an orphan analysis `.exit` file.
- Kept: a live orphan pid, a board task's dead per-task pid (janitor keeps it, poll off in the window), a live to-do task's per-task pid, its dead splitter pid (to-do keeps the splitter-ran marker), `merger.pid` while a task is in merging, a task-scoped analysis `.exit`, and `merger.exit`.
- No confounders: the to-do and merging states did not move, no agent spawned (fake-pi log empty), no `error handling` line in the daemon log. Phase 2 wrote a fresh dead orphan pid and the sweep removed it within 2.5 s, so the sweep recurs and is not a one-shot startup pass.
- Assumption: with a normal poll cadence the dead per-task pid of a board task is consumed by the poll itself (the deviation the Notes document); the janitor keeps it by design.
- Assumption: the acceptance names `tests/orchestrator/spawn.test.ts` and `pnpm test`; the suites are the developer/reviewer gates and were not run, so this live test exercised the daemon surface the scenario pins.
- Harness note: the run finished and printed its tally; the shell call hit the 120 s tool timeout only because the two live-sleeper processes inherited the runner's stdout pipe and held it open.
