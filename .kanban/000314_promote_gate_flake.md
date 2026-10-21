---
name: "fix: make the backlog idle gate test independent of a 3 s wall clock"
priority: "medium"
state: "backlog"
worktree: ""
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
