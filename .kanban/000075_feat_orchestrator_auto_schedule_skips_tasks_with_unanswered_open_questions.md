---
name: "feat: orchestrator auto-schedule skips tasks with unanswered open questions"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
autoSchedule (the automatic job scheduling failsafe) never promotes a backlog task that has a non-empty open-questions section; missing or empty sections schedule normally.

# Specs
The orchestrator's automatic job scheduling failsafe must not schedule a task that has unanswered open questions.

Facts:
- autoSchedule(root, cfg, tasks) (src/orchestrator.ts:624-647, called at the end of the per-task sweep at 602) is the automatic job scheduling failsafe: it filters !t.conflicted, picks backlog candidates, gates promotion on cfg.autoScheduleMinutes (default 5) of continuous idle, ranks by priority then taskNum, and setState to "to-do". It checks only state/conflicted/idle-time - no open-questions condition exists (verified at HEAD 401d398).
- Task A (this board) adds an openQuestions field to parseTask's Task object; autoSchedule consumes the same tasks.
- #38 (hub backend) is live-testing: its merge rewrites src/orchestrator.ts.

Changes:
1. autoSchedule: exclude candidates with a non-empty openQuestions field from promotion; a task with at least one unanswered open question is never auto-scheduled. Missing or empty section schedules normally. If no candidates remain, do not promote (idle handling unchanged).
2. src/orchestrator.test.ts: a backlog task with open questions is never promoted, even past the idle gate; an empty or missing section promotes after the idle gate as today. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- The auto-scheduler never schedules a task with unanswered open questions; normal scheduling is unchanged otherwise.

Constraints:
- Files: src/orchestrator.ts, src/orchestrator.test.ts.
- HOLD behind 000038 (live-testing): its merge rewrites src/orchestrator.ts. Also HOLD behind task A ("feat: agents list open questions in the task body"): autoSchedule needs the openQuestions field that task A adds to parseTask. Promote only after both are done.

# Notes
