---
name: "fix: fresh non-bare clone bootstrap never materializes the board"
priority: "medium"
state: "to-live-test"
worktree: "fix/fresh-non-bare-clone-bootstrap-never-materializes-the-board"
---

# Summary
bootstrapBoard (src/orchestrator.ts) guards on refs/heads/meta/kanban, but a fresh `git clone` only carries refs/remotes/origin/meta/kanban (remote-tracking ref), so bootstrap returns early and .kanban/ stays empty; the first board change then creates an ORPHAN mirror commit whose auto-push fails non-fast-forward against origin's meta/kanban.

# Specs
FILE/FUNCTION: src/orchestrator.ts, bootstrapBoard() (line ~301; guard at line 302: `if (git(root, ["rev-parse", "--verify", KANBAN_REF], true) === null) return;` with KANBAN_REF = "refs/heads/meta/kanban", line 25).

ROOT CAUSE: A fresh `git clone` has only `refs/remotes/origin/meta/kanban` (remote-tracking ref), no local `refs/heads/meta/kanban`, so the guard returns early: empty .kanban/, no "bootstrapped" log line, board never materializes. The acceptance "a fresh clone plus bootstrap materializes the full board" only holds for bare clones.

REPRODUCTION: Fresh non-bare clone of a repo with a pushed meta/kanban branch; run the daemon (bootstrap): .kanban/ stays empty and no "bootstrapped" line is logged.

CONSEQUENCE (observed): The first board change in the clone makes commitKanban see no parent and create an ORPHAN mirror commit (no parent); its auto-push then fails non-fast-forward against origin's meta/kanban (push-failure hints in the daemon log).

SUGGESTED DIRECTION (for the dev to decide): bootstrap from refs/remotes/origin/meta/kanban when refs/heads/meta/kanban is absent (e.g., create the local branch from the remote-tracking ref), and/or seed the local mirror from origin before the first commit.

# Notes

- Root cause confirmed: a fresh non-bare clone has only refs/remotes/origin/meta/kanban, so the refs/heads guard in bootstrapBoard returned early and the board never materialized; commitKanban then saw no parent and produced an orphan mirror commit that could not push.
- Fix in src/orchestrator.ts, bootstrapBoard(): when refs/heads/meta/kanban does not resolve, seed it with git update-ref from refs/remotes/origin/meta/kanban (falling back to the first refs/remotes/*/meta/kanban found by for-each-ref, for renamed remotes), then log "seeded refs/heads/meta/kanban from <ref>" and continue with the normal restore. No-op when the local branch already exists (bare clones and normal repos unchanged). Seeding gives commitKanban a parent, so the first board change pushes fast-forward.
- Verified manually: fresh clone of a repo with a pushed meta/kanban branch plus daemon start logs "seeded" + "bootstrapped 1 task file(s)", materializes .kanban/ task files, and a first board change creates a mirror commit with the seeded head as parent that pushes fast-forward to origin (no push failures).
- Added orchestrator.test.ts part M: fresh non-bare clone of a bare origin with a pushed meta/kanban branch; asserts the seed log, seeded sha, restored content, no main-history commits, and that a post-clone board change advances origin's meta/kanban with a parented commit. Full suite (parts A-M) plus kanban.test.ts and webui.test.ts pass.
- Review passed (2026-10-10): checked the seed path against git plumbing directly (update-ref resolves refs/remotes/origin/meta/kanban, for-each-ref glob matches, renamed-remote fallback finds refs/remotes/upstream/meta/kanban after remote rename); the guard skips cleanly when no mirror ref exists, so repos without a remote behave as before. Seeding touches no index or working tree and commits nothing on main, matching the mirror-via-plumbing design. Re-ran the full suite in the worktree myself: orchestrator.test.ts (parts A-M), kanban.test.ts, webui.test.ts all pass. No fixes needed; moved to to-live-test.
