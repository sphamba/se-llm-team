---
name: "chore: janitor dead pid files in .kanban/.pids"
priority: "low"
state: "backlog"
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
