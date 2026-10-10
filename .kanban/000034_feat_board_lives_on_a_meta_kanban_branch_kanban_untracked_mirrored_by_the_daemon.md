---
name: "feat: board lives on a meta/kanban branch; .kanban/ untracked, mirrored by the daemon"
priority: "medium"
state: "live-testing"
worktree: "feat/board-lives-on-a-meta-kanban-branch-kanban-untracked-mirrored-by-the-daemon"
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

- [2026-10-10 23:22] Implemented in the worktree:
  - src/orchestrator.ts: commitKanban now mirrors board changes onto refs/heads/meta/kanban with git plumbing only (git hash-object -w batched, git mktree, git commit-tree with parent = current mirror head, git update-ref). It never touches the index or working tree. Identical trees are skipped, so no empty commits. Messages keep the "kanban: create X" / "kanban: done X" format.
  - pushMirror: after each mirror commit, best-effort `git push origin meta/kanban` when a remote exists (30s timeout; failures logged, never fatal; no other ref is pushed).
  - boardStatus: per-file status relative to the mirror ("??" = not on the mirror yet, "M" = differs, "" = identical), via `git ls-tree -r` + `git hash-object`; empty map without git.
  - bootstrapBoard: at startup, the daemon restores task files that are missing from .kanban/ from refs/heads/meta/kanban. This is a superset of the spec's empty-board case: it also heals a merge that drops files from disk.
  - index.ts: orchestrator_wait reports new create/done commits on refs/heads/meta/kanban instead of HEAD.
  - .gitignore: .kanban/ ignored; the old sidecar lines are removed.
  - orchestrator.test.ts: parts A, D, G reworked for the mirror; auto-push checks (only meta/kanban reaches origin); new part L checks that bootstrap materializes the board from the branch. node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts: all pass.
- [2026-10-10 23:22] Transition commits on this branch: "untrack .kanban: the board lives on refs/heads/meta/kanban" (34 stale index entries force-removed from this worktree index; board files stay on disk through the shared symlink). refs/heads/meta/kanban was seeded once with the same plumbing ("kanban: seed board mirror before .kanban untrack", 37 files) so bootstrap can restore anything the untracking merge drops.
- [2026-10-10 23:22] FOR THE MERGER. The branch deletes the tracked .kanban entries because the board moved to refs/heads/meta/kanban. The merge refuses while a .kanban file is dirty in the main working tree (000034 is). Steps:
  1. `git add .kanban && git commit -m "preserve board state before untrack merge"` in ROOT.
  2. `git merge --no-edit <branch>`. Expect CONFLICT (modify/delete) on the previously dirty .kanban files; the HEAD version stays in the tree.
  3. Accept the deletions, keep the disk files untracked: `git ls-files .kanban | while read -r p; do git update-index --force-remove "$p"; done` (also untracks tasks that main committed after this branch forked, for example 000036/000037; disk files remain).
  4. `git commit` to complete the merge. .gitignore already has .kanban/.
  5. Restart the daemon (task constraint). The new code mirrors the board to refs/heads/meta/kanban and bootstraps missing files from it. The board content on disk survives.
- [2026-10-10 23:22] Deviations from the spec: bootstrap restores missing files, not only an empty board (safe superset, documented above). index.ts is outside the stated file list, but change 4 (orchestrator_wait) lives there. SPECS.md and README.md still describe commits at creation and done; they are stale after this merge and are not in the allowed file list.
- [2026-10-10 23:47] Review (worktree commit 593ea9d): implementation matches the spec. commitKanban mirrors via plumbing only (hash-object -w, mktree, commit-tree with parent, update-ref), identical trees skip commit and push, pushMirror pushes only meta/kanban best-effort, boardStatus is mirror-relative, orchestrator_wait watches the mirror ref, .gitignore ignores .kanban/, untrack commit in place. Tests verified in the worktree: kanban.test.ts, orchestrator.test.ts (parts A, D, G, L all reworked plus auto-push checks), webui.test.ts all pass. Two fixes committed: bootstrapBoard now rejects tree entries with path traversal (name must be a flat .md file, the branch can come from a remote on a fresh clone), and a stale duplicate console.log at the end of orchestrator.test.ts was removed. State set back to to-review.
- [2026-10-10 23:58] Re-review of worktree commit 593ea9d: no fixes needed, ready for live test. Verified myself in the worktree: kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass. refs/heads/meta/kanban exists with the seed and refresh commits, 37 files, names identical to disk. commitKanban never touches the index or working tree, identical trees skip commit and push, pushMirror pushes only meta/kanban and only when a remote exists, orchestrator_wait handles the mirror appearing or vanishing mid-wait, bootstrapBoard guards path traversal. Fresh-clone edge confirmed: the .logs/.pids mkdir creates .kanban/ before bootstrapBoard runs, so bootstrap works on a bare clone. Known, acceptable drift: the mirror copy of 000034 lags the disk file (state line plus the 23:47 review note were appended after the mirror seed) because commits only happen at the create/done points; it self-heals when this task reaches done. Prior-review fixes were re-checked in the code and are correct.
- [2026-10-10 23:46] Live test of worktree commit 593ea9d. Main flows verified in a sandbox repo (copy of this worktree, git init, local bare origin) plus a real-board smoke test. PASS: mirror commits land on refs/heads/meta/kanban via plumbing and never on main; create and done both verified, messages keep the "kanban: create X" / "kanban: done X" format; only meta/kanban auto-pushes (remote main unchanged); commitKanban never touches the index or working tree (a pre-existing dirty file stayed unstaged, nothing staged); identical trees skip commit and push; bootstrap on restart restores a deleted task file from the mirror ("bootstrapped 1 task file(s)" in the log); bare-clone bootstrap works; the wait-tool command sequence (baseline sha, then git log <baseline>..refs/heads/meta/kanban filtered to kanban: create/done) reports new events. Real board: daemon restarted from this worktree (lock sane, webui up on 4242), first sweep self-healed the mirror drift of 000030/000034/000036, after which 41/41 board files are blob-identical to the mirror and board content is intact; push to origin failed (SSH host-key verification fails in this environment) and was logged non-fatal; poke adds no spurious mirror commit; main history got no new board commits from this daemon.
- [2026-10-10 23:46] Issues found (passed to the PM for new tasks): (1) Mislabeled and swallowed mirror commits: for a done task without a worktree, the rescan done branch calls commitKanban("kanban: done X") unconditionally on every sweep, and commitKanban builds the tree from the whole board, so the first such call folds all pending board changes under that task's label; later tasks' create branches then find an identical tree and are skipped. Reproduced twice in the sandbox: a task created right after a done-no-worktree task exists never gets its own "kanban: create X" commit; the folding commit is mislabeled "kanban: done <earliest done task>". The real board is fully exposed (33 done tasks with worktree "") and this daemon's first sweep demonstrated it: the drift of 000030/000034/000036 folded under "kanban: done 000001_...". orchestrator_wait consequently reports wrong events, since create events never surface as commits. (2) Fresh non-bare clone: bootstrap fails. bootstrapBoard verifies refs/heads/meta/kanban, but a fresh clone only has refs/remotes/origin/meta/kanban, so the board does not materialize (empty .kanban/, no bootstrap log line); the first board change in the clone then creates an orphan mirror commit (no parent) whose auto-push fails non-fast-forward (observed in the daemon log). The fresh-clone acceptance only holds for bare clones. Not a finding: the real-origin push could not be exercised (SSH host-key verification fails in this environment); the push path was verified against a local bare remote.
