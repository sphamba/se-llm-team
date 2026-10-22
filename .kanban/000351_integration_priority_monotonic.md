---
name: "fix: the integration task priority never decreases"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "integration-priority-monotonic"
---

# Summary
ensureIntegrationTask recomputes the waiting integration task priority from the current covered refs on every append. A ref that leaves the board, or a lower-complexity append, can drop the priority. Keep the stored priority when it outranks the derived one, so the queue position only improves.

# Specs
## Needs

- **`ensureIntegrationTask` must not lower the waiting task's priority.** Today it writes the freshly derived value outright (`src/orchestrator/pipeline.ts:140`: `priority: integrationPriority(kept)`). Write the higher of the stored priority and the derived one instead.
- **Add one small helper next to `integrationPriority`** (`src/orchestrator/pipeline.ts:87-94`), for example `higherPriority(stored, next)`. Compare with `PRIORITY_RANK` from `src/kanban.ts:24` (`critical: 0, high: 1, medium: 2, low: 3`; the lower rank wins). A missing or unknown stored priority falls back to `next` (rank `4` already in use there).
- **The initial priority at creation is unchanged.** `createIntegrationTask` still starts from `integrationPriority([covered])` (`pipeline.ts:101`).
- **The other rebuilt fields are unchanged.** The name, summary, specs and covered-ref list still follow the refs that remain on the board. Only the priority is monotonic.
- **The running path is unchanged.** `ensureIntegrationTask` only appends to a task in `to-integration-test`; a task in `integration-testing` keeps its state and its failure to gain a ref mid-run.

### Tests (`tests/orchestrator/integration.test.ts`)

- **Part 3, after the existing critical assertion at `:338`:** append one more covered ref with complexity `simple` (derived medium) and assert the waiting task is still `critical`.
- **Part 3b, the ghost-ref case (`:366-379`):** start a waiting task at a high value (for example `critical` from a complex ref), drop every covered ref from the board, append a `simple` ref, and assert the priority stays `critical` instead of dropping to `low`/`medium`.
- **A pure raise still works:** keep the existing assertions that `moderate -> high` (part 2), `simple -> medium` on create (part 3, `:324`) and `complex -> critical` on append (part 3, `:338`) pass.
- Follow the file's plain-assert and `console.log` style. No `it`/`describe`.

## Constraints

- Monotonic only within the lifetime of one waiting task file. The helper is not a general board priority rule and must not change `updateTask` for other callers.
- Do not change the complexity-to-priority map, the covered-set computation (`coveredOnBoard`), or the name/summary/specs rebuild.
- No new config key, no new state, no new log line.
- Do not touch `README.md`. Task #352 owns all documentation edits.
- The `PRIORITY_RANK` import already exists in `pipeline.ts` (used by the sweep ordering); reuse it, do not copy the rank table.

## Acceptance

- `node tests/orchestrator/integration.test.ts` exits 0.
- `pnpm test` exits 0.

# Notes
## What changed
- `src/orchestrator/pipeline.ts`: new `higherPriority(stored, next)` next to `integrationPriority`, ranked by the existing `PRIORITY_RANK` import, unknown or missing stored rank falls back to `next`; `ensureIntegrationTask` now writes `higherPriority(fresh.priority, integrationPriority(kept))`. Creation, the name/summary/specs rebuild and the running path are untouched.
- `tests/orchestrator/integration.test.ts`: part 3 appends a third `simple` ref after the critical assertion and asserts the priority stays `critical`; part 3b starts the waiting task at `critical`, drops the covered ref from the board (ghost #999999), appends a `simple` ref and asserts the priority stays `critical`. Part 3b failed before the fix (priority dropped to `medium`), part 3's extra append passed before it (the complex ref still outranks the new one).

## Acceptance
- `node tests/orchestrator/integration.test.ts` exit 0 (red before the fix: `AssertionError: the vanished complex ref keeps the waiting task critical`, exit 1).
- `node tests/orchestrator/merge.test.ts` exit 0 (neighbour suite of the merge hook).
- `pnpm test` not run: the developer contract forbids the full suite. Scoped suites above only.
- `git diff --stat` before the commit: 2 files, 18 insertions, 5 deletions.

## Follow-up
- Docs not touched: `docs/architecture.md:28` and `skills/se-llm-team/SKILL.md:19` still say the priority "follows the covered tasks" and do not state the monotonic rule. The Specs assign all documentation edits to task #352.

## 351 live test: integration priority is monotonic

Replayed the production `ensureIntegrationTask(root, covered)` in-process on a fixture board (`src/orchestrator/pipeline.ts:122`), the same function the merged test reaches through `rescan()`. Merged tree: `/home/phamba/repos/se-llm-team/.worktrees/fix/351-integration-priority-monotonic`. Control tree: `HEAD^` = e19068f, extracted with `git archive`, expected pre-fix behaviour.

Runs: 3 merged (labels 1, 2, 3), 1 control. Merged values agree across the 3 runs unless a cell lists more than one value.

| id | claim | expected | merged | control (HEAD^) | result |
| --- | --- | --- | --- | --- | --- |
| 1 | creation from a simple covered ref still derives medium | medium | medium / medium / medium | medium | pass |
| 2 | creation from a moderate covered ref still derives high | high | high / high / high | high | pass |
| 3 | a lower-complexity append keeps a stored critical over the derived medium | critical | critical / critical / critical | medium | pass |
| 4 | a vanished ref keeps the critical a stored task already had | critical | critical / critical / critical | medium | pass |
| 5 | a pure raise still works: stored low plus a complex append | critical | critical / critical / critical | critical | pass |
| 6 | the other rebuilt fields still follow the survivors on the board | test: integration of #2 \| 999999=false | test: integration of #2 \| 999999=false / test: integration of #2 \| 999999=false / test: integration of #2 \| 999999=false | test: integration of #2 \| 999999=false | pass |
| 7 | the running path is unchanged: a running task gains no ref | test: integration of #1 \| waiting=1 \| test: integration of #3 | test: integration of #1 \| waiting=1 \| test: integration of #3 / test: integration of #1 \| waiting=1 \| test: integration of #3 / test: integration of #1 \| waiting=1 \| test: integration of #3 | test: integration of #1 \| waiting=1 \| test: integration of #3 | pass |

Row 3 and row 4 are the fix: pre-fix the derived value overwrote the stored one (control reads `medium`), post-fix the stored `critical` survives. Rows 1, 2, 5, 6 and 7 hold on both trees, so the creation path, the pure raise, the rebuilt name/specs and the running path did not regress.

### Assumptions
- No git repo in the fixture and no `rescan`: `ensureIntegrationTask` reads only the board (`listAll`) and the passed covered task, so the merge fast-forward is not part of the claim. `tests/orchestrator/integration.test.ts` `mergeTask` reaches the same function through `rescan()`.
- The fixture sets stored priorities directly, as the merged part 3b `waitingTask(root, 999999, "critical")` does, because a stored priority outranking the derived one is what the change guards.
- No child process is spawned: this replay is in-process, so there is no measured process liveness and no host-wide scan.

### Not exercised
- The daemon, `poll()`, the integration-tester spawn and the webui card order: the change touches no state, log line, spawn argv or card markup.
- `pnpm test` and `node tests/orchestrator/integration.test.ts`: the role contract forbids running test suites. The merged test file content was read (parts 3 and 3b) and its call form replayed.
- The unknown or missing stored priority fallback (`higherPriority` rank 4): `createTask` normalises the priority, so the value cannot arrive through the production writer, and the frozen table has no row for a hand-edited task file.

### Verdict
All 7 claims pass on the merged tree, and the control tree shows the pre-fix value on exactly the two rows the fix changes (ids 3 and 4).
