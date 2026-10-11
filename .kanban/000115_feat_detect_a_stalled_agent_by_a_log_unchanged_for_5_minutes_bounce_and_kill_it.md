---
name: "feat: detect a stalled agent by a log unchanged for 5 minutes; bounce and kill it"
priority: "high"
state: "doing"
worktree: "feat/115-detect-a-stalled"
---

# Summary
A live-but-hung agent process passes today's pidAlive check forever. Poll must also compare each working agent's log size against a configurable stall window (se-llm-team.json logStallMinutes, default 5): unchanged size means the agent is assumed dead - bounce the task one state back, kill the process, and count the death.

# Specs
User order (2026-10-11): the orchestrator must detect an agent death by comparing the size of its log with a configurable stall window. Same size => assume the agent died: change the task status to the previous one (e.g. reviewing -> to-review) and kill the existing process. Configurable: a top-level se-llm-team.json key logStallMinutes (minutes), default 5.

Facts (current main): poll() (src/orchestrator.ts, called every pollMinutes = 1 min) iterates tasks in working states and bounces on a dead-or-missing pid via DEAD_TRANSITIONS (doing -> to-do, reviewing -> to-review, live-testing -> to-merge after #78/#95; merging -> to-merge). A live-but-hung process (pid alive, no output) passes pidAlive and never recovers. Per-run logs are .kanban/.logs/<slug>.<role>.<n>.log (append-only, pi --mode json streams thinking/tool deltas so a healthy agent writes continuously); the current run's log is the highest-index file for the slug+role. The dead counter is ${slug}.dead (bumped on bounce), RESPAWN_CAP = 5, and #95 gates the respawn past the cap by the idle cooldown. poll() clears the pid files before bouncing (src/orchestrator.ts:861-864 pattern). loadConfig (src/orchestrator.ts) shallow-spreads ~/.pi/agent/se-llm-team.json then <root>/.kanban/se-llm-team.json with keys like pollMinutes, autoScheduleMinutes; invalid values warn and keep the default (the reviewerCap pattern from #98).

Changes (src/orchestrator.ts, src/orchestrator.test.ts):
1. Config: a top-level se-llm-team.json key "logStallMinutes" (minutes) - loadConfig picks it with default 5; an invalid value (non-number or <= 0) warns ("logStallMinutes \"X\" ignored: must be a positive number of minutes") and keeps 5. Add it to the README config table row for the daemon keys.
2. Sample the log size on every poll for each task in a working state (doing, reviewing, live-testing, merging) whose agent pid is alive: the current log is the newest .kanban/.logs/<slug>.<role>.<n>.log for the state-mapped role (the merger uses <slug>.merger.<n>; no log file => no sample, skip the check).
3. Keep an in-memory map slug+role -> { size, since }: when the size changes, update it; when the size is unchanged and now - since >= cfg.logStallMinutes, assume the agent died.
4. On stall: bounce the task one state back via the existing DEAD_TRANSITIONS path (reviewing -> to-review, doing -> to-do, live-testing -> to-merge, merging -> to-merge), unconditional like #95's bounce (never gated by RESPAWN_CAP); kill the process (SIGTERM) and clear its pid files the way the dead-pid bounce does; bump the ${slug}.dead counter so the respawn machinery (immediate under the cap, idle-cooldown past it) takes over. Log line names the task file and the configured window, e.g. "<task file>: agent log unchanged for 5+ min, assuming dead (state <state>)".
5. The samples map is per daemon lifetime (a restart restarts the clock; acceptable). Samples are dropped when the task leaves the working state or the pid dies (the dead-pid path owns it then).
6. The bounce uses the same re-read + state-match guard as the dead-pid bounce (re-read the task; skip when the state moved on).
7. Tests (src/orchestrator.test.ts): a working task whose agent pid is alive but whose log does not grow for the stall window bounces one state back, gets killed (pid gone), and the dead counter bumps; a growing log never bounces; a task with no log file is skipped; the bounce is unconditional past RESPAWN_CAP; the default window is 5 and a configured value applies; an invalid value warns and keeps 5. Keep the existing dead-pid parts intact.

Acceptance:
- A hung (alive, silent) agent's task returns to the previous state within ~cfg.logStallMinutes + one poll of silence, the process is killed, and a fresh agent respawns per the existing respawn rules.
- A healthy agent is never bounced (its log grows).
- A missing logStallMinutes key keeps 5; an invalid value warns and keeps 5.
- node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

Constraints:
- Files: src/orchestrator.ts, src/orchestrator.test.ts, README.md.
- False-positive note: a stall window of zero log bytes kills a healthy-but-very-slow agent; accepted (healthy pi sessions stream deltas continuously, so silence means a hang).
- HOLD: none (sequential merges accepted with the in-flight #113/#114 orchestrator lanes).

# Notes
