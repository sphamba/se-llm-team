---
name: "fix: live agent elapsed time ticks every second between log records"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "live-duration-ticks"
---

# Summary
In the task details UI the open card polls at 1s while its task has a live agent (refreshMs, src/webui.ts:860), but the shown tokens and duration re-parse only when the log file grew (statsCache memoized by size): during a quiet stretch (a long tool run writing no JSONL records) the elapsed time freezes although the agent runs. For a live run, duration must advance every second.

# Specs
Found as the residual gap after #142 (which delivered the 1s cadence and in-place stats updates).

## Problem
logStats computes duration as the last record timestamp minus the first, memoized by file size in statsCache. An agent mid-tool-call can write no JSONL records for minutes, so between records the card's duration is frozen while wall-clock time passes.

## Change
- In agentHistory (src/webui.ts:131, runs server-side per /api/tasks request), for the entry whose status is "live", compute duration as now - first record timestamp (Date.now() at payload build) when the parsed first timestamp exists, otherwise keep the parsed duration. Keep the parsed value for non-live entries (status ok/dead: last - first stays authoritative).
- Tokens stay record-driven: they exist only in turn_end/assistant usage records, so they advance as soon as the log grows with a new usage record (nothing fresher exists in the log).
- The 1s cadence, in-place .agent-stats updates keeping the .spin node (000142) and the 5s board cadence with no live agent stay unchanged.

## Tests
- src/webui.test.ts: assert a live run's payload duration grows with now (fake log with an old first timestamp, alive entry: duration >= now - first), and a finished run keeps last - first.

# Notes

# Open questions
