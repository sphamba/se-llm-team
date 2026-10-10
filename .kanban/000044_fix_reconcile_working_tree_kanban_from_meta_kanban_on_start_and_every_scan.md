---
name: "fix: reconcile working-tree .kanban from meta/kanban on start and every scan"
priority: "high"
state: "doing"
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
