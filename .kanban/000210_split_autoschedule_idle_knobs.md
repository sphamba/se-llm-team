---
name: "refactor: split autoScheduleMinutes into backlog-idle and retry-idle knobs"
priority: "medium"
state: "live-testing"
worktree: "refactor/210-split-autoschedule-idle-knobs"
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

Implemented in worktree commit f69b818, all suites green.

- config.ts: `DEFAULT_AUTO_SCHEDULE_MINUTES` replaced by `DEFAULT_BACKLOG_IDLE_MINUTES = 1` and `DEFAULT_RETRY_IDLE_MINUTES = 1`; Config interface carries `backlogIdleMinutes` + `retryIdleMinutes`; loadConfig parses both through one shared `idleMinutes` helper (non-number or negative warns and keeps the default, 0 accepted and disables the wait).
- pipeline.ts: `sweepToMerge` and `deadCooldownActive` read `cfg.retryIdleMinutes`; `promoteBacklog` gained the third parameter `backlogIdleMinutes = 0` with a board-wide quiet gate at the top (stats every `.kanban/*.md` via `taskFiles` + `statSync().mtimeMs`, returns `[]` while `Date.now() - newest < backlogIdleMinutes * 60_000`); the stat pass is skipped entirely when the value is 0, so direct calls stay ungated; `rescan` passes `cfg.backlogIdleMinutes`.
- liveness.ts: `poll` gained the fourth parameter `backlogIdleMinutes = 0` (kept after the existing injectable `now` third parameter, which tests pass) and passes it to `promoteBacklog`; the "promotion never waits for a timer" comment updated. main.ts: both `poll` call sites pass `cfg.backlogIdleMinutes`.
- Log prose `respawn waits for the idle cooldown` untouched (tests parse it).
- tests/orchestrator.test.ts: three merge-test configs renamed to `retryIdleMinutes: 0.08`; `backlogIdleMinutes: 0` added uniformly to every `se-llm-team.json` write (43 single-line + 4 multi-line, webui global-config writes included, plus a new write in the part-AW temp-HOME setup whose promotion asserts would otherwise wait out a window); new part AR2 unit test: fresh backlog task does not promote with a 0.05 window, promotes after `utimesSync` (wrapped in `new Date`, since numeric utimes args are seconds) ages the file past the window, and a window of 0 promotes immediately.
- README.md: `autoScheduleMinutes` row removed, new knobs not added (internal timing details). docs/architecture.md: backlog bullet documents the PM quiet gate, to-merge bullet renamed to `retryIdleMinutes`, liveness bullet documents the respawn cooldown past the 5-death cap.
- Constraints held: retry mechanism still a per-task-file mtime check; `webui/`, `report.ts`, and index.ts untouched. Acceptance grep for `autoScheduleMinutes` returns no matches. Full run: orchestrator/kanban/webui/extension/index tests all pass.
- Old configs that set `autoScheduleMinutes` now silently lose that setting (the key is gone; both knobs fall back to 1); no migration warning was requested.

## Live test (merged f69b818)

Ran the daemon from the merged worktree (`src/orchestrator.ts`, fake pi agent, three fixture git roots, isolated HOME, `--no-webui`) plus direct `loadConfig` and `promoteBacklog` calls. No unit suite was run.

Verified:
- config: defaults are 1/1; explicit values are honored; 0 is accepted; a non-number and a negative value warn and keep the default, for both keys; a legacy `autoScheduleMinutes` is silently ignored (both knobs take the default 1), as the task notes state.
- backlog gate: two fresh backlog tasks stay backlog on the first sweeps; an aged task stays backlog while another task file is fresh (board-wide proof); both promote once the whole board is quiet; with the window 0 a fresh task promotes on the next sweep.
- retry gate: a failed ff-merge (dirty root) stays to-merge with the attempt marker; with `retryIdleMinutes` 0.5 the retry after the root is clean waits the full window; with `retryIdleMinutes` 0 it retries on the next sweep with no aging. The live-tester spawns after the successful ff.
- docs and acceptance grep: `autoScheduleMinutes` has no match in `src/ tests/ README.md docs/`; the README table row is gone and the new knobs are absent from the table; `docs/architecture.md` names `backlogIdleMinutes` in the backlog bullet and `retryIdleMinutes` in the to-merge and liveness bullets; `respawn waits for the idle cooldown` prose is unchanged.
- the dead-capped respawn path shares `cfg.retryIdleMinutes` through `deadCooldownActive`, checked by code reading only (the failed-merge path live-proves the same config field).

Findings (reported to the PM as new tasks):
1. The board-wide gate counts the daemon's own task-file writes, so it re-arms on every state transition and blocker drop, not only on PM edits. Measured with `backlogIdleMinutes` 0.5: a to-merge task with no worktree went done at 10:38:51.625 and its dependent's blockedBy ref was dropped at 10:38:51.661; the dependent (backlog, no open questions, no blockers) did not promote in that sweep and promoted only at 10:39:21.672, exactly one window after the last daemon write. The report written for the done transition has no Scheduled section, and the later-sweep promotion rides no report at all, so the #197 same-sweep unblock behavior is defeated under the default window (1). On a board with frequent transitions this can starve newly unblocked backlog work. The suite masks it because every test config sets `backlogIdleMinutes: 0`.
2. `taskFiles` has no `ROLE_NOTES_RE` filter (unlike `listAll`), so the gate stats `.kanban/AGENTS.<role>.md` role notes too. The daemon writes a fresh role note at the first spawn on a board that has none, which defers all promotion one extra window. Direct check: an aged backlog task promoted with no role note present, and `promoteBacklog(root, tasks, 0.5)` returned `[]` once a fresh `AGENTS.developer.md` existed beside it.

No user open questions were added by this live test.

# Open questions

None. Assumptions the PM or user can correct:
- Board-wide gate watches `.kanban/*.md` task files only: report, log, and pid writes do not defer promotion.
- Existing boards with `autoScheduleMinutes` in their config lose that value silently (both new knobs default to 1).
- The uniform `backlogIdleMinutes: 0` in tests also covers the webui-only global-config writes (those daemons run the sweep too).
- The retry-idle default (1) keeps the old `autoScheduleMinutes` default, so boards with no config keep the current pacing.
