---
name: "feat: task summary cards show total tokens and time across all agents"
priority: "medium"
state: "reviewing"
worktree: "feat/178-card-total-tokens-time"
issuer: "user"
complexity: "simple"
shortName: "card-total-tokens-time"
blockedBy: ""
---

# Summary
In the task summary (preview) cards, below the chips, show the total tokens (input + output) and total time across all agents of the task. Follows #177 (per-agent tokens become input + output).

# Specs

## Change
- The /api/tasks payload already carries each task's `agents` array with per-run `tokens` and `duration` (taskPayload -> agentHistory over logStats, src/webui.ts:650-668), and cardHtml (src/webui.ts:930) receives that task object at the render site.
- In cardHtml, below the priority/complexity/issuer chips, add a muted stats line showing the totals across all agent entries: tokens = sum of the entries' tokens, time = sum of the entries' durations.
- Reuse the existing token/duration formatting helpers agentStatsText uses (same raw-below-1000, k, one-decimal-M format), so the card line reads like the agent cards' stats.
- Hide the line when the task has no agent entries or both totals are 0/null.
- The detail modal agent cards are untouched; the #176 chip spacing, card identity/refresh mechanics (syncBoard __html compare) and all existing rendering rules stay unchanged. Changing cardHtml changes every card's markup, which is one full board re-render, no behavior change.

## Tests
- src/webui.test.ts: add an assertion that a task card with agent entries carrying tokens/durations renders the summed totals, and that a task with no agent entries renders no stats line.

# Notes
- Filed by the PM (user request, 2026-10-12), hand-written with blockedBy "#177" from birth because #177 is in doing and both tasks rewrite cardHtml in src/webui.ts and src/webui.test.ts.
- 2026-10-12 (dev): implemented in feat/178-card-total-tokens-time (commit 8ea9467). New exported taskStatsText(t) in src/webui.ts next to agentStatsText sums the agents array's tokens/durations per entry (non-number fields count as 0) and wraps the joined "42k · 3.5s" string in a .card-stats span, hidden when no entries or both totals are 0/null. cardHtml appends it after the issuer chip, the page interpolates taskStatsText next to agentStatsText, and a .card-stats muted style (same values as .agent-stats) ships in the css. Tests: three assertions in src/webui.test.ts (summed totals, no-entries hides, css ships). All five test suites pass.

# Open questions

# Assumptions
- Live-task cards (a live agent's duration ticks per payload) now rewrite their markup every 1 s poll, so their spinner animation restarts each tick; the spec keeps syncBoard's in-place mechanics untouched, so accepted as-is (upgrade path: an in-place card-stats pass like syncAgentStats).
- Totals span every entry in the agents array (all roles, all runs, finished and live), not only live agents.
