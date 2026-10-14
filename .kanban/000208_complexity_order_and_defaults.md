---
name: "fix: complexity order trivial-first; defaults autoScheduleMinutes 1, logStallMinutes 10"
priority: "medium"
state: "reviewing"
worktree: "fix/208-complexity-order-and-defaults"
issuer: "user"
complexity: "simple"
shortName: "complexity-order-and-defaults"
---

# Summary
Write the complexity values in the order trivial, simple, moderate, complex everywhere in code and docs (COMPLEXITIES array, tool enums, reviewer-cap record, CSS chips, README, docs/architecture.md), and change the defaults to autoScheduleMinutes = 1 and logStallMinutes = 10 in code, README, and the coupled test.

# Specs
## Need

Two changes the user requested:
1. The complexity attribute's four values are written and documented everywhere in the order: trivial, simple, moderate, complex.
2. The default values become autoScheduleMinutes = 1 and logStallMinutes = 10.

Facts (verified):
- Old order `simple, moderate, complex, trivial` appears in: src/kanban.ts:23 (`export const COMPLEXITIES = ["simple", "moderate", "complex", "trivial"] as const;`), index.ts:75 and :104 (`StringEnum(["simple", "moderate", "complex", "trivial"] as const)` in kanban_create + kanban_update), src/orchestrator/config.ts:17 (`DEFAULT_REVIEWER_CAP: Record<string, number> = { simple: 1, moderate: 2, complex: 3, trivial: 0 };`), and the CSS chip block src/webui/page.ts:164-168 (`.cx-simple` → `.cx-moderate` → `.cx-complex` → `.cx-trivial`).
- Old order in docs: README.md:51 ("nested under `simple`, `moderate`, `complex` or `trivial`") and :52 ("simple `1`, moderate `2`, complex `3`, trivial `0`"), docs/architecture.md:5 ("(`simple`, `moderate`, `complex` or `trivial`)").
- Already trivial-first, no change: index.ts:68 help text ("Set complexity to trivial, simple, moderate (default) or complex"), skills/se-llm-team/SKILL.md:32, docs/architecture.md:16 ("0 for trivial, 1 for simple, 2 for moderate, 3 for complex"), src/orchestrator/config.ts:24 comment (update it to match anyway: "trivial/simple/moderate/complex").
- Defaults: src/orchestrator/config.ts:7 `const DEFAULT_AUTO_SCHEDULE_MINUTES = 5;` and :9 `const DEFAULT_LOG_STALL_MINUTES = 5;`. README.md:45-46 document both as `5`.
- Test coupling: tests/orchestrator.test.ts:2503-2515 asserts `loadConfig(...).logStallMinutes === 5` for missing/non-number/`0` — update to 10 in the same change. No test asserts the autoScheduleMinutes default or any complexity array order.

## Changes

- Reorder every old-order occurrence to trivial, simple, moderate, complex: the COMPLEXITIES array (kanban.ts:23), both StringEnum lists (index.ts:75, :104), the DEFAULT_REVIEWER_CAP record keys (config.ts:17, keep values trivial 0 / simple 1 / moderate 2 / complex 3), the CSS chip class block (page.ts:164-168), README.md:51-52, docs/architecture.md:5, and the comment at src/orchestrator/config.ts:24.
- Change the defaults: config.ts:7 to `const DEFAULT_AUTO_SCHEDULE_MINUTES = 1;` and config.ts:9 to `const DEFAULT_LOG_STALL_MINUTES = 10;`.
- Update README.md:45-46 default column to `1` and `10` (descriptions unchanged).
- Update tests/orchestrator.test.ts:2503-2515 to assert `logStallMinutes === 10`.
- Grep for any other occurrence of the old order (e.g. `rg -n "simple.*moderate.*complex.*trivial" src index.ts README.md docs skills agents`) and fix it.
- The complexity default stays `moderate` (tool descriptions, kanban.ts fallbacks). No runtime config change needed: ~/.pi/agent/se-llm-team.json holds neither key, so the new defaults take effect there on daemon restart.

## Acceptance criteria

- `rg -n '"simple", "moderate", "complex", "trivial"' src index.ts` finds nothing; `rg -n '"trivial", "simple", "moderate", "complex"' src index.ts` finds the reordered arrays.
- `rg -n "DEFAULT_AUTO_SCHEDULE_MINUTES|DEFAULT_LOG_STALL_MINUTES" src/orchestrator/config.ts` shows 1 and 10.
- README.md:45-46 and docs/architecture.md:5 carry the new order/values.
- `npm test` passes (five suites), including the updated logStallMinutes default assertion.

# Notes
- Implemented in commit 59d0982. Complexity values are now written trivial, simple, moderate, complex in: src/kanban.ts (COMPLEXITIES), index.ts (both StringEnum lists), src/orchestrator/config.ts (DEFAULT_REVIEWER_CAP, RoleLlmConfig field order, comment), src/webui/page.ts (cx-trivial chip first), README.md (JSON example, roles row, reviewerCap row), docs/architecture.md:5. Defaults changed in src/orchestrator/config.ts: DEFAULT_AUTO_SCHEDULE_MINUTES 5 -> 1, DEFAULT_LOG_STALL_MINUTES 5 -> 10; README.md default column now 1 and 10; tests/orchestrator.test.ts part AP asserts 10.
- Also picked up by the grep: README.md:36 JSON example keys, README.md reviewerCap default column (now `0`/`1`/`2`/`3`), the RoleLlmConfig field order, and stale test comments (part AL "default 1 min", part AN 5-minute window wording, part AP "default 10"). No behavior change beyond the two defaults: the complexity default stays moderate.
- Verified: `npm test` (five suites) passes; the acceptance greps find no old-order array and show 1 / 10 in config.ts. Neither key exists in ~/.pi/agent/se-llm-team.json, and the project has no .kanban/se-llm-team.json, so the new defaults take effect at the next daemon restart with no migration.

# Open questions
Assumptions (confirm or correct before this hardens):
- The complexity default stays `moderate`; only the written order and the docs change, with no behavior change.
- "Everywhere" includes the README JSON example keys, the reviewerCap default column order, and the RoleLlmConfig interface field order, all reordered cosmetically.
- autoScheduleMinutes = 1 applies to all its uses (failed-merge requeue and respawn-past-cap wait), not only to one path.
