---
name: "fix: unconditional dead-agent bounce; idle-cooldown respawn past the cap"
priority: "critical"
state: "backlog"
worktree: ""
---

# Summary
The dead-agent bounce is gated by RESPAWN_CAP: past 5 deaths poll() logs the give-up and freezes the task mid-flight (froze #74 and #72 this session, both fixed manually). Make the bounce unconditional and gate the fresh-agent respawn past the cap by the idle cooldown instead.

# Specs
Facts (main, verified): poll() at src/orchestrator.ts:697-722 iterates listAll, skips conflicted files, reads DEAD_TRANSITIONS (:685-689: doing->to-do, reviewing->to-review, live-testing->done) and bounces when pidAlive(agentPid(root, slug)) is false - a missing pid file counts as dead (agentPid returns 0, pidAlive(0) = false, src/orchestrator.ts:137-145). The bounce is gated: bumpCounter(`${slug}.dead`) > RESPAWN_CAP (= 5, :24) logs the give-up once at cap+1 and continues WITHOUT bouncing, freezing the task mid-flight. The sweep spawns agents per state (to-do -> developer, to-review -> reviewer, to-live-test -> live-tester) and mergeDone runs for done tasks. This gate froze #74 (reviewing, counter 16) and #72 (doing, counter 15) this session; the PM fixed both manually.

Changes (user feedback, critical):
1. The DEAD_TRANSITIONS bounce is unconditional: whenever a task in a mapped in-progress state has a dead-or-missing agent pid, poll() moves it back one step (doing -> to-do, reviewing -> to-review, live-testing -> done) - even past RESPAWN_CAP. "Finishes without updating the task state attribute" is the same case: dead pid + unchanged state.
2. Past the cap the fresh-agent respawn is gated by the idle cooldown (user decision): a task whose dead counter is > RESPAWN_CAP gets a fresh agent only after it has sat idle in the bounced state for cfg.autoScheduleMinutes (5 min default) since the bounce (the task file's update time is the idle clock). Under the cap, today's immediate respawn. The give-up log becomes a cooldown log, e.g. "agent died 5+ times; respawn waits for the idle cooldown", still logged once at cap+1.
3. The dead counter clears when the last run completed successfully: poll() also checks tasks outside the mapped states whose pid is dead and whose dead counter is > 0 (the task advanced out of the mapped state by the agent's own action) and clears the counter, so the cooldown applies to consecutive-death streaks only.
4. Consequence kept as today: a past-cap live-testing -> done bounce merges the branch without a passing live test; mergeDone keeps its existing deferral while agent pids are alive.

Tests (src/orchestrator.test.ts): a task whose agent dies 6+ times still bounces every time (no freeze); the fresh spawn fires only after the idle interval past the cap and immediately under the cap; the counter clears when a run completes successfully; the cooldown log fires once; existing parts G (deferral) and K keep their intent.

Acceptance: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

Constraints:
- Files: src/orchestrator.ts, src/orchestrator.test.ts.
- HOLD behind #87 (to-do, rewrites src/orchestrator.ts + src/orchestrator.test.ts). This task takes precedence over #78 on the poll/DEAD_TRANSITIONS machinery (critical over medium): #78's live-testing->to-merge mapping rebases on this fix and is sequenced after it.

# Notes
