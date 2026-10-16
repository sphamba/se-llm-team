---
name: "fix: context symlinks committed by developers block the merge"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "context-symlinks-block-merge"
---

# Summary
On fresh projects, Developers commit the task context symlinks (AGENTS.md, SPECS.md) into task branches; their later removal sits unstaged and the merger's rebase fails on every retry. Prevent by hiding the paths from git at spawn and making the merge lane self-heal before each rebase.

# Specs
# Problem
On a fresh project the Developer agents commit the task context symlinks (AGENTS.md, SPECS.md) into the task branches. clearContextSymlinks then deletes them from the worktrees, the deletions sit as unstaged changes, and the merge lane's `git rebase base` (src/orchestrator/pipeline.ts:116) fails on every retry. The pipeline is stuck.

# Root cause (three coupled defects)
1. ensureContextSymlinks (src/orchestrator/spawn.ts:39-46) puts SPECS.md and AGENTS.md in the worktree root. A fresh project tracks neither, so the symlinks are untracked and visible to `git add -A`. A tracked AGENTS.md is already protected: it is marked `--skip-worktree` before replacement, so git status and add never see it.
2. clearContextSymlinks (src/orchestrator/spawn.ts:77+) deletes the paths without a git check. Once committed, the deletions show as unstaged changes.
3. The merge lane rebases without reconciling the two context paths, so any unstaged noise blocks the rebase permanently (cooldown retries fail the same way).

# Fix (two mechanisms plus a supplement)
1. Hide the paths from git at spawn: when spawning into a worktree, ensure the repo's common info/exclude (shared by the main checkout and all linked worktrees) contains AGENTS.md and SPECS.md. Idempotent: append only when missing. Excludes never affect tracked files, so a project's own tracked AGENTS.md keeps its existing skip-worktree flow. This closes defect 1 for untracked paths.
2. Merge-lane hygiene, skip-worktree aware: before every rebase attempt (including each Merger conflict round), for each of the two paths in the worktree: unset skip-worktree (`git update-index --no-skip-worktree`, ignore failure for untracked paths), then `git restore --staged --worktree -- AGENTS.md SPECS.md` (ignore failure when a path does not exist). Then rebase. After the fast-forward, if a path is tracked as a symlink (git mode 120000), remove it from the merged branch with one follow-up commit (for example "chore: remove task context symlinks committed by mistake").
3. Supplement: one line in agents/developer.md: never commit AGENTS.md or SPECS.md; they are task-system context, not project content.

# Constraints
- A project's own tracked AGENTS.md or SPECS.md as a real file (mode 100644) is never touched by the strip step and survives the merge unchanged.
- The strip step removes only symlink-mode entries of the two paths.
- The exclude write must not fail the spawn when info/ or the exclude file cannot be written.
- The hygiene step must not undo genuine task content: it touches only the two context paths.
- agents/developer.md keeps the prompt-scope rule (own-work knowledge only); the line must not break the tests/orchestrator.test.ts pins (those pin agents/merger.md, not developer.md).
- No hub, webui or board-file-format changes.

# Acceptance
- Live check on a fresh-project worktree where the symlinks were committed and then deleted: after a spawn, `git check-ignore AGENTS.md SPECS.md` reports both ignored and `git status --porcelain` shows no untracked context symlinks; the merge lane completes without a stuck rebase and the merged branch carries no context symlinks.
- Live check on a repo with a tracked real AGENTS.md: it survives the merge untouched.
- The tests the developer ships (per the role test policy) pass.

# Notes
