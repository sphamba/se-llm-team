---
name: "feat: agent cards show a cross for runs that died before succeeding"
priority: "medium"
state: "backlog"
worktree: ""
complexity: complex
blockedBy: "#127"
---

# Summary
All finished agent cards in the task detail show a checkmark, whether the run succeeded or died before succeeding. The orchestrator already distinguishes the two (a run that advanced the state itself vs a bounced/killed run); record a per-run death marker and have the webui show a cross with red text for dead runs.

# Specs
# Server: per-run death marker (src/orchestrator.ts, src/orchestrator.test.ts)

bounceDead (src/orchestrator.ts ~:1160) fires for both death kinds (dead pid, stalled log) and knows the task, the state-mapped role, and the dying pid. The dying run is the newest existing run log for that role (the run index known at spawn = nextRunIndex - 1).

- In bounceDead, compute the newest `.kanban/.logs/<slug>.<role>.<n>.log` for the role at bounce time and write a sibling marker `<slug>.<role>.<n>.dead` (one line: the bounced state or the pid). Skip when no run log exists for the role.
- The marker is per-run, so a fresh respawn (new index) is unaffected; markers never touch the counter files, the armed marker, or the gzip sweep's live-pid check.
- Markers may linger after the task moves on - harmless, no janitor required.
- src/orchestrator.test.ts: a bounced fake agent produces the `<n>.dead` marker for the right run index; a run that advances the state itself produces no marker.

# Webui: cross icon and red text (src/webui.ts, src/webui.test.ts)

- agentHistory (src/webui.ts ~:102-126) checks for the sibling `.dead` marker per run entry and serves a status field: "live" when alive, "dead" when the marker exists, "ok" otherwise (no marker means the run advanced the state itself, the same signal consumeReviewerRun uses).
- agentCardHtml / renderAgent: a dead run's card shows a cross mark (e.g. ✗) instead of the check and red text (a muted red that reads in both themes, e.g. color-mix or an existing var). Live keeps the spin, ok keeps the check.
- Subagent cards keep the check - a sub has no pid file or bounce machinery, so no death signal exists for subs (deliberate non-goal).
- src/webui.test.ts: payload status for a fixture with and without the marker, and the card markup showing the cross/red for dead.

# Complexity

complex (user-ordered complexity assignment; multi-file, two subsystems). Files: src/orchestrator.ts, src/orchestrator.test.ts, src/webui.ts, src/webui.test.ts.

# Notes
