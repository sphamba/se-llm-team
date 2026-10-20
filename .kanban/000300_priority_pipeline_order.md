---
name: "feat: priority orders the pipeline under the cap"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "priority-pipeline-order"
---

# Summary
When maxParallel binds, the scheduler must start higher-priority tasks first across the whole pipeline: sort the per-sweep task pass by priority (creation order within a tier) before the state loop. No preemption, promotion and splitter unchanged.

# Specs
# Problem

The scheduler has no priority awareness. rescan (src/orchestrator/pipeline.ts:322) takes one snapshot via listAll, which is name-sorted (creation order, src/kanban.ts:105-112), and the single state loop (pipeline.ts:345) handles every task in that order. The four maxParallel gates (developer pipeline.ts:64-65, merger :144-145, reviewer :388-389, live-tester :414-415) then serve whichever eligible task comes first by name. A low-priority task created earlier consumes slots before a critical one.

# Decided design (user-confirmed)

1. Sort the per-sweep task pass by priority before the state loop: critical, high, medium, low, with creation order inside a tier. Reuse PRIORITY_RANK from src/kanban.ts:22 (already used by the webui backlog sort, src/webui/board.ts:426); do not add a new ranking table. Sort ascending by PRIORITY_RANK if critical is the highest rank there, or descending, whichever matches the webui usage; keep it in one place.
2. The sort covers the whole state loop, so every capped stage (developer, reviewer, merger, live-tester) picks the highest-priority eligible task first. Effect: a critical task advances through the whole pipeline before lower-priority tasks when the cap binds.
3. Rely on a stable sort or sort by (priority, name) explicitly, so equal priorities keep today's creation order. Say which in a comment.

# Explicitly unchanged

- No preemption: a higher-priority task waits for the next free slot; running agents finish. No new kill paths.
- Backlog promotion (promoteBacklog, pipeline.ts:542) keeps its name order and stays uncapped (test part AY pins promotion to to-do at cap).
- The splitter spawn stays outside the cap (pipeline.ts:56). Even at a full cap, a moderate/complex task gets its split immediately; only the developer start waits.
- The cap itself, the dead-cooldown and respawn paths, the blockedBy and openQuestions gates stay as they are. Test part AH ("blocked critical task not promoted despite priority") must stay green.

# Tests

T1. Ordering under the cap: cap 1 with a low-priority to-review task and a critical to-do task, both eligible, in creation order low-before-critical. Assert the critical task's developer spawns first and the low task's reviewer waits (no reviewer pid file). Then free the slot and assert the reviewer spawns.
T2. Same-priority tie: two same-priority eligible to-do tasks at cap 1 promote/spawn in creation order.
T3. Keep green: promote.test.ts parts AX and AY, sweep.test.ts part AZ, config.test.ts part AQ. Note: no existing test pins ordering among multiple eligible tasks, so these are new pins, not edits.

# Docs

- docs/architecture.md: one sentence in the scheduling/per-state section: under the maxParallel cap the orchestrator starts higher-priority tasks first, creation order within a priority.
- README.md config table: extend the maxParallel row's meaning with "; when the cap binds, higher-priority tasks start first".

# Acceptance

- Scoped orchestrator suites green (promote, sweep, config, spawn as touched), run serially.
- T1 and T2 pass; the whole-pipeline effect is visible in the T1 assertion order.
- No new config key; no changes to promotion, splitter, or kill paths.

# Notes
