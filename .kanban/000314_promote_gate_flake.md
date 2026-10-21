---
name: "fix: make the backlog idle gate test independent of a 3 s wall clock"
priority: "medium"
state: "reviewing"
worktree: "fix/314-promote-gate-flake"
issuer: "#305"
complexity: "simple"
shortName: "promote-gate-flake"
---

# Summary
The backlog idle gate test uses a 3 s window on a freshly written file. A loaded test runner stalls longer, the file looks aged, and the assertion fails. #305 saw it in 1 of 3 runs and #307 hit it again. Use a 5 min window for the fresh case and age the file by 10 min for the promote case.

# Specs
## Problem

`tests/orchestrator/promote.test.ts:387` (part AR2) creates a fresh task file, then calls `promoteBacklog(root, listAll(root), 0.05)`. The window is 0.05 min = 3 s, compared against the task file mtime and `Date.now()`. A test process stall over 3 s makes the fresh file look aged, promotion fires, and the assertion "a fresh task file defers promotion within the window" fails with `1 !== 0`.

Evidence:

- #305's integration run: 1 of 3 full suite runs failed at this assertion.
- #307's integration run: the same assertion failed again (`/tmp/itest/promote-copy.test.ts:396`).

The gate logic is correct. The test depends on a wall clock shorter than a loaded runner can stall.

## Fix

In `tests/orchestrator/promote.test.ts` part AR2:

- Use a window no realistic stall can cross for the fresh-file case, for example 5 minutes.
- Age the file by more than that window for the promote case, for example 10 minutes, with `utimesSync`.
- Keep the `0` window case and the `backlog` state assertions.
- Change the comments that explain `0.05 min = 3 s < 10 s` to the new numbers.

Do not change `promoteBacklog` or any gate logic.

## Gate

Run `node tests/orchestrator/promote.test.ts` in a loop of 20 runs. All must exit 0. The full `pnpm test` stays the live test's job.

## Out of scope

- No injected clock in the production code.
- No change to other tests that use a small window, unless the same 3 s race exists there.

# Notes
## 314 promote gate flake

Changed only `tests/orchestrator/promote.test.ts`. No source change: `promoteBacklog` and the gate logic are untouched (`git diff src/` is empty).

- Part AR2: the fresh-file case runs with a 5 min window and the task file mtime pinned 1 s back with `utimesSync`; the promote case ages the file by 10 min (600 s) against that window. The `0` window case and both `backlog` state assertions stay. The `0.05 min = 3 s < 10 s` comments now read the new numbers.
- Root cause is wider than the 3 s diagnosis in the Specs. A 5 min window alone did not fix the flake: 7 of 20 runs still failed with `1 !== 0`, and the same assertion in part AR3 or AR4 failed in 2 more. Instrumenting the gate showed the fresh file was never ranked: `promoteBacklog` skips any task file whose `statSync().mtimeMs` is above `Date.now()` (the #296 clock-skew guard, part BC). `Date.now()` is millisecond-floored and the filesystem mtime carries a sub-millisecond fraction, so a file written in the current millisecond reads as future, is skipped, `newest` stays 0, the gate opens, and the "fresh file defers" assertion fails. Pinning the fresh mtime 1 s back removes that race without touching the gate.
- Parts AR3 and AR4 carry the identical assertion (`a fresh task file still defers promotion within the window`, `an external PM edit defers promotion within the window`), so they got the same 5 min window, 10 min aging and mtime pin. The out-of-scope line allows this ("unless the same 3 s race exists there").
- Gate: `node tests/orchestrator/promote.test.ts` 20 runs, all exit 0, plus 10 more runs under 3 CPU hogs, all exit 0 (30 of 30). The full `pnpm test` stays the live tester's gate.
- Follow-up candidate, not changed (out of scope per the Specs): the same `mtimeMs > Date.now()` skip also hides a task file the PM writes in the current millisecond, so that write does not defer promotion. A one-line tolerance (compare against the sweep start, or allow 1 ms) would close it.

# Open questions
- [user] Assumption: the same-millisecond "future" skip is the dominant flake, so the fix pins mtimes in the test instead of relaxing the gate. Confirm that `promoteBacklog` stays as it is, even though a same-millisecond write is then not counted as board activity.
