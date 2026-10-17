---
name: "feat: review counter reset on to-do re-entry"
priority: "medium"
state: "done"
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
- Implemented the streak reset in src/orchestrator/pipeline.ts rescan: when a to-do task has a non-zero reviewer-runs counter, the sweep writes 0 and logs `<file>: back in to-do, review counter reset`. The reset runs before the deadCooldownActive check and before startTodo, so it is unconditional (dead-developer requeue, manual move, live pid, any complexity). Every other counter and the to-review cap-point reset stay unchanged.
- Test-first: tests/orchestrator/promote.test.ts part AA2 seeds a simple to-do task at the cap (reviewer-runs 1) and asserts the reset log plus exactly one real reviewer spawn. It failed before the fix with AssertionError "to-do arrival resets the streak with one log line", then passed after the fix. All 12 parts of the file pass (exit 0, no AssertionError or timeout).
- Deviation from the Acceptance battery: ran `node tests/orchestrator/promote.test.ts` (the scoped suite) only, per the developer project guidance, and not `pnpm test`. No other suite seeds a non-zero reviewer-runs counter on a to-do task, so no other suite can reach the new branch. Note: src/orchestrator/pipeline.ts has no entry in scripts/test-changed.mjs, so `pnpm test:changed` would fall back to the full list.
- Re-review at e52809a: req 1 settled by the diff — the reset block (src/orchestrator/pipeline.ts:321-329) runs inside the to-do branch before the deadCooldownActive check and startTodo, unconditional (no pid-guard, cooldown, or complexity gate), writes 0 via counterPath and logs `<file>: back in to-do, review counter reset` in the existing log style. Req 2 settled: the diff touches only the to-do branch; the cap-point reset, the cap check, and the dead/push-failure counters are untouched. Req 3 settled: tests/orchestrator/promote.test.ts:124-149 adds part AA2 (to-do task seeded with reviewer-runs 1, the simple cap), the existing cap asserts are unchanged.
- Test totals: all 13 tests/orchestrator/ suites green (exit 0): analysis, hub, log (fast, parallel) then config, daemon, merge, poll, promote, singleton, spawn, split, sweep, worktree (daemon suites, serial). promote.test.ts: 71 asserts, AA2 smoke line printed; the new reset path is exercised. No fixes needed, no open questions.

## Live test (2026-10-17)
- Interface: the merged daemon (`src/orchestrator.ts` from this worktree) over a scratch clone, role-aware fake agent; 2 check phases, 28 live checks, 0 failed.
- Reset on to-do re-entry: a to-do task seeded at the simple cap (reviewer-runs 1) logged `000266_fixture-reset.md: back in to-do, review counter reset` exactly once, its counter file read 0, and its next to-review arrival spawned a real reviewer (log `spawned reviewer ... cwd=.worktrees/fixture-reset`, reviewer prompt recorded, `.logs/000266_fixture-reset.reviewer.0.log` created). No `reviewer succeeded 1+ times, moving to to-merge` line appeared: the fresh review replaced the stale-cap force-merge.
- The reset is unconditional: it also fired for a to-do task with a live pid (no agent spawned, state stayed to-do) and for a to-do task inside the dead-agent cooldown (state stayed to-do, `.dead` stayed 6). Re-seeding the counter on a task still in to-do reset it again on the next rescan (second log line, 0 again).
- Other counters: `.dead`, push-failures, push-warned were untouched by the reset (push counters seeded after the board push settled, no reset-block write in the window). The task file's `# Notes` section stayed byte-identical: the reset is log-only.
- Cap check unchanged: a to-review task seeded at the simple cap (counter 1) logged `reviewer succeeded 1+ times, moving to to-merge`, cleared the counter, spawned no reviewer, and the lane fast-forwarded to live-testing.
- Technical difficulty (harness, not the product): the first cleanup loop pattern-matched the test shell's own cmdline and killed the harness (exit 143). Fixed by killing recorded pidfiles plus a fixture-name allowlist (`fake-pi`, `daemon.mjs`, `analysis-run`).
- Technical difficulty (harness, not the product): the fixture's fake-agent log persisted across runs, so stale spawn records from the earlier run faked two FAILs. The setup now truncates the log.
- Assumptions: the seeded counter stands for prior successful reviews (the simple cap is 1); the fresh-review cap for moderate/complex tasks was not re-measured, the reset is uniform in the diff.
