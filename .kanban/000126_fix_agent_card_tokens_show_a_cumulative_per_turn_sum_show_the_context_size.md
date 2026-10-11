---
name: "fix: agent card tokens show a cumulative per-turn sum; show the context size"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The agent cards in the task detail show the sum of totalTokens across every turn of the run (cumulative tokens processed, e.g. 5.8M for a long run), which tracks the log size and reads as a character count. Show the run's LLM context size instead: the last usage-bearing record's totalTokens.

# Specs
# Problem

logStats (src/webui.ts ~:204-229) sums message.usage.totalTokens over EVERY usage-bearing record (turn_end in a run log, assistant in a subagent .output transcript). That is the cumulative tokens processed across the whole run, not the context size: for a long developer run it reaches millions (e.g. tokens 5811885 for a 7.5M-char log) and tracks the log size, so it reads as a character count. User report 2026-10-12: the agent cards "seem to show a number of characters in the log, instead of a number of LLM tokens (context size)".

# Fix

The real token info is available in the log, so the chars/4 fallback is not needed. In logStats, overwrite instead of summing: tokens = rec.message.usage.totalTokens on each hit, so the LAST usage-bearing record wins. The last turn's totalTokens (input + output + cacheRead + cacheWrite + reasoning) is the context the model held at run end; for a live run it is the current context size and still grows turn by turn.

- Applies to both read paths through the same logStats: indexed run logs (turn_end records) and subagent .output transcripts (assistant records).
- Legacy logs without usage keep tokens null and the card shows no token stat, unchanged.
- Update the two comments that say "sums" (the logStats block comment and the line-18 comment) to say the value is the last usage-bearing record's totalTokens, i.e. the context size.

# Tests

src/webui.test.ts: a fixture log with several turn_end records carrying different totalTokens values asserts the reported tokens equal the LAST record's value, not the sum. Files: src/webui.ts and src/webui.test.ts only.

# Notes
