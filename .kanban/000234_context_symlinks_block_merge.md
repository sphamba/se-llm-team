---
name: "fix: context symlinks committed by developers block the merge"
priority: "high"
state: "live-testing"
worktree: "fix/234-context-symlinks-block-merge"
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
- Added ensureInfoExclude (src/orchestrator/spawn.ts, called from spawnAgent beside ensureContextSymlinks): every spawn hides AGENTS.md and SPECS.md in the repo's common info/exclude, resolved via `git rev-parse --git-common-dir` so one call covers the main checkout and all linked worktrees. Idempotent (appends only missing names) and best-effort (an unwritable info/exclude logs and never fails the spawn).
- Added cleanContextPaths and stripContextSymlinks (src/orchestrator/pipeline.ts): before every rebase attempt (each Merger retry included) the hygiene unsets any skip-worktree bit then restores each of the two paths to HEAD, per path, both steps ignored; after the fast-forward, symlink-mode (120000) entries of the two paths are removed with one follow-up commit "chore: remove task context symlinks committed by mistake" (run with commit.gpgsign disabled so the housekeeping never wedges on a signing setup), which keeps the worktree branch an ancestor of HEAD so doneCleanup's `git branch -d` still works.
- agents/developer.md gained one line: never commit AGENTS.md or SPECS.md (task-system context, not project content).
- New tests/context-symlinks.test.ts, five parts (spawn exclude + idempotency, unwritable exclude never fails the spawn, committed-then-deleted symlinks self-heal through the merge lane, a tracked real AGENTS.md survives with mode 100644 and no strip commit, the developer prompt pins). Red first: the exclude assert failed pre-fix. All five pass, and tests/orchestrator.test.ts passes with the changes.
- Test lesson: the sh wrapper that records a spawned stub's exit stays a live pid until node's event loop reaps it, and a busy wait loop blocks the SIGCHLD reaper, leaving a zombie that pidAlive reads as alive; wait loops must sleep between checks.
- Review (this run, base main @ 011bd6b): diff verified against the Specs point by point, pass. ensureInfoExclude resolves `--git-common-dir`, appends only missing names, best-effort (CS2 covers the unwritable case). cleanContextPaths runs before every sweep rebase; each Merger spawn follows a hygiene pass in the same sweep, so a conflict round's `rebase --continue` starts with clean context paths, and even a blocked continue converges (retry cleans, respawns the Merger). stripContextSymlinks gates on mode 120000 only (CS4: tracked real 100644 AGENTS.md survives, no strip commit).
- Checked the pathspec-less strip commit for folded content: commitKanban builds trees via hash-object/mktree and never stages into the index, so the root index holds only the strip's own `git rm`; no board content can ride the strip commit.
- Suites (this run): tests/context-symlinks.test.ts all 5 parts pass, tests/plugin.test.ts pass, tests/orchestrator.test.ts exit 0.
- No fixes made; no Open questions section was present, none raised.
- Merger rebase (this run, base main @ 889b0d3): the stopped rebase held both picks already staged (resolution from the prior run) but rescheduled by the GPG-sign failure; committed each staged pick manually with the original message, author, date and --no-gpg-sign (8a5682e fix, 839d83f docs); no content conflicts, the rescheduled picks dropped as "patch contents already upstream". Full suite `npm test` exit 0; note the npm test chain does not include tests/context-symlinks.test.ts, so it was run directly: all 5 parts pass.