---
name: "fix: the integration task priority never decreases"
priority: "medium"
state: "backlog"
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
