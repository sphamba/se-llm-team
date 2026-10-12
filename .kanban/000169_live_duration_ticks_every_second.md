---
name: "fix: live agent elapsed time ticks every second between log records"
priority: "medium"
state: "done"
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

- Implemented in worktree fix/169-live-duration-ticks, commit 2dd1cec.
- src/webui.ts agentHistory: takes Date.now() once per /api/tasks request, and the live entry's duration is now Math.max(0, now - stats.first) when the parsed first timestamp exists, otherwise the parsed value. Non-live entries keep the parsed last - first. The sort still uses the parsed first via start, and tokens stay record-driven.
- Verified agentRowSig keys on role/run/status/handle only, so the client's syncAgentStats keeps updating the stats line in place and the .spin node survives while the now-based duration ticks each 1s poll.
- src/webui.test.ts: the 000120 live-entry fixture now uses relative timestamps (ISO session record and epoch-ms turn_end kept for the ISO/epoch-ms coverage) and asserts duration >= 600000 for the live developer.1 run; a new finished-run fixture (live-tester.1, status ok) asserts duration stays the parsed 5000. All five test suites pass (kanban, orchestrator, webui, extension, index).

# Review notes (000169)

- Reviewed 2dd1cec against the specs: the live-entry duration keys on `alive` (equivalent to status "live", since status derives from it), `now` is one Date.now() per agentHistory call, and agentHistory runs per taskPayload build, so each 1s poll recomputes duration regardless of statsCache memoization. Non-live entries, tokens, the 1s cadence and the client sig/in-place path are untouched.
- Verified agentRowSig keys on role/run/alive-or-status/handle only, so a ticking duration never rebuilds the row and syncAgentStats updates the stats line in place, keeping the .spin node alive.
- The Math.max(0, ...) clamp (future first timestamp from clock skew) is the one addition beyond the literal spec text; sensible, keep.
- Reviewer assumptions accepted as spec-consistent: subagent transcript durations in the log pane (agentLogPayload sub=list) stay last - first (finished or short-lived sidechains, the spec scopes the change to agentHistory); a live run with no parseable first timestamp keeps rendering no duration (spec: "otherwise keep the parsed duration"); now is server-side payload-build time, clamped at 0.
- All five suites pass in the worktree (kanban, orchestrator, webui, extension, index).

# Merge notes (000169)

- Step 1 (worktree fix/169-live-duration-ticks): merged base branch main into the fix branch; clean merge (only README.md from the base side, commit d34052c). No conflicts, so per pipeline rules test suites were not re-run; the live test runs on this merged commit.
- Step 2 (project root): base branch resolved again as main; merged fix/169-live-duration-ticks into main as a fast-forward (b823888..d34052c, src/webui.ts + src/webui.test.ts). Root is clean, nothing to resolve.

# Open questions
