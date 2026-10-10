---
name: "feat: board lives on a meta/kanban branch; .kanban/ untracked, mirrored by the daemon"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Move kanban board storage out of main history: untrack .kanban/, mirror board changes to a meta/kanban branch via git plumbing, auto-push that ref best-effort, watch the branch in orchestrator_wait, and bootstrap .kanban/ from the branch on a fresh clone.

# Specs
Branch-mirrored kanban board.

Facts:
- Today .kanban/*.md are tracked and committed on main ("kanban: create/done" commits by the daemon, src/orchestrator.ts). .kanban/.logs, .kanban/.pids, .kanban/.orchestrator.lock, .kanban/.poke are already gitignored.
- Git transfers only refs/heads/* and tags on push and clone; files inside .git/ never transfer; git notes and custom refs are not in the default refspecs. A branch is the only git-native carrier.
- The daemon is the sole .kanban committer; worktrees symlink the board, so feature branches never carry board files.

Changes:
1. src/orchestrator.ts: replace direct board commits on the current branch with mirror commits to refs/heads/meta/kanban via plumbing: git hash-object -w for each changed board file, build the tree, git commit-tree with parent = current meta/kanban head, git update-ref. Commit messages keep the "kanban: create X" / "kanban: done X" format. Never touch the index or working tree.
2. Feature-branch merges keep targeting the current branch (main), code only.
3. After each mirror commit, best-effort auto-push of only refs/heads/meta/kanban (git push origin meta/kanban) when a remote exists; log failures, never fatal. Do not push any other ref.
4. orchestrator_wait: report new create/done commits on meta/kanban instead of board commits on the current branch.
5. Bootstrap: on daemon startup, if .kanban/ has no task files and refs/heads/meta/kanban exists, materialize the .kanban/ task files from the branch.
6. Same merge: untrack .kanban/ (git rm -r --cached .kanban) and ignore .kanban/ in .gitignore.
7. Tests: extend orchestrator.test.ts; at least a check that a mirror commit lands on meta/kanban and not on main, and that the bootstrap materializes files from the branch. All tests pass.

Acceptance:
- After the merge and a daemon restart: main history gets no new kanban commits; board changes appear as commits on meta/kanban; the board branch auto-pushes when a remote exists.
- A fresh clone plus bootstrap materializes the full board.
- The current board content survives unchanged.

Constraints:
- Files: src/orchestrator.ts, src/orchestrator.test.ts, .gitignore. No overlap with the webui queue (src/webui.ts), so it may run in parallel.
- The daemon must be restarted after the merge to activate the new behavior.

# Notes
