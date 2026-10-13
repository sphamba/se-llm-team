---
name: "refactor: split orchestrator.ts into src/orchestrator modules"
priority: "medium"
state: "reviewing"
worktree: "refactor/186-split-orchestrator"
issuer: "user"
complexity: "complex"
shortName: "split-orchestrator"
blockedBy: ""
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
- Done: 1441-line src/orchestrator.ts split into src/orchestrator/ modules (config, log, spawn, board, pipeline, liveness, main, index) by mechanical line-range extraction from the original, so every statement and comment is byte-exact. Verified with a multiset diff against the HEAD original: the only differences are the planned export keywords, the facade-owned isMainEntry/guard block, and the documented rewires (mergerLogSlug accessor, killPushes, agents-dir depth).
- Spec deviation: Node ESM does not resolve './src/orchestrator.ts' to a same-named directory's index.ts (verified: ERR_MODULE_NOT_FOUND on Node 24), so src/orchestrator.ts stays in place as a thin facade: it re-exports the old 10 named exports from src/orchestrator/index.ts and owns the isMainEntry daemon-start guard. index.ts, tests (spawn and symlink sites) and the README's documented start keep working unchanged. index.ts (root) and package.json needed no changes; scripts/test-changed.mjs left untouched (its src/orchestrator.ts rule still matches the facade; edits under src/orchestrator/ hit the run-all fallback).
- pipeline.ts <-> liveness.ts import cycle broken by moving the mergerLogSlug state into spawn.ts behind setMergerLogSlug/getMergerLogSlug; RESPAWN_CAP (5) and REVIEWER_RUN_CAP (3) live in config.ts; board.ts exports killPushes() for main.ts's exit hook.
- Two missing-import bugs surfaced only at runtime (type stripping does not typecheck): liveness.ts lacked RESPAWN_CAP and pipeline.ts lacked updateAttrs. Both fixed after the first test run flagged them; a grep-based import audit found nothing else (tsc is not installed and adding it is out of scope).
- Verification: daemon start smoke (SE_LLM_TEAM_NO_WEBUI=1) starts, locks, logs and SIGTERM-stops cleanly through the facade guard; all five suites green: tests/kanban.test.ts, tests/orchestrator.test.ts (all smoke parts, including symlinked spawn), tests/webui.test.ts, tests/extension.test.ts, index.test.ts.
