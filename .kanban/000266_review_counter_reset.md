---
name: "feat: review counter reset on to-do re-entry"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "review-counter-reset"
---

# Summary
The per-task reviewer-runs counter counts successful reviewer runs across the task's whole life, so a task that re-enters to-do keeps its stale count and can skip review entirely on its next to-review arrival. Make the counter count successive reviews: on every rescan, a task found in to-do with a non-zero count resets it to 0.

# Specs
Problem: the per-task reviewer-runs counter (.kanban/.logs/<slug>.reviewer-runs.count) counts successful reviewer runs across the task's whole life. The rescan's cap check (src/orchestrator/pipeline.ts:330-344: readCounter >= cap → force-advance to to-merge) keys off that lifetime count. So a task that re-enters to-do after reviews (manual PM move, dead-developer requeue via liveness.ts:16 doing.next, live-test failure, rework) keeps its old count: on its next to-review arrival the stale count can force-merge without any fresh review.

Decided (user interview 2026-10-17):
- The counter counts SUCCESSIVE reviews: a review streak = successful reviewer runs with no to-do re-entry in between.
- New rule: on every rescan, any task found in to-do with a non-zero reviewer-runs counter resets the counter to 0, with one log line. The rule is uniform: dead-developer requeues and manual moves break the streak too, and the reworked task gets a full fresh review cap (e.g. 2 passes for moderate).
- Reset is recorded in the orchestrator log only, no task-file Notes line.
- Priority medium.

Requirements:
1. src/orchestrator/pipeline.ts rescan, in the to-do handling (the branch that calls startTodo, pipeline.ts:321): before or alongside startTodo, read the counter for the task slug; when > 0, write 0 and log one line in the existing style (e.g. "<file>: back in to-do, review counter reset"). The reset is unconditional: not gated by deadCooldownActive, the startTodo pid guard, or complexity.
2. Keep every other counter untouched: <slug>.dead, push-failures, push-warned. Keep the existing cap-point reset at pipeline.ts:337 and the cap check itself unchanged (their "reviewer succeeded N+ times" force-merge is asserted by tests).
3. Tests (tests/orchestrator/promote.test.ts): add one scenario — a task that sits in to-do with a seeded non-zero reviewer-runs count (>= its complexity cap) resets to 0 on the next rescan and, on reaching to-review, gets a real reviewer spawn instead of the cap force-merge. The existing cap asserts (lines 116, 207-209, 241, 254) stay green unchanged.

Acceptance:
- node tests/orchestrator/promote.test.ts passes with the new scenario.
- pnpm test passes end to end.

# Notes
