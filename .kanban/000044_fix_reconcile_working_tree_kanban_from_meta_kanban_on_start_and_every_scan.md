---
name: "fix: reconcile working-tree .kanban from meta/kanban on start and every scan"
priority: "high"
state: "reviewing"
worktree: "fix/reconcile-working-tree-kanban-from-meta-kanban-on-start-and-every-scan"
---

# Summary
Close the drift root cause: the daemon only ever syncs working-tree to branch (commitKanban plumbing); the only branch-to-tree path is bootstrapBoard, which runs once at startup and restores only missing files. Add a reconcile step that materializes the refs/heads/meta/kanban tip into the working-tree .kanban at daemon start and on every scan, so a stale tree can never erase branch content and agents always read fresh states.

# Specs
# Context

The daemon mirrors the working-tree .kanban onto refs/heads/meta/kanban via full-tree snapshot commits (plumbing, never touches the index or pulls the branch back). bootstrapBoard (src/orchestrator.ts, startup only) restores only files missing from .kanban (the have.has(name) guard); present-but-stale files are never refreshed and nothing re-syncs mid-life. When the working tree goes stale, the next snapshot commit ERASES branch-only content (proven: the tip lost tasks 000042-000045 and reverted done states). Approved policy (user decision): reconcile at start and on every scan, branch wins for mirrored files, unmirrored local writes survive, index never touched.

# Specs

- Base: merged main (after the origin/main merge lands). Reuse the existing bootstrapBoard materialize path (git ls-tree -r refs/heads/meta/kanban -- .kanban + git cat-file blob) and boardStatus's per-file comparison (read-only hash-object vs ls-tree) instead of adding new plumbing. Do not keep two materialize paths.
- Behavior:
  - At daemon start: reconcile the working-tree .kanban to the branch tip — write files whose content differs from the tip; delete local files that the previous mirrored tree had and the tip lacks (external deletions propagate); never delete local files that were never mirrored (protects in-flight PM writes between file write and mirror commit). Replace bootstrapBoard's missing-only restore with this content-aware reconcile.
  - During the scan loop: commitKanban knows the hash it last wrote with update-ref. At the top of every rescan (before boardStatus reads and before any commitKanban), re-read `git rev-parse refs/heads/meta/kanban`; if it differs from the last written hash, run the same reconcile (branch wins for mirrored files) before continuing the scan. This ordering is the root-cause fix: a snapshot commit must never be built from a tree that lacks branch-only files.
  - Never stage anything: leave the git index untouched (.kanban stays untracked/ignored on main).
  - Skip dot-entries (.kanban/.logs, .kanban/.orchestrator.lock) exactly as the current mirror does.
  - Log one line per reconcile to the orchestrator log: hash, files updated, files deleted.
- Tests: extend src/orchestrator.test.ts in the existing part-A style (real daemons in tmp git fixtures, runDaemon + mirrorSubjects): (1) an external commit on refs/heads/meta/kanban is materialized into the working tree within one scan; (2) a stale working tree does not erase branch-only files on the next mirror commit; (3) an unmirrored local file survives a reconcile; (4) an external deletion propagates to the working tree.

# Acceptance

- After an external commit to refs/heads/meta/kanban, the working-tree .kanban matches the tip within one scan.
- No mirror commit ever removes files present on the branch but absent from the working tree.
- Typecheck/build and the full test suite pass.

# Notes

- [2026-10-11 00:15] Implemented reconcileBoard in src/orchestrator.ts: materializes refs/heads/meta/kanban into the working-tree .kanban, triggered only when the branch head differs from the hash this process last materialized or wrote with update-ref (new lastMirrorHash, set by commitKanban and by reconcileBoard). Writes tip files missing from or differing from the tree (ls-tree -r + read-only hash-object comparison + cat-file blob, reusing the bootstrap materialize path and boardStatus's comparison), deletes local .md files the tip lacks that the last known mirror tree (tree of lastMirrorHash) had or the tip's ancestry ever carried (external deletions propagate; never-mirrored in-flight PM writes survive), skips dot-entries and nested paths like the mirror does, never touches the index, and logs one line per reconcile (hash, files updated, files deleted). bootstrapBoard now keeps only the remote seed and delegates to reconcileBoard, so there is one materialize path; rescan reconciles before boardStatus and before any commitKanban, the root-cause ordering.
- [2026-10-11 00:15] Tests: added externalCommit/showTip/taskContent helpers and parts P and Q to src/orchestrator.test.ts (real daemons in tmp git fixtures, deadStub agents): (1) external commit materialized into the working tree within one scan, (2) stale tree does not erase branch-only files on the next mirror commit, (3) unmirrored local file survives a reconcile, (4) external deletion propagates to the working tree, plus reconcile log-line and no-commit-churn assertions. Also fixed a pre-existing part D race: the test now waits for the per-worktree excludesFile setup to converge instead of asserting right after the symlink appears.
- [2026-10-11 00:15] Verified: node src/orchestrator.test.ts passes twice consecutively (all parts A-Q), node src/kanban.test.ts and node src/webui.test.ts pass, modules load under plain node (no tsconfig in the repo, Node 24 type stripping). Committed as 790722e in the worktree.
- [2026-10-11 00:15] Note found during testing: when several tasks already exist at the first sweep, the first create commit folds the whole board into its snapshot, so later tasks get no separate create label (pre-existing full-snapshot behavior, out of scope here). Test expectations use tip existence, not per-task labels, for that case.