---
name: "fix: assert the integration done state on the mirror tip, not a done commit"
priority: "high"
state: "live-testing"
worktree: "fix/321-integration-done-mirror"
issuer: "#315"
complexity: "simple"
shortName: "integration-done-mirror"
---

# Summary
`tests/orchestrator/spawn.test.ts` waits for a `kanban: done <integration file>` mirror subject. A higher-priority done fold in the same sweep can commit the same whole-board tree first, so the identical-tree guard skips the integration task's done commit. Wait for the integration file's done state at the mirror tip instead.

# Specs
## Problem

`tests/orchestrator/spawn.test.ts:44-52` waits for `mirrorSubjects(rootA).includes("kanban: done " + f)`. The wait times out in 3 of 3 runs, and `pnpm test` stops at this file.

The mirror is a whole-board snapshot. `commitKanban` rebuilds the tree from every board file at commit time and skips the commit when the tree equals the parent tree (`src/orchestrator/board.ts:32-67`). The rescan takes one `files` snapshot (`src/orchestrator/pipeline.ts:447`) and walks tasks by priority (`src/orchestrator/pipeline.ts:461`). The covered task's done fold (`src/orchestrator/pipeline.ts:555-562`) can commit the whole board after the integration file is already done on disk. The integration task's own done branch then calls `commitKanban` with the same tree, the identical-tree guard skips the commit, and no `kanban: done <integration file>` subject exists. The mirror still holds the correct final state. Only the per-task label is absent.

Reproduce: `node tests/orchestrator/spawn.test.ts` exits 1.

## Decision

The user declined to choose between a snapshot assertion and a per-done commit guarantee. The PM default is: the mirror is a snapshot, not an event log. Keep production code unchanged and assert content.

## Change

- In `tests/orchestrator/spawn.test.ts`, replace the integration wait's subject check with a content check on the mirror tip: `showTip(rootA, f)?.includes('state: "done"')`.
- Import `showTip` from `../helpers.ts`. It is already exported at `tests/helpers.ts:44`.
- Keep the covered task's `taskClean()` wait on `kanban: done <taskA.file>`. That commit exists.
- Add one comment above the integration wait: the mirror is a snapshot, a higher-priority done fold in the same sweep can absorb this file, so assert its content and not its done commit.
- Do not change `commitKanban`, the rescan, or any other test.

## Acceptance criteria

Run from the repo root in the worktree:

- `node tests/orchestrator/spawn.test.ts` exits 0 in 3 consecutive runs.
- `pnpm test` exits 0.
- `git diff --stat` shows only `tests/orchestrator/spawn.test.ts`.

# Notes
