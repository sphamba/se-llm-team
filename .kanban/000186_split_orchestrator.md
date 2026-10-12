---
name: "refactor: split orchestrator.ts into src/orchestrator modules"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "split-orchestrator"
blockedBy: "#184"
---

# Summary
Split the 1441-line src/orchestrator.ts into smaller more manageable modules in a src/orchestrator/ folder, keeping every named export reachable so imports stay stable.

# Specs

## Change
- Move src/orchestrator.ts into a src/orchestrator/ folder as focused modules, for example: config.ts (loadConfig, config validation, reviewerCap handling), spawn.ts (renderPrompt, spawnAgent, ensureRoleNotes, pid wiring), pipeline.ts (the sweep/state machine, agent spawning per state, consumeReviewerRun, merge/living-test promotion gates), liveness.ts (agent polling, dead-pid bounce, stall detection), index.ts re-exporting everything.
- src/orchestrator/index.ts re-exports every named export the old module had, so index.ts keeps importing './src/orchestrator.ts' (directory resolution) and tests/orchestrator.test.ts keeps its imports.
- Importers to keep working: index.ts imports removeTask and waitForBoardCommits; src/orchestrator.ts imports ./kanban.ts, ./hub.ts (joinHub), ./pid.ts, ./webui.ts (loadWebUiConfig) — those paths stay. No new dependencies; the pipeline behavior (poll cadence, locks, hub registry, promotion gates) must not change.

## Tests
- tests/orchestrator.test.ts (~210 s, real daemons on temp git fixtures) passes unchanged; only its import path may change.

# Notes
- Filed by the PM (user restructure order, 2026-10-12), after the tests move (#184) because both rename the same imports. Disjoint from the webui split (#185), so they may run in parallel once #184 lands.
