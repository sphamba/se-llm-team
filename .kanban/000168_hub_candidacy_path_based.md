---
name: "fix: hub candidacy detection is path-based so a worktree outside .worktrees stays hub-eligible"
priority: "low"
state: "backlog"
worktree: ""
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

# Open questions
Accept the .worktrees path-segment rule (manually placed worktrees outside it stay hub-eligible), or switch detection to git worktree topology (for example compare git rev-parse --git-common-dir with --show-toplevel, or read the worktree's .git file)?
