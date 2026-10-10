---
name: "feat: orchestrator failsafe auto-schedules oldest highest-priority backlog task"
priority: "critical"
state: "backlog"
worktree: ""
---

# Summary
Failsafe for when nothing gets scheduled: new config autoScheduleMinutes (default 5). When no task is active in any state except backlog/done and the backlog still holds tasks, the daemon promotes the highest-priority, oldest backlog task to to-do after that many minutes of continuous idle. PM promotion stays the primary path.

# Specs
Code (src/orchestrator.ts): add config field autoScheduleMinutes, default 5. In the scan loop, when no task is active in any state except backlog and done and the backlog is non-empty, promote the highest-priority, oldest (lowest number) backlog task to to-do through the normal setState path after that many minutes of continuous idle. Reset the idle timer as soon as any task becomes active. Log one line per promotion.
Tests (src/orchestrator.test.ts): promotes after the delay when idle; does not promote while any task is active; picks the highest priority first and the oldest within the priority.
Schedule note: this task must be scheduled only after the .kanban issues are resolved (after the reconcile fix 000044 is done) - both rewrite the scan loop.

# Notes
