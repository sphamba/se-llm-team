---
name: "feat: orchestrator failsafe auto-schedules oldest highest-priority backlog task"
priority: "critical"
state: "reviewing"
worktree: "feat/orchestrator-failsafe-auto-schedules-oldest-highest-priority-backlog-task"
---

# Summary
Failsafe for when nothing gets scheduled: new config autoScheduleMinutes (default 5). When no task is active in any state except backlog/done and the backlog still holds tasks, the daemon promotes the highest-priority, oldest backlog task to to-do after that many minutes of continuous idle. PM promotion stays the primary path.

# Specs
Code (src/orchestrator.ts): add config field autoScheduleMinutes, default 5. In the scan loop, when no task is active in any state except backlog and done and the backlog is non-empty, promote the highest-priority, oldest (lowest number) backlog task to to-do through the normal setState path after that many minutes of continuous idle. Reset the idle timer as soon as any task becomes active. Log one line per promotion.
Tests (src/orchestrator.test.ts): promotes after the delay when idle; does not promote while any task is active; picks the highest priority first and the oldest within the priority.
Schedule note: this task must be scheduled only after the .kanban issues are resolved (after the reconcile fix 000044 is done) - both rewrite the scan loop.

# Notes

- [2026-10-11 08:18] Implemented in worktree feat/orchestrator-failsafe-auto-schedules-oldest-highest-priority-backlog-task, commit 87f3240. src/orchestrator.ts: new config field autoScheduleMinutes (default 5, documented in the README config table); module-level idleSince timer plus an autoSchedule() step called at the end of every rescan. When no non-conflicted task sits in any state except backlog/done and the backlog is non-empty, the oldest (lowest task number) task of the highest present priority is promoted to to-do through the normal setState path after autoScheduleMinutes of continuous idle, with one log line per promotion. The timer resets as soon as any task is active or the backlog empties, so PM promotion stays the primary path and a newly created backlog task after a fully done board gets a fresh window. Conflicted files are excluded from the check (bogus parsed state) and a failed setState is caught and logged. src/orchestrator.test.ts part R covers all three spec cases with the dead-stub agent: no promotion while a task is active (10s with an active to-do task), promotion of the older critical task over a newer critical and a low task once the board goes idle, and no second promotion while the promoted task stays active. orchestrator.test.ts, kanban.test.ts and webui.test.ts all pass.