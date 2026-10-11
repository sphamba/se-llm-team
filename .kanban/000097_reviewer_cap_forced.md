---
name: "fix: reviewer-cap forced-advance log line omits the task file"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
The forced-advance log line "reviewer succeeded 3+ times, moving to to-live-test" (to-review branch of rescan, src/orchestrator.ts) does not name the task file, unlike every other state-touching log line. Append the task file (or slug) to the message so the operator can attribute forced advances in .kanban/.logs/orchestrator.log.

# Specs
FINDING (from the live test of task #000087, feat: per-run agent log files; spawnAgent writes slug.role.N.log — task already done):

The reviewer-cap forced-advance log line "reviewer succeeded 3+ times, moving to to-live-test" (src/orchestrator.ts, the to-review branch of rescan) does not name the task file. Every other state-touching log line names the task (for example "spawned reviewer pid=... for <task file>" and "<task file>: agent pid=... dead without state update").

During the live test, several tasks sat in to-review at once, and reading .kanban/.logs/orchestrator.log afterwards, the operator could not tell which task each forced advance belonged to.

FIX: Append the task file (or slug) to that log message, so the forced advance is attributable per task like the other state-touching log lines.

This is a minor observability/log-quality fix; no behavior change beyond the log text.

# Notes
