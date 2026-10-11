---
name: "feat: detect a stalled agent by a log unchanged for 5 minutes; bounce and kill it"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
A live-but-hung agent process passes today's pidAlive check forever. Poll must also compare each working agent's log size against ~5 minutes ago: unchanged size means the agent is assumed dead - bounce the task one state back, kill the process, and count the death.

# Specs
User order (2026-10-11): the orchestrator must detect an agent death by comparing the size of its log with 5 minutes ago. Same size => assume the agent died: change the task status to the previous one (e.g. reviewing -> to-review) and kill the existing process.

Facts (current main): poll() (src/orchestrator.ts, called every pollMinutes = 1 min) iterates tasks in working states and bounces on a dead-or-missing pid via DEAD_TRANSITIONS (doing -> to-do, reviewing -> to-review, live-testing -> to-merge after #78/#95; merging -> to-merge). A live-but-hung process (pid alive, no output) passes pidAlive and never recovers. Per-run logs are .kanban/.logs/<slug>.<role>.<n>.log (append-only, pi --mode json streams thinking/tool deltas so a healthy agent writes continuously); the current run's log is the highest-index file for the slug+role. The dead counter is ${slug}.dead (bumped on bounce), RESPAWN_CAP = 5, and #95 gates the respawn past the cap by the idle cooldown. poll() clears the pid files before bouncing (src/orchestrator.ts:861-864 pattern).

Changes (src/orchestrator.ts, src/orchestrator.test.ts):
1. Sample the log size on every poll for each task in a working state (doing, reviewing, live-testing, merging) whose agent pid is alive: the current log is the newest .kanban/.logs/<slug>.<role>.<n>.log for the state-mapped role (the merger uses <slug>.merger.<n>; no log file => no sample, skip the check).
2. Keep an in-memory map slug+role -> { size, since }: when the size changes, update it; when the size is unchanged and now - since >= 5 minutes (const LOG_STALL_MINUTES = 5, overridable like pollMinutes? No - fixed 5 per the user's rule), assume the agent died.
3. On stall: bounce the task one state back via the existing DEAD_TRANSITIONS path (reviewing -> to-review, doing -> to-do, live-testing -> to-merge, merging -> to-merge), unconditional like #95's bounce (never gated by RESPAWN_CAP); kill the process (SIGTERM) and clear its pid files the way the dead-pid bounce does; bump the ${slug}.dead counter so the respawn machinery (immediate under the cap, idle-cooldown past it) takes over. Log line names the task file, e.g. "<task file>: agent log unchanged for 5+ min, assuming dead (state <state>)".
4. The samples map is per daemon lifetime (a restart restarts the 5-min clock; acceptable). Samples are dropped when the task leaves the working state or the pid dies (the dead-pid path owns it then).
5. The bounce uses the same re-read + state-match guard as the dead-pid bounce (re-read the task; skip when the state moved on).
6. Tests (src/orchestrator.test.ts): a working task whose agent pid is alive but whose log does not grow for the stall window bounces one state back, gets killed (pid gone), and the dead counter bumps; a growing log never bounces; a task with no log file is skipped; the bounce is unconditional past RESPAWN_CAP. Keep the existing dead-pid parts intact.

Acceptance:
- A hung (alive, silent) agent's task returns to the previous state within ~5-6 min of silence, the process is killed, and a fresh agent respawns per the existing respawn rules.
- A healthy agent is never bounced (its log grows).
- node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

Constraints:
- Files: src/orchestrator.ts, src/orchestrator.test.ts only.
- False-positive note: 5 minutes of zero log bytes kills a healthy-but-very-slow agent; accepted per the user's rule (healthy pi sessions stream deltas continuously, so silence of 5 min means a hang).
- HOLD: none (sequential merges accepted with the in-flight #113/#114 orchestrator lanes).

# Notes
