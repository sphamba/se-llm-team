---
name: "fix: unconditional dead-agent bounce; idle-cooldown respawn past the cap"
priority: "critical"
state: "reviewing"
worktree: "fix/95-unconditional-dead-agent"
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
- Implemented on the worktree branch (commit 4934ea6), only src/orchestrator.ts + src/orchestrator.test.ts touched.
- poll(): the DEAD_TRANSITIONS bounce is now unconditional (no RESPAWN_CAP freeze); the counter bump moved after the setState and the give-up log became a cooldown log "agent died 5+ times; respawn waits for the idle cooldown (state <next>)", fired once at cap+1.
- New deadCooldownActive(root, cfg, task) helper: counter > RESPAWN_CAP AND (now - task file mtime) < cfg.autoScheduleMinutes -> defer. Gates all four fresh-agent respawn paths: the to-do developer, the to-review reviewer, the to-live-test live-tester and sweepToMerge's merger (checked before ensureWorktree/setWorktree, which bump the mtime and would restart the clock).
- Counter clear for completed runs: in the no-transition branch, only when the pid file existed with a dead pid (hadPid) and counter > 0. A completed run leaves its stale pidfile behind while a bounce clears it first, so a past-cap task waiting out its cooldown in the bounced state keeps its counter; a run that advanced the task out of the mapped state clears it.
- Adaptations to the live code (already merged #78): DEAD_TRANSITIONS maps live-testing -> to-merge and merging -> to-merge (not the spec's live-testing -> done), mergeDone is replaced by the sweepToMerge merger flow, so the cooldown gate covers sweepToMerge's spawn and "deferral while agent pids are alive" is kept via the existing pidAlive checks.
- Tests: part B rewritten (6 unconditional bounces, cooldown log exactly once, no spawn during the cooldown, counter intact at 6 during the wait, aged mtime releases the spawn, 7th death bounces with no second log; taskB2 live-testing -> to-merge + dead merger requeue kept); parts E/I/R switched from the give-up log to the cooldown log (I now asserts the task parked in to-do, not frozen in doing; R writes done after the cooldown log, safe because the sweep defers the respawn); new part AB: a hand-written stale counter (3) clears on the first completed run and the pipeline still finishes.
- Acceptance: node src/kanban.test.ts, node src/webui.test.ts, node src/orchestrator.test.ts all pass (orchestrator suite: 17 smoke parts, 4 consecutive clean runs; one earlier run hit part T's 30s mirror-commit timeout, a code path this diff does not touch - backlog tasks short-circuit every new check - and passed on every rerun).
- Review (found one issue, fixed): the branch was stale against main - the fork point d93e444 predates main's b7f81bf (open-questions guard), which touched both constrained files (autoSchedule in src/orchestrator.ts, part R in src/orchestrator.test.ts). Merged main into the branch (merge commit 48c813b); the merge auto-resolved cleanly and both halves are verified present: the openQuestions filter in autoSchedule and part R's cooldown waitFor plus the taskRQ/taskRE open-questions coverage.
- Review: re-ran acceptance on the merged tree - node src/kanban.test.ts, node src/orchestrator.test.ts (all smoke parts, including the new part AB), node src/webui.test.ts all pass. A first webui run failed from my own SE_LLM_TEAM_NO_WEBUI=1 override, not the diff; the plain command passes.
- Review: the implementation holds against all four spec changes - unconditional bounce, cooldown log once at cap+1, deadCooldownActive gating all four respawn paths before any mtime-bumping write, counter clear only with a stale pidfile in a non-mapped state (a parked past-cap task keeps its counter). #87 (the HOLD) is done, so the hold is satisfied.
- Review note: the counter-clear-on-completed-run also covers #109's silent-second-streak scenario (a completed run resets the streak to 0, so the next streak crosses cap+1 and logs again). #109 is in live-testing; the PM decides whether to close it after this merge.
