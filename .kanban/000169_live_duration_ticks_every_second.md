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

# Live test report (000169)

Environment: merged commit d34052c in the project root. Isolated fixture (scratch clone, /tmp): one task in state doing with a live sleep pid, a developer.0 log whose first record was 20 s old and whose last record was 10 s old (quiet stretch, no writes), and a finished reviewer.0 log with a parsed duration of 20 s. The webui ran from the real checkout through the hub on 127.0.0.1:4321 with an isolated HOME. A real Chromium browser opened the task card. No unit suite was run.

Results:

- API (/api/tasks): the live entry's duration was now - first (32851 ms against a parsed 10000 ms). Over 3.21 s of wall clock the live duration grew by 3220 ms with no log write. The finished entry stayed at 20000 ms (delta 0).
- Browser, card open, no log growth: the shown live duration advanced each second (2m 34s, 2m 35s, 2m 36s, 2m 37s; later 3m 15s to 3m 19s). The shown value was now - first within the poll lag and the 1 s rounding (about -0.77 s).
- The .spin node and the live card node kept their identity across every poll; the stats line changed in place.
- The finished reviewer run stayed "777 · 20s" in the browser across all polls.
- Tokens stayed record-driven: 12k was constant during the quiet stretch, then became 13k after a new turn_end record with 500 tokens was appended.
- Fallback branch: a live run whose log has no parseable timestamp kept duration null and showed tokens only (42), with no error.

Assumptions:

- The first in-modal poll can come up to 5 s after the card opens, because the timeout was set by the previous 5 s board cycle. This is the unchanged 000142 cadence, so the test skipped that first tick and measured from the second poll on. Not a defect of this change.
- The fixture used a sleeping shell as the live agent, not a real pi process.

Findings: none. No new task is necessary.

# Open questions
