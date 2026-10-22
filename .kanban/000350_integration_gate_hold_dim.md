---
name: "fix: hold a waiting integration task when integration testing is off"
priority: "medium"
state: "live-testing"
worktree: "fix/350-integration-gate-hold-dim"
issuer: "user"
complexity: "moderate"
shortName: "integration-gate-hold-dim"
---

# Summary
With integrationTesting false, the integration sweep still promotes a task waiting in to-integration-test and spawns an integration-tester. Guard the sweep so the task stays in to-integration-test, and dim its card in the web UI like a disabled column. A run already in integration-testing still finishes.

# Specs
## Needs

### Pipeline gate

- **`sweepToIntegrationTest` returns early when `cfg.integrationTesting === false`.** The function is in `src/orchestrator/pipeline.ts:351-364` and `cfg` is already a parameter. Put the guard beside the existing user-hold guard at `:353`, before any state move.
- **The waiting task keeps `to-integration-test`.** While the flag is false: no `setState` to `integration-testing`, no `writeMergerSlug`, no `spawnAgent`, no integration-tester pid or armed file.
- **No new log line.** The sweep runs on every rescan (10 s), so a per-scan line would spam. The board state and the UI fade carry the fact.
- **All existing guards keep their order and effect:** user hold, one integration-tester project-wide, `maxParallel` cap, dead cooldown. The new gate is another early return, not a replacement.
- **Today's creation gate stays as is.** `sweepToMerge` already logs `<task>: integration testing is off, no integration task queued` and opens no task (`pipeline.ts:334-337`). Do not change it.

### Web UI fade

- **Dim the cards of the `to-integration-test` column when the flag is false.** Add one CSS rule at `src/webui/page.ts:135-136`, scoped to both the disabled column and the waiting column class, for example `.col.off.c-to-integration-test .card { opacity: .4 }`. The `.c-<state>` class already exists on every column (`src/webui/board.ts:265`).
- **Only that column dims.** Do not dim cards in `integration-testing`, because a run can outlive the flag flip. Do not dim cards in any other stage's columns.
- **A user-held card in the dimmed column dims too.** No exception.
- **`applyStages` needs no change.** It already toggles `off` on both columns of the stage (`src/webui/board.ts:300-310`).
- **Update the two stale comments:** `src/webui/board.ts:299` ("task cards stay at full opacity") and `src/webui/page.ts:134` (same claim).

### Tests

- **Replace the stale pin at `tests/webui/board.test.ts:103`.** It currently asserts that `.col.off .card` is absent. Pin the new scoped rule instead (`.col.off.c-to-integration-test .card`) and keep asserting that no generic `.col.off .card` rule exists. Keep the existing `off` map, all-on restore and CSS string cases green.
- **Add the gate-hold case to `tests/orchestrator/stages.test.ts`.** Seed a task in `to-integration-test`, run a sweep with `integrationTesting: false`, and assert: state is still `to-integration-test`, no merger slug, no integration-tester pid. Add the mirror case: with the flag on, the same seed moves to `integration-testing`. Follow the file's existing plain-assert style.
- **Keep the #346 gate cases green**, including the merge-time creation skip and its log line.

## Constraints

- The gate acts at stage start only. A task already in `integration-testing` when the flag turns off finishes its run. Do not stop or requeue it.
- No new config key, no new state, no change when the flag is true (the default).
- Do not touch `README.md`. Task #352 owns all documentation edits.
- Do not touch `docs/architecture.md`.
- The card opacity value is `.4`, the same as the column chrome. Use plain `opacity`; do not use `filter`, so the hover background still applies.
- The change must not affect the merge fast-forward, the live-test move, or the `ensureIntegrationTask` append path.

## Acceptance

- `node tests/orchestrator/stages.test.ts` exits 0.
- `node tests/webui/board.test.ts` exits 0.
- `node tests/orchestrator/integration.test.ts` exits 0.
- `pnpm test` exits 0.
- Manual check: with `integrationTesting: false` in `~/.se-llm-team/config.json`, a task in `to-integration-test` stays there across rescans and renders at 0.4 opacity, while a task in `integration-testing` keeps full opacity.

# Notes
- Splitter pass, no split (#350, 2026-10-22). The task runs as one developer pass.
  - The change surface is small. One early return in `sweepToIntegrationTest` (`src/orchestrator/pipeline.ts:353`), one scoped CSS rule (`src/webui/page.ts:135`), the two stale comment fixes (`src/webui/board.ts:299`, `src/webui/page.ts:134`), one pin replacement (`tests/webui/board.test.ts:103`) and one seed-and-assert block in `tests/orchestrator/stages.test.ts`. That is about 10 source lines and 30 test lines.
  - A split is technically clean. The file sets are disjoint. The gate piece owns `src/orchestrator/pipeline.ts` plus `tests/orchestrator/stages.test.ts`, and the fade piece owns `src/webui/page.ts`, `src/webui/board.ts` plus `tests/webui/board.test.ts`. No shared fact is derived twice.
  - The split cost is larger than the saving. Each subtask pays one worktree, one developer run, one review pass, one merge cycle and one live test. Two of those cycles cost more than this whole change.
  - The manual acceptance check needs both pieces in the same run: one daemon with `integrationTesting: false` and the page that the daemon serves. A single live test proves the column hold and the 0.4 opacity together. Two live tests repeat the fixture setup, and neither of them proves the pair.
  - Hints for the developer, so the pass stays short. `sweepToIntegrationTest` has one call site, inside the rescan loop at `src/orchestrator/pipeline.ts:592`. `tests/orchestrator/stages.test.ts` already has the `cfgFor(root, extra)` helper and the `deadStub` agent, so a no-spawn claim is one pid and one armed-file check. Part 4 of that file already loads `integrationTesting: false` and its own fixture root, so the gate case fits beside it.
  - Durable guidance for future splitters of this board: do not split a small "gate plus fade" fix whose manual acceptance needs the daemon and the page in one run. Split an orchestrator plus web-UI task only when each side has a real surface, for example more than one state or view, or when each side needs its own live fixture.

## What changed
- `src/orchestrator/pipeline.ts`: `sweepToIntegrationTest` returns early on `!cfg.integrationTesting`, after the user-hold guard and before any state move. No log line.
- `src/webui/page.ts`: new rule `.col.off.c-to-integration-test .card { opacity: .4; }`; the stale "task cards stay at full opacity" comment now names the waiting column and the in-flight exception.
- `src/webui/board.ts`: the same stale comment updated on `applyStages`; no code change there.
- `tests/orchestrator/stages.test.ts`: part 5 seeds a task in `to-integration-test`. With the flag off it holds across two rescans with no slug, no integration-tester pid, no armed file and no log line for the task. With the flag on the same seed moves to `integration-testing` and records the slug.
- `tests/webui/board.test.ts`: the stale `.col.off .card` absence pin replaced by the scoped rule pin, plus a negative pin for `.col.off.c-integration-testing .card` and the kept generic-rule absence.

## Acceptance
- `node tests/orchestrator/stages.test.ts` exit=0 (red before the source edit: `actual: 'integration-testing'`).
- `node tests/webui/board.test.ts` exit=0 (red before the source edit: missing scoped rule). Covers `src/webui/page.ts` and `src/webui/board.ts`.
- `node tests/orchestrator/integration.test.ts` exit=0 (#346 gate cases, part 16 user hold, part 17 hook throw).
- `node tests/webui/page.test.ts` exit=0 (serves the changed page).
- `pnpm test` skipped: the developer policy forbids the full suite in a code run, and these four suites cover every changed file.
- Manual check stood in by assertions: the hold across two rescans (`stages.test.ts` part 5) plus the served scoped rule with the `c-to-integration-test` class on the column (`board.test.ts`). The daemon-backed visual check belongs to the live-test step.
- `git diff --stat` after the commit: 5 files, 39 insertions, 4 deletions.

## Follow-up
- `README.md`, `docs/architecture.md` and the role docs are untouched; task #352 owns those edits.
