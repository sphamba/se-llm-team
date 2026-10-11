---
name: "feat: shorter markdown file names; branch and worktree named feat/42-short-name"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Task names stay as they are, but the markdown file slug becomes shorter, and the branch/worktree name follows the short name and must include the task number, e.g. feat/42-short-name (non-padded number). New tasks only - existing files are never renamed.

# Specs
Facts:
- slugFile (src/kanban.ts:117) derives the file name from the task name - slugs are long, e.g. 000042_fix_restore_board_state_lost_to_stale_mirror_snapshots.md.
- slugWorktree (src/kanban.ts:124) derives the worktree/branch from the task name - no task number, e.g. feat/kanban-list-returns-priority-and-state-with-optional-priority-filter.
- Task-number allocation scans file names (max + 1); taskNum (#57, in flight) parses leading digits; pid/log tracking keys on the task file name - renaming PRESENT files breaks it.
- The worktree name is the branch name (worktree feat/x = branch feat/x), ensured at promotion (orchestrator.ts ~:470-482).

Changes:
1. src/kanban.ts slugFile: cap the slug at 4 words (drop the leading type word from the slug; the task name still carries it), e.g. 000042_restore_board_state.md. Keep the zero-padded number prefix so allocation and taskNum keep working.
2. src/kanban.ts slugWorktree: name the worktree/branch {typeDir}/{num}-{shortSlug} with the NON-padded number, e.g. feat/42-restore-board-state. Takes the task file (or number) now, not only the name.
3. Apply to new tasks only: createTask uses the short slug; present files are never renamed.
4. Tests: kanban.test.ts (slugFile caps at 4 words and keeps the number prefix; slugWorktree emits feat/42-...), orchestrator.test.ts (promotion ensures worktree feat/42-...).

Acceptance: typecheck and the full test suite pass; a newly created task gets a short file name; its promotion ensures worktree/branch feat/42-short-name; existing task files and their worktrees are untouched.

Constraints:
- Files: src/kanban.ts, src/orchestrator.ts (ensure call site only), tests. src/kanban.ts/kanban.test.ts overlap #57 (taskNum export) by file only - different functions, minor sequential merge.

# Notes
