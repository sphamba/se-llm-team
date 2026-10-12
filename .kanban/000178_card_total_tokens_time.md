---
name: "feat: task summary cards show total tokens and time across all agents"
priority: "medium"
state: "done"
worktree: ""
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
- 2026-10-12 (review): verified in feat/178-card-total-tokens-time (8ea9467). Branch includes #177 (merge-base 966ce04), so each entry's tokens is input + output. taskStatsText sums the entries' tokens/durations and reuses agentStatsText (same raw-below-1000/k/one-decimal-M format), hides with no entries or both totals 0/null. The .card-stats css is identical to .agent-stats. The modal agent cards and the syncBoard __html mechanics are untouched. Tests assert the summed totals (420+1580 -> "2k", 1500+2000 -> "3.5s"), the no-entries hiding and the css. All five suites pass.
- Review confirmation: totals span every entry in the agents array (all roles, all runs, finished and live). This matches the spec's "totals across all agent entries", so it is not an open question. No code fixes.

- 2026-10-12 (merge): step 1, base main already contained in feat/178-card-total-tokens-time ("Already up to date"), no conflicts, so no test suites run. Step 2, main fast-forwarded 966ce04 -> 8ea9467 (src/webui.ts +16, src/webui.test.ts +5). Both merges clean, no conflict resolution needed.
- 2026-10-12 (live-test): hub-only live test of the merged commit 8ea9467 with the real src/webui.ts, an isolated root (/tmp/t178/repo, 5 synthetic tasks, isolated HOME) and port 4967; no unit suite. A two-run task (developer 420 tok/1500 ms, reviewer 1580 tok/2000 ms) renders "2k · 3.5s" in a `.card-stats` span that is the last element of the card, below the chips, muted 10px block. A task with no runs and a task with only 0/null totals hide the line. A live run's totals include the now-based duration and the rendered line advances with the board poll (+5 s over 6.2 s, api in step); the card node and the chip layout stay, and the modal still shows per-agent stats (developer "420 · 1.5s", reviewer "2k · 2.0s") with no `.card-stats`. Assumption: log record shapes as in #177 (`turn_end` with `message.usage.input/output`), duration = last minus first timestamp, live duration = now minus first timestamp. Observed and accepted: the live card's markup changes each poll, so its `.spin` node is recreated (the task's open-question default; the card node itself is kept).
- 2026-10-12 (live-test, finding reported to the PM): a task whose entries carry a duration but no usage record shows "0 · Ns" on the summary card, because taskStatsText sums null tokens to 0 and fmtTokens(0) returns "0", while the same run's agent card in the modal shows just "Ns". This hits legacy/no-usage logs (observed card "0 · 3.0s", agent card "3.0s") and every live run before its first usage record (observed card "0 · 59s", agent card "59s"), so the spec's "reads like the agent cards' stats" is not met for usage-less entries.

# Open questions
- Live cards (a live agent's duration ticks with now - first per payload, 000169) now rewrite their markup on every poll, so the spinner animation restarts each tick. Accept the stutter, or should the stats line update in place (an in-place card-stats pass like syncAgentStats)? The spec's "syncBoard stays unchanged" excludes the in-place pass, so the developer accepted the stutter as-is. Default: accept.
