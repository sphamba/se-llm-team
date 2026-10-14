---
name: "fix: backlog idle gate counts the daemon's own task-file writes"
priority: "high"
state: "reviewing"
worktree: "fix/211-backlog-idle-gate-own-writes"
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

- Fix (commit 99620f4): the backlogIdleMinutes gate in promoteBacklog (src/orchestrator/pipeline.ts) now skips task files the daemon itself wrote. kanban.ts keeps a per-process selfWrites map (path -> mtimeMs recorded right after the write), fed by noteSelfWrite at the three daemon write points: updateAttrs (all state transitions, worktree attrs, blockedBy drops), reconcileBoard's mirror materializations (board.ts) and ensureRoleNotes (spawn.ts). The gate skips files whose mtime still exactly matches a recorded self-write (isSelfWrite; a stale entry is dropped on mismatch, so a recreated file is never masked). Writes by any other process (PM session, agents, hand edits) never match and still defer promotion for the window.
- The mask is process-lifetime, not current-pass-only: a daemon write is never PM activity, so masking it for the process's life gives the same behavior with no per-pass bookkeeping. A daemon restart starts with an empty map, so writes made by the previous process defer promotion for one window (rare, accepted).
- Tests: part AR2 gained the direct check (a setState self-write does not re-arm the gate); new part AR3 drives the #197 fixture (a to-merge task with nothing to merge plus a dependent backlog task) through a real rescan and poll with backlogIdleMinutes 0.05: same-sweep promotion, the dependent named under Scheduled in that sweep's report, a raw PM edit still defers, and the poll path promotes past the window. A red-check (src fix stashed) confirmed the new assertions fail on the old code.
- Full suite green: kanban, orchestrator (incl. AR2/AR3), webui, extension, index.

- Follow-up (after #212 merged as b1ef8ff): its gate skip of role notes (ROLE_NOTES_RE in promoteBacklog) covers that slice regardless of writer, so the ensureRoleNotes mask was dropped as redundant. The daemon-driven test part was renamed AR4 (#212's part took the AR3 name) and the branch was rebased onto main in this worktree, so the merge is now a fast-forward of one commit (78f4e69) with both gate rules: role notes skipped first, daemon self-writes second. Full suite green after the rebase.

# Open questions

## Assumptions
- Only the daemon process's own writes are masked: agent-role writes (e.g. a reviewer setting its task to-merge) still count as board activity and defer promotion by the window.
- The gate stays mtime-based with the exact-match mask; a PM edit landing in the same timestamp tick as a daemon write to the same file is not distinguished (negligible on ext4/tmpfs).
- backlogIdleMinutes keeps its current board-wide PM-quiet-window meaning; the mask changes only which writes feed it.
- The webui is read-only, so no in-daemon PM edits exist that could be wrongly masked by the process-level registry.