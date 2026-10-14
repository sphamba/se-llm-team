---
name: "refactor: split autoScheduleMinutes into backlog-idle and retry-idle knobs"
priority: "medium"
state: "to-do"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "split-autoschedule-idle-knobs"
---

# Summary
Split the autoScheduleMinutes config knob into two explicit knobs: backlogIdleMinutes gates backlog promotion behind a board-wide PM quiet window (wait for the PM process to stop modifying the board before autoscheduling backlog work), and retryIdleMinutes keeps the existing per-task retry cooldown (failed-merge retry, dead respawn past the 5-death cap). Keep the knobs out of the README config table; document them in docs/architecture.md only.

# Specs
## Goal

Split the `autoScheduleMinutes` config knob (default 1, src/orchestrator/config.ts) into two knobs with clear names:

- `backlogIdleMinutes` (default 1): minutes the board must sit untouched before backlog tasks auto-schedule. Backlog promotion waits for the PM process to finish modifying the board (task specs, blocker chains, open questions) before it schedules work.
- `retryIdleMinutes` (default 1): the existing per-task idle cooldown for retry paths, renamed from `autoScheduleMinutes`. Semantics unchanged: a merger requeued by a failed merge, and a respawn past the 5-death cap, wait until the task file sat idle this many minutes.

## Code changes

1. `src/orchestrator/config.ts`
   - Replace `DEFAULT_AUTO_SCHEDULE_MINUTES` with `DEFAULT_BACKLOG_IDLE_MINUTES = 1` and `DEFAULT_RETRY_IDLE_MINUTES = 1`.
   - Config interface: replace the `autoScheduleMinutes` field with `backlogIdleMinutes` and `retryIdleMinutes`.
   - `loadConfig`: parse both keys with the existing warn-and-keep-default pattern (a non-number or a negative value warns and keeps the default; 0 disables the wait). A small shared helper for the two keys is fine.

2. `src/orchestrator/pipeline.ts`
   - `sweepToMerge` (the failed-merge retry gate, ~line 76) and `deadCooldownActive` (~line 176) use `cfg.retryIdleMinutes`.
   - `promoteBacklog` gains a third parameter `backlogIdleMinutes = 0` and a board-wide quiet gate at the top: stat every task file (`taskFiles` + `statSync(...).mtimeMs`), find the newest mtime, and return `[]` when `Date.now() - newest < backlogIdleMinutes * 60_000`. The gate is board-wide on purpose: the PM may still be creating or chaining a batch of tasks, so any fresh task-file mtime defers all promotion. The default parameter 0 keeps direct calls (the unit tests) ungated.
   - `rescan` passes `cfg.backlogIdleMinutes` to `promoteBacklog`.

3. `src/orchestrator/liveness.ts` and `src/orchestrator/main.ts`
   - `poll` gains a fourth parameter `backlogIdleMinutes = 0` and passes it to its `promoteBacklog` call (~line 222). Update the comment that claims promotion never waits for a timer.
   - Both `poll` call sites in `main.ts` (~lines 127, 129) pass `cfg.backlogIdleMinutes`.

4. Keep the daemon log prose `respawn waits for the idle cooldown` unchanged: tests parse it.

## Tests (tests/orchestrator.test.ts)

- Rename `autoScheduleMinutes: 0.08` to `retryIdleMinutes: 0.08` in the three merge-test configs (~lines 783, 851, 939).
- Add `backlogIdleMinutes: 0` to every test config that relies on daemon-driven promotion, so the new gate does not slow down or break the suite (uniform across all `se-llm-team.json` writes in the file).
- Add a unit test near the fresh-read promotion gates (~line 2589): a freshly written backlog task does not promote with a small window (e.g. 0.05); after `utimesSync` ages the task file past the window, `promoteBacklog` promotes it; a window of 0 promotes immediately.

## Docs

- README.md: remove the `autoScheduleMinutes` row from the Configuration table. Do not add the new knobs to the README table; they stay internal timing details.
- docs/architecture.md: the backlog bullet documents the PM idle gate (`backlogIdleMinutes`, default 1, 0 disables); the to-merge bullet renames the key to `retryIdleMinutes`; the liveness bullet documents the respawn cooldown past the 5-death cap with `retryIdleMinutes`.

## Constraints

- The retry mechanism itself does not change: it stays a per-task-file mtime check.
- `webui/`, `report.ts`, and the extension (index.ts) stay untouched.
- Line numbers above are from the pre-change tree and may drift; match by code, not by line.

## Acceptance criteria

- `node tests/orchestrator.test.ts` passes and includes the new backlog idle gate test.
- `node tests/kanban.test.ts` passes.
- `node tests/webui.test.ts` passes.
- `node tests/extension.test.ts` passes.
- `node index.test.ts` passes.
- `grep -rn "autoScheduleMinutes" src/ tests/ README.md docs/` returns no matches.

# Notes
