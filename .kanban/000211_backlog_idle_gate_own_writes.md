---
name: "fix: backlog idle gate counts the daemon's own task-file writes"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#210"
complexity: "moderate"
shortName: "backlog-idle-gate-own-writes"
---

# Summary
The board-wide backlogIdleMinutes promotion gate stats every task file's mtime, so it counts the daemon's own writes (state transitions, blocker drops) and re-arms on every sweep it makes progress in. Under the default 1-minute window this defeats #197's same-sweep unblock behavior and can starve newly unblocked backlog work. Make the gate ignore writes the daemon itself made during the current pass (or gate only on genuinely external/PM edits), so a blocker reaching done still promotes its dependents in the same sweep with them named in that sweep's report.

# Specs
Found in the live test of #210 (merged commit f69b818). This is a follow-up defect in the `backlogIdleMinutes` gate introduced by #210, not a duplicate of it: #210 stays live-testing, this task fixes the gate's write accounting.

## Finding

The new board-wide backlog promotion gate (`backlogIdleMinutes`) counts the daemon's own task-file writes, not only PM edits, so it re-arms on every task state transition and blocker drop.

Evidence from a fixture daemon run with `backlogIdleMinutes` 0.5:
- task `000400_a` (to-merge, no worktree) went done at 10:38:51.625;
- the same sweep dropped `000400_a`'s satisfied blockedBy ref from dependent `000401_b` at 10:38:51.661;
- `000401_b` (backlog, no open questions, no blockers) did not promote in that sweep; `promoteBacklog`'s gate saw the fresh mtimes written by the daemon itself and returned `[]`;
- `000401_b` promoted only at 10:39:21.672, exactly one `backlogIdleMinutes` window after the last daemon write.

## Consequences

- The #197 same-sweep unblock behavior is defeated under the default window (1 minute): a task unblocked by its blocker reaching done no longer promotes in the same sweep.
- The board report written for that done transition has no Scheduled section, and the later-sweep promotion rides no report at all (`reportDone` only writes a report when a task newly reaches done).
- On a board with frequent state transitions the gate keeps re-arming, so newly unblocked backlog work can be starved.
- The test suite masks the regression because every daemon-driven promotion test config sets `backlogIdleMinutes: 0` (tests/orchestrator.test.ts, uniform across the `se-llm-team.json` writes), and the new gate unit test (part AR2) calls `promoteBacklog` directly with no daemon pass.

## Suggested direction

Make the gate ignore the writes the daemon itself made during the current pass (or otherwise gate only on genuinely external/PM edits), so a blocker reaching done still promotes its dependents in the same sweep and that sweep's report lists them under Scheduled.

## Code pointers

- Gate: `promoteBacklog` in `src/orchestrator/pipeline.ts` (~line 421) stats every file from `taskFiles(root)` and returns `[]` when the newest mtime is younger than the window.
- Call sites: `rescan` passes `cfg.backlogIdleMinutes` (`src/orchestrator/pipeline.ts`, ~line 343); `poll` passes it at `src/orchestrator/liveness.ts:223`.
- Same-sweep behavior from #197 (commit 064592d): `rescan` re-reads the board after the state loop and passes the fresh list to `dropDoneBlockers` and `promoteBacklog`; `reportDone` keeps the pre-loop snapshot so the sweep's own done move is this sweep's transition.

## Acceptance

- With a real daemon pass and a nonzero window (e.g. 0.5 min), a backlog task whose blocker reaches done in that sweep promotes in the same sweep, and that sweep's queued report lists it under Scheduled — the #197 fixture (a to-merge task with nothing to merge plus a dependent backlog task) is the natural check.
- A genuinely external (PM) board edit still defers promotion for the window.
- Regression coverage exercises the daemon-driven path with a nonzero window, not only `backlogIdleMinutes: 0` / direct `promoteBacklog` calls.

# Notes
