---
name: "fix: hold a waiting integration task when integration testing is off"
priority: "medium"
state: "done"
worktree: ""
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

### Live test: #350 integration gate hold and waiting-column fade

- Worktree: `/home/phamba/repos/se-llm-team/.worktrees/fix/350-integration-gate-hold-dim` (merged commit 8b57742), run from that tree.
- Control tree: `/tmp/live350-ig/pre-fix` (commit 1340913e538fa14dde85e17e1ddfc9e3fee56677), the first ancestor whose stat does not touch the changed files. Extracted with `git archive`.
- Driver: `/tmp/live350-ig/driver.mjs` (`run <label> <tree> <n>` | `report`), wrapper `/tmp/live350-ig/run.sh`.
- Runs: merged n=1,2,3; control n=1. Live fixture per run: a git repo, a fake executable agent that appends one JSON line to a capture file, a hub on port 0.
- Assumptions: the daemon timers are not part of these claims, so the gate went through `rescan(root, loadConfig(root), true)` in-process, the same call the rescan loop makes (`src/orchestrator/main.ts:109`). The served page used `startHub` with the stage flags that `main.ts:158` passes from `cfg`. Opacity was sampled after the card entrance animation settled (two equal samples and no `.card.enter`), with the mouse at 0,0. The shared host was not counted; every check is scoped to a unique fixture root.
- Not exercised: `pnpm test` and every `*.test.ts` file (not a live test), the production web UI port (port 0), a real LLM agent (fake executable), and the real CLI daemon process (in-process rescan).

| id | claim | expected | merged value | merged ok | control value | control |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | flag off: waiting task stays after 2 rescans | `to-integration-test` | `to-integration-test` | 3/3 | `integration-testing` | ok |
| 2 | flag off: no integration-tester slug | `none` | `none` | 3/3 | `000001_integration_of_50` | ok |
| 3 | flag off: no integration-tester pid file | `absent` | `absent` | 3/3 | `present` | ok |
| 4 | flag off: fake agent capture empty after 3 s | `0` | `0` | 3/3 | `1` | ok |
| 5 | flag off: no orchestrator log line names the task | `no-line` | `no-line` | 3/3 | `line` | ok |
| 6 | flag on: same seed moves to integration-testing | `integration-testing` | `integration-testing` | 3/3 | `integration-testing` | ok |
| 7 | flag on: slug records the task slug | `000001_integration_of_51` | `000001_integration_of_51` | 3/3 | `000001_integration_of_51` | ok |
| 8 | flag on: fake agent capture has one record | `1` | `1` | 3/3 | `1` | ok |
| 9 | flag off: in-flight task survives a rescan | `integration-testing` | `integration-testing` | 3/3 | `integration-testing` | ok |
| 10 | flag off: waiting card computed opacity | `0.4` | `0.4` | 3/3 | `1` | ok |
| 11 | flag off: in-flight card keeps full opacity | `1` | `1` | 3/3 | `1` | ok |
| 12 | flag off: waiting column carries the off class | `off` | `off` | 3/3 | `off` | ok |
| 13 | flag on: waiting card computed opacity | `1` | `1` | 3/3 | `1` | ok |

- Served CSS evidence (flag off): scoped `.col.off.c-to-integration-test .card { opacity: 0.4; }`; generic `.col.off .card` `(none)`; in-flight scoped `(none)`.
- Served card geometry (flag off): wait 278x64.25 run 278x64.25 px, both columns in the same pair.
- Red proof: no red merged row. The control is red by design on rows 1, 2, 3, 4, 5, 10 (pre-fix behaviour). All other rows agree across trees.
- Saved-pid cleanup: merged-1: 838483=gone, 838522=gone; merged-2: 838741=gone, 838780=gone; merged-3: 838990=gone, 839037=gone; control-1: 839238=gone, 839277=gone. A state of `gone` or `Z` counts as dead. Fixture roots were removed after each run.
- Verdict: PASS. All 13 merged rows match their expected value in all 3 runs. The control matches the pre-fix value on every row.
