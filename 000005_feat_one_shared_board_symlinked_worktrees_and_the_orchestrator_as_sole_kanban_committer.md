---
name: "feat: one shared board (symlinked worktrees) and the orchestrator as sole .kanban committer"
priority: "high"
state: "to-do"
worktree: ""
---

# Summary
Make .kanban always synced between the root repo and every worktree (symlink), and make only the orchestrator daemon create git commits for .kanban paths. The PM tools write files only, no commits.

# Specs
# Need

One shared board and one committer: (1) .kanban must always be synced between the root repo and every task worktree, so role agents always read and write THE board; (2) only the orchestrator daemon creates git commits for .kanban paths.

# Why

- Role agents in worktrees currently edit a stale copy of the task file (verified: task 000001's Reviewer edited .worktrees/fix/commit-kanban-tasks-only-on-create-and-done/.kanban/000001....md; the daemon never saw it).
- Today the library (src/kanban.ts) auto-commits after mutations, called by both the PM tools and the daemon. The user wants a single committer: the orchestrator.

# Required behavior

1. Symlink sync: when the orchestrator creates a worktree (to-do transition), it replaces the worktree's .kanban directory with a symlink to <root>/.kanban (absolute path). Role agents then always work on the shared board.
2. The symlink and any .kanban deletions must never be committed on the worktree branch. Handle the stale tracked .kanban entries in the worktree (for example git update-index --skip-worktree on the .kanban paths, or equivalent) so the developer's git status shows no .kanban noise and a blanket git add -A cannot stage board changes.
3. Merges never carry .kanban changes: a merged worktree branch must not modify, delete, or symlink .kanban in the main repo's git.
4. Only the orchestrator commits: remove the auto-commit from the library (src/kanban.ts). The PM tools (kanban_create, kanban_update, kanban_set_state, kanban_set_worktree) and appendNote write files only, no commits.
5. The daemon commits at exactly two points, per the shape approved in task 000001:
   - Creation: a board file that is untracked in git (new task in backlog) → commit once, message `kanban: create <file>`.
   - Done end: a board file with state done, no worktree attribute, and uncommitted changes → commit once, message `kanban: done <file>`. This folds in all intermediate edits of the task life (Notes, state moves, priority edits). A done file that still has a worktree attribute stays uncommitted until the merge clears the attribute, so the single done commit holds the final file state.
   - Everything else: no commit. Intermediate updates stay dirty in the working tree until done.
   Decide dirty with `git status --porcelain` per file; skip when clean, so commits never repeat on rescan.
6. A missing git repo is still tolerated: no throw, same as today.

# Constraints

- Minimal diff. No new dependencies. No new config key.
- The daemon's own frontmatter edits (to-do → doing, worktree set/clear) keep working; they only stop creating commits.
- Keep the kanban_* tool contracts unchanged (same params and returns); only the commit side effect goes away.
- Do not change how the orchestrator detects transitions (fs.watch + rescan + poll).

# Acceptance criteria

- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass.
- New or updated assert-based checks, following the existing fixture patterns (disable GPG signing in fixture repos):
  - kanban_create writes the file with no commit; the daemon commits the new file once.
  - intermediate setState and updateTask create no commits.
  - done via direct edit with a worktree produces exactly one done commit after merge and worktree clear, and leaves git status clean.
  - done without a worktree produces exactly one done commit.
  - after worktree creation, <worktree>/.kanban is a symlink to <root>/.kanban; the worktree's git status shows no .kanban entries; a merged branch never changes .kanban in the main repo's git.

# Notes
