---
name: "feat: the integration task priority follows the covered task complexity"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "integration-priority-complexity"
---

# Summary
The auto-created integration task no longer starts at priority low. It takes the priority of the tasks it covers: trivial low, simple medium, moderate high, complex critical. When it covers several tasks, the highest priority wins. Delivered on main in commit 02bb908.

# Specs
## Delivered

Commit 02bb908, on main at HEAD.

## Needs

- New map `PRIORITY_BY_COMPLEXITY` and function `integrationPriority(covered)` (src/orchestrator/pipeline.ts:87-94):
  - trivial -> low
  - simple -> medium
  - moderate -> high
  - complex -> critical
- A missing or an unknown complexity maps to `medium`.
- `createIntegrationTask` passes the derived priority. It was hard-coded `low` (pipeline.ts:101).
- `ensureIntegrationTask` writes the derived priority on every append, so an append can raise the priority of a waiting task (pipeline.ts:140).
- The integration task keeps complexity `simple` and issuer `auto` (pipeline.ts:102).
- docs/architecture.md:28 and skills/se-llm-team/SKILL.md:19 state the rule.

## Constraints

- Under `maxParallel` the sweep orders tasks by priority first (task #300), so the lane task now queues above low tasks.
- The derived priority can differ from the task's own `complexity: simple`. That is intended.
- An append that finds no covered task on the board gives an empty list, thus `low`. The code does not keep an older higher value. This is out of scope of this change.
- The done cards #308:32, #309:74 and #311:20,:118 still say the integration task keeps priority `low`. They are done history. Board hygiene only.

## Acceptance

- `node tests/orchestrator/integration.test.ts` exits 0. Part 2 pins moderate -> high. Part 2b loops over all four rows of the map. Part 3 pins simple -> medium on create and complex -> critical on append.
- `pnpm test` exits 0.

# Notes
