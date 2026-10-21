---
name: "fix: skip the state-pass create retry for a create that already landed"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#315"
complexity: "simple"
shortName: "create-retry-once"
blockedBy: "#321"
---

# Summary
The state-pass create retry reads the sweep-start status map, so a create committed in pass one is committed again after mid-sweep state writes. The second `kanban: create <file>` commit then carries another task's state change. Track the creates that already landed and skip them.

# Specs
## Problem

The rescan takes `status` once (`src/orchestrator/pipeline.ts:447`). Pass one commits every `??` create (`src/orchestrator/pipeline.ts:463-465`). The state pass then retries `if (code === "??")` from the same stale map (`src/orchestrator/pipeline.ts:484-486`), so a create that pass one already committed is committed again. Mid-sweep state writes have changed the whole-board tree by then, so `commitKanban` does not skip the second commit, and its diff carries another task's state change under a `kanban: create <file>` label.

In the standard smoke pipeline this produces two `kanban: create 000002_integration_of_1.md` subjects. The newer one changes only `.kanban/000001_smoke_test.md` (`to-live-test -> live-testing`).

Reproduce in the smoke fixture: `git log --format=%s refs/heads/meta/kanban` and `git diff --stat <older-create> <newer-create>`.

## Change

- Track the files whose pass-one create commit succeeded, for example a `Set<string>` filled when `commitKanban` returns true, and skip those files in the state-pass retry.
- Keep the retry for a create whose pass-one commit failed.
- Do not change `commitKanban`, the whole-board tree strategy, or the commit labels.
- Add a comment that names the stale-map reason.

## Adoption

#321 edits the same wait block in `tests/orchestrator/spawn.test.ts`, so this task is blocked by #321.

## Acceptance criteria

- Add an assertion in `tests/orchestrator/spawn.test.ts` after the integration task settles: the mirror has exactly one `kanban: create <integration file>` subject. Derive it from `mirrorSubjects(rootA).split("\n")` and filter for that exact subject.
- `node tests/orchestrator/spawn.test.ts` exits 0 in 3 consecutive runs.
- `pnpm test` exits 0.
- `git diff --stat` shows only `src/orchestrator/pipeline.ts` and `tests/orchestrator/spawn.test.ts`.

# Notes
