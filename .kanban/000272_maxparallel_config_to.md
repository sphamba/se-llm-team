---
name: "feat: maxParallel config to cap tasks running in parallel"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
---

# Summary
The orchestrator starts agent-bearing work without a global parallelism limit. Add a maxParallel config key (default 0 = no limit) that caps how many tasks sit in a working state (doing, reviewing, merging, live-testing) at once; when at the cap, new agent-starting transitions wait and ready tasks queue in to-do. Showcase the key in the README configuration section.

# Specs
Goal: a config key caps how many tasks run in parallel, where running = the task sits in one of the four working states (doing, reviewing, merging, live-testing). Default 0 = no limit. Showcase in README.

Facts (fact-found 2026-10-17):
- Config system: src/orchestrator/config.ts. Config interface L58-68 (agent, backend, pollMinutes, backlogIdleMinutes, retryIdleMinutes, logStallMinutes, llm, roles, reviewerCap). Defaults L5-26. loadConfig L106; precedence L113-121: $XDG_CONFIG_HOME/se-llm-team/se-llm-team.json, legacy ~/.pi/agent/se-llm-team.json only when neutral absent, per-root .kanban/se-llm-team.json overrides; shallow {...cfg,...parsed} merge. Validation patterns to follow: idleMinutes L88 (non-negative, warn+default), reviewerCap integer>=0 L154-168.
- Agent-starting transitions (all in src/orchestrator/pipeline.ts):
  - startTodo L32: splitter branch L43-51 spawns a splitter but STAYS to-do (not a working-state entry), then ensureWorktree L53, setState("doing") L56, spawn developer L57. The cap check must go AFTER the splitter branch, immediately before the setState+spawn pair.
  - to-review branch rescan L354: guards deadCooldownActive, ensureWorktree, counter/cap, pidAlive, then setState("reviewing") L374 + spawn reviewer L375.
  - to-live-test branch L380: guards L384-395, then setState L398 + spawn live-tester L399.
  - sweepToMerge L113: guards agentAlive(slug) L118 and the existing project-wide "at most one merger" agentAlive("merger") L134, then spawn merger L183, setState("merging") L184.
- Backlog promotion: promoteBacklog pipeline.ts L519 (board-wide idle gate L521-540), one step backlog-to-do only (setState L563); starting the developer is separate (next sweep's to-do branch). So under a cap, ready tasks naturally queue in to-do.
- WORKING_STATES exists at liveness.ts:15-22 but is private (maps the four states to {next, success, role}); either export it or use the four state literals in a small helper.
- README: section Configuration (L65), intro L67, example JSON block L69-77 (realistic working values like "pollMinutes": 1, "reviewerCap": {...}), then a Key/Default/Meaning table (L79-96).
- Tests: plain-assert scripts. Config: tests/orchestrator/config.test.ts L20-66 (precedence), logStallMinutes smoke L217 (validation pattern). Branch tests: promote.test.ts (backlog idle gate, reviewer-run cap), sweep.test.ts L182 (double-spawn live-pid guard), split.test.ts L40-108 (startTodo paths), merge.test.ts (merger spawn).

Decided plan (user request 2026-10-17):

1. New config key maxParallel: integer >= 0, default 0 = no limit. Negative or non-integer: warn and fall back to the default, in the style of the existing validators (config.ts L154-176).
2. A small helper in pipeline.ts counts tasks in the four working states (doing, reviewing, live-testing, merging) via listAll. State-based count: a task whose agent died still occupies a slot until the poll requeues it.
3. Gate each of the four agent-starting transitions: when maxParallel > 0 and the count >= maxParallel, skip the start this sweep and leave the task in its current state for the next rescan (the existing idempotent design handles retry). Insert the check immediately before the setState+spawnAgent pair in startTodo (after the splitter branch, before L56), the to-review branch (before L374), the to-live-test branch (before L398), and sweepToMerge (beside the existing at-most-one-merger guard L134). maxParallel 0 (default) skips the check entirely.
4. Backlog promotion is NOT gated: promoteBacklog keeps promoting backlog to to-do, so ready tasks queue there while the cap holds.
5. README showcase: the example JSON block gains "maxParallel": 3 (realistic working value, matching the block's style) and the Key/Default/Meaning table gains a row: maxParallel | 0 | Maximum tasks in a working state (doing, reviewing, merging, live-testing); 0 = no limit.

Tests:
- config.test.ts: default 0, project-local override, negative value falls back with a warning (mirror the logStallMinutes smoke).
- A cap scenario per gated branch in the matching test files (promote.test.ts for the to-review and backlog-queue behavior, split.test.ts or promote.test.ts for startTodo, sweep.test.ts for to-live-test, merge.test.ts for sweepToMerge): at cap no spawn and the task stays in its state; below cap it starts; maxParallel 0 behaves as today.
- Acceptance: the touched test files pass and pnpm test passes.

Operational note: a running daemon keeps its old code until restarted; the cap takes effect on the next daemon restart after landing.

Out of scope: splitter agent parallelism (splitter runs on to-do tasks, not counted), the reviewerCap and the analysis one-failed-attempt guard (unchanged).

# Notes
