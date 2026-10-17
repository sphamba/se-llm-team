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

- Blocked verification (checked 2026-10-17 at base 82160ef): neither dependency has landed. #263 is in state doing (its worktree has no commits, only an uncommitted tests/webui.test.ts change). #264 is in state to-do (its worktree is clean with no commits).
- Absent from the base: no /api/card-stats route in src/hub.ts, no cardStatsPayload export in src/webui/payload.ts, no lazy stats fetch and no stats localStorage entry in src/webui/page.ts. VISIBLE_CARDS = 5 (src/webui/payload.ts:610) still caps the eager attach.
- node tests/webui.test.ts passes with 757 asserts (exit 0, output in /tmp/252-webui-baseline.log). The test additions of both subtasks are absent, so the count is not above the 757 baseline.
- No live check ran: there is no endpoint and no client behavior to verify.
- This run raced the split: the daemon promoted the task when its earlier blockers #250 and #251 reached done, the splitter then set blockedBy #263 and #264, and the developer spawned in the same minute. The ordering was premature, not the implementation.
- Next step: re-run this verification after #263 and #264 land on main. The worktree then needs a base that holds both commits.
