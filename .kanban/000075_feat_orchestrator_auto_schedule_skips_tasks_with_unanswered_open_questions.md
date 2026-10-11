---
name: "feat: orchestrator auto-schedule skips tasks with unanswered open questions"
priority: "medium"
state: "to-merge"
worktree: "feat/75-orchestrator-auto-schedule"
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

- Implemented in src/orchestrator.ts: autoSchedule now filters backlog candidates on a non-empty openQuestions field. A task with unanswered open questions is never promoted. Missing or empty sections promote as before. The idle handling is unchanged.
- src/orchestrator.test.ts part R now creates an older critical task with open questions, plus a critical task with an explicit empty "# Open questions" section. The failsafe promotes the empty-section task and never the open-questions task. Later assertions confirm that the skipped task stays in backlog.
- Checks: all three suites pass (node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts). A negative run with the guard reverted fails at part R as expected.
- Both holds cleared before the start: #38 and #74 are done, so parseTask carries the openQuestions field.
- Commit: b7f81bf.
- Review: no fixes. The guard at src/orchestrator.ts:789 ("!t.openQuestions") matches the trimmed section value from parseTask. A missing section and an empty section both parse to "", so both schedule. The branch is one commit ahead of main, and main is its ancestor.
- Review checks: node src/kanban.test.ts and node src/webui.test.ts pass. Two consecutive node src/orchestrator.test.ts runs pass, part R included.
- Review negative check: a copy with the guard removed promotes 000002_blocked_by_questions.md and fails the part R wait for the empty-questions task, so the test holds the guard. The worktree stays clean at b7f81bf.
- Live test 2026-10-11: no issues found.
- Ran the three suites from the worktree. node src/kanban.test.ts, node src/webui.test.ts and node src/orchestrator.test.ts all pass. The orchestrator suite includes the failsafe auto-schedule part R.
- Manual run: built a throwaway project with three backlog tasks. Task 000001 was critical, oldest, and had an unanswered question. Task 000002 was high with no question section. Task 000003 was medium with an explicit empty section. The config set autoScheduleMinutes to 3s. Ran node src/orchestrator.ts with a stub agent that sets a promoted task to done.
- Result: the failsafe promoted 000002 and then 000003, and each stub run finished. Task 000001 stayed in backlog for the whole run, although it ranked first (critical, oldest). So a task with unanswered open questions is never auto-scheduled, and an empty or missing section schedules normally. Acceptance met.
