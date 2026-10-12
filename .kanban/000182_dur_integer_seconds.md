---
name: "fix: duration labels show integer seconds, no fractions"
priority: "medium"
state: "doing"
worktree: "fix/182-dur-integer-seconds"
issuer: "user"
complexity: "trivial"
shortName: "dur-integer-seconds"
blockedBy: ""
---

# Summary
Where time is shown in seconds in the webui (task summary cards' stats line and the agent cards' stats line), show integer seconds, never fractional.

# Specs

## Change
- fmtDur (src/webui.ts:853) is the single shared duration formatter: agent cards' stats lines (agentStatsText) and the task summary cards' card-stats line (taskStatsText -> agentStatsText) both use it, so one change covers both.
- Drop the below-10s one-decimal branch (s < 10 -> s.toFixed(1) + "s") and round seconds to an integer everywhere: sec = Math.round(s), then the existing whole-seconds (< 60 -> "Ns") and minutes branches unchanged. So 3.5s renders as "4s", 0.4s as "0s", 3479 ms as "3s".
- Tokens formatting (fmtTokens) and the k/M display are untouched; duration is still computed in ms server-side (#169 live duration) and only the label rounds.

## Tests
- src/webui.test.ts: update the two assertions pinning fractions — fmtDur(3479) === "3s" (:1282) and the card-stats assertion "2k · 3.5s" becomes "2k · 4s" (:533, the summed 3500 ms rounds after summing). The whole-minute/null assertions stay.

# Notes
- Filed by the PM (user request, 2026-10-12). Runs parallel to the in-flight #181 (pairLayout) and #179 (src/kanban.ts): the touched regions of src/webui.ts and src/webui.test.ts are disjoint per the standing parallelism order.
