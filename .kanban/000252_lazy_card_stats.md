---
name: "feat: lazy stats on all board cards"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "lazy-card-stats"
blockedBy: "#250, #251"
---

# Summary
Every board card gets its token/time stat line: stats for cards beyond the first 5 are fetched lazily when a column unfolds, appear when available with subtle animations, and done-task stats cache in browser localStorage.

# Specs
Problem (facts, confirmed by the PM probe on 2026-10-16): taskPayload attaches agents only to visibleCards, the first 5 per column plus the backlog task (src/webui/payload.ts:466-490, VISIBLE_CARDS=5). toggleCol merely adds to expanded and re-renders from the SAME payload rows, so cards 6+ carry no agents and taskStats returns "" (src/webui/board.ts:44). There is no fetch on expand and no per-card stats endpoint; cards 6+ only show stats if a later poll's first-5 shifts to include them. #245 specced stats on the first 5 visible cards only.

Decisions (user, 2026-10-16): ALL cards show the stats, but the stats can be fetched/queued lazily and appear when they become available, with a smooth subtle animation; the card height also grows with a subtle animation. For done tasks, stats can be cached in browser local storage, NOT orchestrator storage.

Requirements:
1. Unfolding a column queues lazy stats fetches for the newly visible cards (a batched endpoint is preferred over per-card N+1; the server computes per request under #250's rules: no full-log caching, incremental parsing).
2. Stats appear when they become available with a smooth subtle animation; the card height grows with a subtle animation, no layout jump.
3. Done-task stats cache in browser localStorage keyed per task, invalidated when a task leaves done; non-done tasks fetch fresh.
4. Extends #245; the first-5-only cap goes away as the user-facing limit.
5. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui.test.ts passes.
- Live test (feel-based): unfolding a column gives every revealed card its stats line, appearing smoothly with a subtle height animation; done tasks serve stats from localStorage on the next page load.

# Notes
