---
name: "feat: stage toggles for reviews, live testing and integration testing"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "stage-toggle-config"
---

# Summary
Add three boolean config gates: reviews, liveTesting and integrationTesting. Each gate is on by default. When a gate is off, the daemon skips that stage and moves the task to the next state. Delivered on main in commit 3415fa4.

# Specs
## Delivered

Commit 3415fa4, on main at HEAD.

## Needs

- Three new config keys, type boolean, default `true` (src/orchestrator/config.ts:52-54, defaults at :231-233).
- A non-boolean value does not flip the gate. The daemon logs `<key> <value> ignored: must be a boolean` (config.ts:86-91).
- `reviews: false`: a to-review task moves straight to to-merge. No reviewer spawns. No worktree is created. No armed marker is written (src/orchestrator/pipeline.ts:524-531).
- `liveTesting: false`: a merged to-live-test task moves straight to done (pipeline.ts:575-577).
- `integrationTesting: false`: the merge still fast-forwards and still moves the task to to-live-test. It opens no new integration task and logs `integration testing is off, no integration task queued` (pipeline.ts:334-337).
- A hold on the `user` token wins. `reviews: false` cannot start a held task (pipeline.ts to-review branch).
- The keys are documented in README.md:108-110 and :127-129, docs/architecture.md:22, :26, :28 and skills/se-llm-team/SKILL.md:18.

## Constraints

- A gate acts at the stage start only. An agent that already runs finishes its stage.
- The three gates are independent.
- `integrationTesting: false` does not stop an integration task that already waits or runs. `sweepToIntegrationTest` has no gate. This is out of scope of this change.
- `reviews: false` does not act on a task already in reviewing. `liveTesting: false` does not act on a task already in live-testing.

## Acceptance

- `node tests/orchestrator/stages.test.ts` exits 0. It pins the defaults, the false paths, the non-boolean warning, the state moves, the absent pid and armed files, and the log lines.
- `node tests/orchestrator/config.test.ts` exits 0.
- `pnpm test` exits 0.

# Notes
