---
name: "fix: backlog idle gate counts role notes as board activity"
priority: "medium"
state: "doing"
worktree: "fix/212-backlog-gate-skips-role-notes"
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
