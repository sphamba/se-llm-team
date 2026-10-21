---
name: "fix: skip the state-pass create retry for a create that already landed"
priority: "medium"
state: "live-testing"
worktree: "fix/322-create-retry-once"
issuer: "#315"
complexity: "simple"
shortName: "create-retry-once"
blockedBy: ""
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
## Run 2026-10-21

- Fix in `src/orchestrator/pipeline.ts`: a `Set` records each task file whose pass-one create `commitKanban` returned true. The state pass retries a create only when the file is not in the set. The updated comment names the stale sweep-start map.
- Pin in `tests/orchestrator/spawn.test.ts`: after the integration wait, filter `mirrorSubjects(rootA).split("\n")` for `kanban: create <integration file>` and assert exactly one.
- Premise: `blockedBy` is empty. The Adoption section names #321. Card `000321_integration_done_mirror.md` has `state: "done"` and card `000324_integration_of_321.md` is in `to-integration-test`. The #321 change is absent: `grep -F 'showTip(rootA, f)' tests/orchestrator/spawn.test.ts` is empty, and the wait still checks the `kanban: done <integration file>` subject. The mirror tip holds `state: "done"` for the integration file, because a higher-priority whole-board fold absorbs the done label. `node tests/orchestrator/spawn.test.ts` times out at that wait on base `b7596fc` and with this fix, before the new pin runs. The 3 green runs need the #321 change.
- Throwaway pin `tests/_scratch.test.ts` (deleted): base `b7596fc` gives 2 create subjects for the integration file, this fix gives 1.
- `node tests/orchestrator/sweep.test.ts` exit 0. The full suite is the live tester's gate.

## Review of 2dc54b8 (first pass)

- `src/orchestrator/pipeline.ts:457,466,489`: the `created` Set fills only on a pass-one `commitKanban` true and gates only the state-pass retry, so a failed pass-one create still retries and `commitKanban` is untouched.
- `tests/orchestrator/spawn.test.ts:52-54`: the pin filters `mirrorSubjects(rootA).split("\n")` for the exact integration create subject after the integration wait, as the acceptance criterion asks.
- `git diff --stat b7596fc...HEAD` shows only `src/orchestrator/pipeline.ts` and `tests/orchestrator/spawn.test.ts`, and the tree is clean.
- Base probe: with the two files checked out from b7596fc, the suite exits 1 with `timeout waiting for the integration task runs to done and folds into the mirror` (`tests/orchestrator/spawn.test.ts:49`), so the red predates this change.

Tests: `node tests/orchestrator/spawn.test.ts` exit=1 at HEAD and exit=1 at base b7596fc, both timing out at the integration wait before the new pin runs; the pin is unverified, not failing.

- Non-blocking: card 000321 is `done` but `main` b7596fc still has the subject wait (no `showTip(rootA, f)`), so this task's declared blocker never landed. Upgrade path: reopen #321 or let #324 bounce it, then re-run `spawn.test.ts` to execute the pin.
- Non-blocking: acceptance 2 (3 green runs) and 3 (`pnpm test`) are not measurable until #321 lands, and the full suite is the live tester's gate.
- Nit: `commitKanban` returns true for an identical tree (`src/orchestrator/board.ts:61`), so a second new file that landed under the first file's whole-board create commit enters `created` without its own create subject; multi-create sweeps still emit one create subject. Upgrade path: a separate task for per-file create events.

