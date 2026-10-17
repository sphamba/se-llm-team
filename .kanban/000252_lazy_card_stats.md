---
name: "feat: lazy stats on all board cards"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "lazy-card-stats"
blockedBy: "#263, #264"
---

# Summary
Verification only: #263 (batched card-stats endpoint) and #264 (client lazy fetch on unfold, localStorage cache, subtle animation) together give every board card its token/time stat line - cards beyond the first 5 load lazily on unfold, appear when available with a subtle animation, and done-task stats cache in browser localStorage. Check the integrated feature once both pieces have landed.

# Specs
Verification scope (the pieces land through #263 and #264; check them against the original goal, user decision 2026-10-16: ALL cards show stats, fetched lazily, subtle animation, done-task stats in browser localStorage):

1. The pinned contract held end to end: GET /api/card-stats?files=... answers {file: {agents}} and the client merges it so taskStats renders on every revealed card, not just the first 5.
2. taskPayload's eager first-5 attach is unchanged (the 5 s poll stays cheap under #250's rules: no full-log caching, incremental parsing); the first-5-only cap is gone as the user-facing limit (#245 extended).
3. Unfolding a column reveals every card's stats line with a smooth subtle animation and a subtle card height growth, no layout jump; prefers-reduced-motion turns the animation off.
4. Done tasks serve stats from browser localStorage on the next page load and the next unfold; entries invalidate when a task leaves done; non-done tasks never serve stale stats (always fetch fresh); in-flight fetches de-duped, one batched request not N.
5. node tests/webui.test.ts passes with both subtasks' test additions landed in disjoint regions of the shared file (assert count above the 757 baseline).

Acceptance:
- node tests/webui.test.ts passes.
- Live test (feel-based): unfolding a column gives every revealed card its stats line, appearing smoothly with a subtle height animation; done tasks serve stats from localStorage on the next page load.

# Notes
