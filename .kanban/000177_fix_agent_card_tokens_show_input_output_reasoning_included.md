---
name: "fix: agent card tokens show input + output (reasoning included)"
priority: "medium"
state: "doing"
worktree: "fix/177-agent-card-tokens"
---

# Summary
Change the token metric the webui agent cards show from the cumulative usage.totalTokens (which adds cache reads and writes) to input + output summed over the run's usage-bearing records. Reasoning is a subset of output in pi's normalized usage, so it is included once; cacheRead/cacheWrite are excluded.

# Specs
The agent cards' token number currently sums usage.totalTokens over every turn_end/assistant record (logStats, src/webui.ts ~:268-269), and totalTokens = input + output + cacheRead + cacheWrite, so cache re-reads dominate the displayed value. The user wants the cards to show the actual processed volume: input tokens + output tokens, where reasoning is already a subset of output (included once, no double count).

Change in logStats (src/webui.ts ~:268):
- Sum rec.message.usage.input + rec.message.usage.output instead of rec.message.usage.totalTokens, guarding both as finite numbers; skip records that lack them.
- The cheap pre-filter line at ~:261 checks for '"totalTokens"' and must also pass records carrying '"input"'/'"output"' (or simply check for '"usage"').
- The one-decimal k/M display format (agentStatsText) is unchanged.
- duration/model/thinkingLevel extraction and the statsCache memoization stay unchanged.

Tests (src/webui.test.ts):
- The fake turn_end records at ~:1059-1060 carry only totalTokens; give them input/output fields and assert the payload tokens equal the input+output sum and exclude cacheRead/cacheWrite.

Files: src/webui.ts, src/webui.test.ts. Keep the #169 live-duration, #142 1s cadence and in-place stats updates untouched.

# Notes
