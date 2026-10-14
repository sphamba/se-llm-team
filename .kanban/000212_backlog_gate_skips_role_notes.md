---
name: "fix: backlog idle gate counts role notes as board activity"
priority: "medium"
state: "done"
worktree: ""
issuer: "#210"
complexity: "simple"
shortName: "backlog-gate-skips-role-notes"
---

# Summary
The board-wide backlogIdleMinutes promotion gate stats every `.kanban/*.md` via `taskFiles`, which lacks listAll's ROLE_NOTES_RE filter, so `.kanban/AGENTS.<role>.md` role notes count as board activity. A fresh role note written by ensureRoleNotes at the first agent spawn defers all backlog promotion for another full window. Restrict the gate's stat pass to real task files (exclude ROLE_NOTES_RE names).

# Specs
Found in the live test of #210 (merged commit f69b818). This is a follow-up defect in the `backlogIdleMinutes` gate introduced by #210 (the daemon-own-writes half of the gate is tracked separately as #211), not a duplicate of #210.

## Finding

The promotion gate stats every `.kanban/*.md` via `taskFiles`, which has no `ROLE_NOTES_RE` filter (unlike `listAll`), so it counts `.kanban/AGENTS.<role>.md` role notes as board activity.

Direct evidence: on a board that has no role notes yet, `ensureRoleNotes` writes a fresh one at the first agent spawn, and the gate then defers all backlog promotion for another full window. With one aged backlog task present, `promoteBacklog(root, tasks, 0.5)` promoted it while no role note existed, and returned `[]` once a fresh `AGENTS.developer.md` sat beside it in the same `.kanban`.

## Suggested direction

Restrict the gate's stat pass to real task files (exclude `ROLE_NOTES_RE` names).

## Code pointers

- Gate: `promoteBacklog` in `src/orchestrator/pipeline.ts` (~line 421) loops over `taskFiles(root)` and stats each file.
- `taskFiles` (`src/kanban.ts:97`) filters only on `.md`; `listAll` (`src/kanban.ts:198-199`) additionally applies `.filter((f) => !ROLE_NOTES_RE.test(f))`; `ROLE_NOTES_RE` is `/^AGENTS(\..+)?\.md$/` (`src/kanban.ts:194`).
- `ensureRoleNotes` (`src/orchestrator/spawn.ts:25`, called at line 118) creates the role note at the first agent spawn.

## Acceptance

- With an aged backlog task and a freshly written `.kanban/AGENTS.developer.md`, `promoteBacklog(root, tasks, 0.5)` promotes the task (role notes are not board activity).
- A fresh real task file still defers promotion within the window.
- Regression coverage places a role note beside a backlog task under a nonzero window.

# Notes
- Fixed `promoteBacklog` (`src/orchestrator/pipeline.ts`): the board-wide `backlogIdleMinutes` stat pass now skips `ROLE_NOTES_RE` files, so a fresh `AGENTS.<role>.md` written by `ensureRoleNotes` at the first spawn no longer counts as board activity and no longer defers all backlog promotion for another full window. `taskFiles` itself is unchanged on purpose: `rescan`/`commitKanban` still mirror role notes.
- Regression: new part AR3 in `tests/orchestrator.test.ts` places an aged backlog task beside a freshly written `.kanban/AGENTS.developer.md` under a 0.05 min window (promotes), then a fresh real task file beside the same note (still defers).
- Verification: `npm test` passes (all five test files). A standalone reproduction returned `0 !== 1` before the change and passed after. Commit `b1ef8ff`.
- Review: the fix matches the Specs. No code changes. The stated assumptions hold: daemon-written board files live in `.kanban/.logs` and `.kanban/.pids`, never top-level `.md`, so the gate never stats them; the quiet window stays board-wide over real task files on purpose; `taskFiles` stays unfiltered so `commitKanban` (board.ts:282) still mirrors role notes. Ran `node tests/orchestrator.test.ts` twice, exit 0 with part AR3 included. The technical assumptions moved here from # Open questions, so the section is now empty.
- Live test (merged `b1ef8ff`). Five daemon runs on isolated `git init` fixture roots in `/tmp/t212` (isolated HOME, `--no-webui`, `--rescan-seconds 1 --poll-minutes 0.05`, a fake agent that logs its argv and sleeps). No unit suites. Log timestamps are UTC and exact.
  - Core acceptance. An aged backlog task (mtime 60 s back) beside a freshly written `.kanban/AGENTS.developer.md` (exact `ensureRoleNotes` starter text), window 30 s. The merged daemon promoted the task 89 ms after start (`promoting 000001_aged.md to to-do`). The pre-fix daemon (f69b818, same fixture) kept it in backlog at t=10 s and promoted it 31 s after start, one full window. The differential is decisive.
  - Regression. The same fresh role note plus a fresh real task file (`000003_fresh.md`) deferred every promotion at t=8 s (0 promotion lines, both tasks backlog). After the fresh real task file was aged to 60 s, both tasks promoted within 0.6 s. The gate still reads real task files.
  - Real writer. On a board with no role notes, the daemon created `.kanban/AGENTS.developer.md` itself at the first developer spawn, with the exact starter text. The aged backlog task promoted 6.0 s after the spawn at a 6 s window, one window and not two.
  - Control on the same real spawn flow. The pre-fix daemon promoted 6.0 s after the spawn too. Every `spawnAgent` call site writes the task file in the same call stack (pipeline.ts lines 35-36, 118-120, 278-279, 302-303), so a live spawn never leaves the role note as the only fresh `.md`. The full-window deferral of the direct repro needs a role note with otherwise aged real task files. The live daemon reaches that state only through the millisecond gap between the two writes. The one-window deferral observed after a spawn belongs to the task-write half (#211), not to the role note, and is not a defect of this fix.
  - Flag on a stated assumption. The review note says daemon-written board files never sit at the top level as `.md`. The daemon rewrites top-level task files on every state change (`setState` to `updateAttrs` to `writeFileSync`), and the real spawn run shows that write deferring all promotion for a full window. The statement only fits the extra daemon files (`.logs`, `.pids`, role notes).
- Live test assumptions: the fixture writes the role note with the exact `ensureRoleNotes` content shape, a plain `git init` root is enough because the gate only stats `.kanban/*.md`, and the promotion decision is read from the daemon log line plus the task file state.
- No issue found in the change. No new tasks.
