---
name: "fix: summary cards of usage-less runs show 0 · Ns instead of just Ns"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#178"
complexity: "simple"
shortName: "card-stats-usage-less"
blockedBy: "#182"
---

# Summary
A task whose agent entries carry a duration but no usage record (legacy/no-usage logs, or every live run before its first usage record) shows "0 · Ns" on its summary card, while the modal agent card for the same run shows just "Ns". The tokens part must be omitted so the card reads like the agent cards' stats, per the #178 spec. Finding reported by #178's live test.

# Specs

## Change
- taskStatsText (src/webui.ts, next to agentStatsText, ~:871) sums the agents array's tokens per entry with non-number fields counting as 0, so a usage-less task sums to 0 and fmtTokens(0) renders "0" ahead of the duration.
- Change taskStatsText so the tokens part renders only when at least one entry carries a finite numeric token count (a usage-bearing record): track whether any tokens field was a number; when none is, omit the tokens part so the line reads just "Ns".
- The both-totals-0/null hiding rule extends accordingly: hide the line when the rendered parts would be empty (no tokens and no duration).
- agentStatsText/fmtTokens/fmtDur are untouched; the .card-stats styling, card placement after the chips (#178), modal agent cards and syncBoard mechanics stay unchanged.

## Tests
- src/webui.test.ts: extend the #178 card-stats block with an assertion that entries carrying durations but no numeric tokens render only the duration ("1s", not "0 · 1s"), keeping the summed-totals, hiding and css assertions intact.

# Notes
- Filed by the PM from #178's live-test finding (2026-10-12), hand-written with blockedBy "#182" because #182 is in doing and both tasks touch the card-stats assertions near src/webui.test.ts:533 and adjacent functions in src/webui.ts.
