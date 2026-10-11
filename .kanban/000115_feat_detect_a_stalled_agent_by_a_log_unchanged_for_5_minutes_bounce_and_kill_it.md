---
name: "feat: detect a stalled agent by a log unchanged for 5 minutes; bounce and kill it"
priority: "high"
state: "done"
worktree: ""
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

- Implemented in the worktree (commit fc4540a). The prior uncommitted session work in the worktree was kept and extended: the stall detection existed but used a module constant, so the spec-required logStallMinutes config key was wired through (Config interface, loadConfig with default 5 and the spec's warning text for non-number or <= 0 values, poll(root, stallMinutes, now) threading, main passes cfg.logStallMinutes). The old DEAD_TRANSITIONS map became WORKING_STATES carrying the bounce target plus the log-sampling role per state; both death kinds (dead pid, stalled log) share bounceDead, which SIGTERMs on request, clears pid files, re-reads with the state-match guard, bounces, and bumps the ${slug}.dead counter. A merging task samples only while the live merger is its own (mergerLogSlug, set in sweepToMerge). README gained the logStallMinutes table row.
- Tests: prior part AN (direct poll with an injected clock) updated for the new poll signature and extended coverage; added part AO (a configured 2-minute window bounces at the 2-minute edge) and part AP (loadConfig directly under an empty temp HOME: missing key keeps 5, 0.05 applies, "banana" and 0 warn and keep 5). loadConfig is now exported for that test.
- node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts and node index.test.ts all pass.
- Skipped: no per-daemon-sample persistence (spec accepts a restart restarting the clock) and no stall check for a hung merger serving another task after a daemon restart (mergerLogSlug is null until the next sweepToMerge; the dead-pid path still catches a dead merger).
- Review (worktree commit fc4540a, clean, only the three allowed files changed): passed, no fixes. Verified against every spec item: loadConfig picks logStallMinutes with default 5 and the spec's warning text for non-number or <= 0; the poll stall branch samples only working-state tasks with a live pid, takes the newest per-run log via nextRunIndex - 1 (n < 0 or a vanished file means no sample), keys logSamples by slug.role and restarts the window on a new run (path change) or any size change, and reports a stall at now - since >= window; bounceDead SIGTERMs, clears the pid file (merger.pid for merging), re-reads with the state-match guard, bounces unconditionally past RESPAWN_CAP and bumps ${slug}.dead; samples drop on a dead pid and outside the working states. The mergerLogSlug guard is sound: sweepToMerge spawns at most one merger project-wide and sets the slug before the spawn, so a stale slug never samples another task's merger log. The stall-bounced reviewer cannot fake a reviewer-runs success (the armed marker mismatches the cleared pid file) and the respawn machinery takes over per the existing cooldown rules. All seven test requirements covered by parts AN/AO/AP; the old dead-pid smokes still pass. Ran node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts and node index.test.ts: all pass.
- Review note (accepted divergence): bounceDead's re-read + state-match guard (skip when fresh.state !== task.state) is new for the dead-pid path too. Main's dead-pid bounce re-read but set the state unconditionally, so a task that moved on between listAll and the bounce got stomped back and its dead counter bumped. The new shared guard is strictly safer and matches spec item 6's intent; the pre-bounce dead-pid log line can then describe a bounce the guard skipped (rare milliseconds-wide race, board state stays truthful), left as-is.

## Live test report (2026-10-11)

Method: ran the real daemon (`node src/orchestrator.ts --root <tmp> --no-webui --poll-minutes 0.05 --rescan-seconds 3600`) against a throwaway git project. A `sleep 300` process stood in for the agent, with its pid in `.kanban/.pids/<slug>.pid` and a real per-run log under `.kanban/.logs/`. Config `logStallMinutes` = 0.05 min (3 s), so one poll window is 3 s. The daemon polls every 3 s. No `*.test.ts` file ran.

- Healthy log (pass): the log grew every second. After 5 polls the state stayed `doing`, the process stayed alive, and no dead counter existed. The stall path did not fire.
- Stall (pass): a static log on a live pid bounced `doing -> to-do` at ~3.3 s, that is within one poll after the window. SIGTERM killed the process, the pid file was removed, `${slug}.dead.count` became 1, and the log line read `000200_lt_stall_probe.md: agent log unchanged for 0.05+ min, assuming dead (state doing)`.
- Past RESPAWN_CAP (pass): with `${slug}.dead = 5` the same static log still bounced and killed, the counter became 6, and the line `agent died 5+ times; respawn waits for the idle cooldown (state to-do)` appeared. The bounce is unconditional.
- Invalid config (pass): `"logStallMinutes": "banana"` warned `logStallMinutes "banana" ignored: must be a positive number of minutes` and no bounce occurred over 10 s (about 3 poll windows), so the default 5 min stayed in force.
- No log file (pass): a live pid with no matching per-run log was skipped over 10 s (state stayed `doing`). The check needs an existing log.
- Dead pid regression (pass): a killed pid still bounced `doing -> to-do`, cleared the pid file, and bumped the counter.
- README: the `logStallMinutes` row is present with the default 5, the bounce/kill behavior, and the invalid-value warning.

Result: no issues found. The stall window is configurable, applies within the window plus one poll, kills the process, bounces one state back, and counts the death. The healthy, no-log and dead-pid paths behave as specified. The worktree stayed clean (no code change by the live test).
