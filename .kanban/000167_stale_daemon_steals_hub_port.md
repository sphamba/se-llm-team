---
name: "fix: pre-#165 hub-aware worktree daemons still steal the port on restart"
priority: "medium"
state: "doing"
worktree: "fix/167-stale-daemon-steals-hub-port"
issuer: "#165"
complexity: "moderate"
shortName: "stale-daemon-steals-hub-port"
---

# Summary
The #165 restart-race fix only constrains daemons running the new code. A leaked hub-aware worktree daemon from a pre-#165 checkout still wins the hub election during the restart window, binds the production port and keeps it, so the restarted production daemon can only register with it. Make the production daemon reclaim (or preempt) the port from such a daemon, or document one-time manual hygiene if the residue is accepted.

# Specs
Found in the live test of #165 (fix merged at fa7f502; harness was an isolated scratch clone at that commit with an isolated HOME, webUi on 127.0.0.1:4488, SE_LLM_TEAM_HUB_HEALTH_MS=500).

## Problem

#165 makes a daemon rooted in a task worktree (root path containing a .worktrees segment) never race the hub election, and reap itself when its owner board task is done or gone. Both checks run inside the daemon's own code, so a pre-existing daemon running old code ignores them.

## Evidence

- A daemon rooted at .worktrees/old-probe with code at 7ecec18 (hub-aware, before the #165 fix) registered with the new-code hub on 4488.
- After the new-code hub was killed, the old-code daemon bound 4488 within 3 s: GET /health 200, GET /api/hub 404, hub lock held by its pid 3861108.
- A restarted production daemon (fa7f502, root of the clone, pid 3861738) could only register with the old-code hub; the port never returned to the production code.

## Impact

This is exactly the leaked-daemon class the #165 Mechanism section names, so the acceptance "a leaked or old-checkout daemon cannot capture it in the restart window" is not met for pre-existing leaks. Severity: medium.

## Acceptance

Either the production daemon can reclaim/preempt the port from a worktree-rooted old-code hub (explicitly designed and tested), or the residue is accepted and a documented one-time hygiene step (kill pre-fix hub-aware worktree daemons once) is added.

# Notes

## Decision (user, 2026-10-12)
One-time manual hygiene, not a port-reclaim follow-up. The task's code change is to document the cleanup (README or the #165 notes): kill any pre-#165 hub-aware worktree daemons once; new worktree daemons run post-#165 code and self-exclude, so the residue does not recur. The PM killed the leaked pre-fix daemons on this machine today.

# Open questions
