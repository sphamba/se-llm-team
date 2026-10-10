---
name: "perf: webui board polling every 5s instead of 2s"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
The web dashboard page refreshes the board every 2 seconds (src/webui.ts:191, setInterval(refresh, 2000)). Set it to 5 seconds to cut request load.

# Specs
Slow the web dashboard refresh rate.

Changes:
- src/webui.ts line 191: setInterval(refresh, 2000) → setInterval(refresh, 5000).

Acceptance:
- The served page polls /api/tasks every 5 seconds.
- Existing tests pass (no test references the interval).

Constraints:
- Only src/webui.ts changes.

# Notes
