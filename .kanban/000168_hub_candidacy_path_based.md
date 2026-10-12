---
name: "fix: hub candidacy detection is path-based so a worktree outside .worktrees stays hub-eligible"
priority: "low"
state: "reviewing"
worktree: "fix/168-hub-candidacy-path-based"
issuer: "#165"
complexity: "simple"
shortName: "hub-candidacy-path-based"
---

# Summary
Hub candidacy is detected with splitWorktreeRoot looking for a .worktrees path segment. A daemon rooted at a git worktree created outside .worktrees (e.g. git worktree add /tmp/x) treats itself as production and can bind the port. Either accept and document the path-segment rule or switch detection to git worktree topology.

# Specs
Found in the live test of #165 (fix merged at fa7f502; harness was an isolated scratch clone at that commit with an isolated HOME, webUi on 127.0.0.1:4488, SE_LLM_TEAM_HUB_HEALTH_MS=500).

## Problem

Candidacy detection is path-based: splitWorktreeRoot looks for a .worktrees path segment. A new-code daemon rooted at a git worktree placed outside .worktrees (git worktree add /tmp/x) treated itself as production and bound the port ("web ui on ... (hub for wt-outside)").

## Impact

The orchestrator always creates task worktrees under .worktrees, so the real-world impact is small (severity: low), but the #165 decision wording says "qualifying daemons are any that are not a task worktree", and this class of worktree is one.

## Acceptance

Either the .worktrees path-segment rule is accepted and documented (manually placed worktrees outside it stay hub-eligible), or detection switches to git worktree topology — for example compare git rev-parse --git-common-dir with --show-toplevel, or read the worktree's .git file — with a test covering a worktree outside .worktrees.

# Notes

## Decision (user, 2026-10-12)
Switch detection to git worktree topology: a daemon is non-production when its git common dir differs from its working tree top level (compare git rev-parse --git-common-dir with --show-toplevel), catching worktrees created anywhere, not just .worktrees. Add a test covering a worktree outside .worktrees.

## Done (developer, 2026-10-12)
- src/hub.ts: new exported isLinkedWorktree(root). Git topology, not path segments: the per-worktree git dir differs from the common dir. Git failure (non-git root) falls back to production, as before.
- joinHub: canHub = !isLinkedWorktree(opts.root). The splitWorktreeRoot import is gone. The standdown log now says "linked worktree checkout".
- The task-worktree self-reap in orchestrator.ts stays path-based. Task worktrees always live under .worktrees, so no change needed there.
- README: the hub candidacy paragraph now documents the topology rule.
- Tests: orchestrator.test.ts part Y2. Unit asserts for a main checkout, a subdir of one, a worktree outside .worktrees, a subdir of it, and a non-git root. E2E: a daemon rooted at that worktree stands down, never binds, never races for the hub lock, and is not reaped as a task worktree. Full suite passes (kanban, orchestrator, webui, extension, index). Commit 04c53df.

# Open questions

- Assumption: the literal command pair in the decision (--git-common-dir vs --show-toplevel) would wrongly mark a separate-git-dir main checkout (git init --separate-git-dir) non-production. I kept the same topology rule but compare --git-dir with --git-common-dir, the canonical linked-worktree check, so that case stays production. Confirm this mapping is acceptable.
- Assumption: a linked worktree of a bare repo counts as non-production (git worktree add created it). A bare repo root itself stays production.
