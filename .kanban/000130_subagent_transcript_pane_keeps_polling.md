---
name: "fix: subagent transcript panes keep updating; refresh sub lists while the parent run is alive"
priority: "low"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "subagent-transcript-pane-keeps-polling"
blockedBy: "#118"
---

# Summary
In the webui detail card, a subagent transcript pane freezes after the first empty poll because pollLog treats every sub view as non-live, and a subagent spawned after the run was opened never gets a button because fetchSubs runs only on open. Keep the pane polling and refresh the sub list while the parent run is alive; keep today's stop-early behaviour for finished runs.

# Specs
Found during the live test of #118 (passed); pre-existing, but #118 makes it reachable because subagent transcripts are readable at last.

## Root cause (one, two symptoms)
`pollLog` in src/webui.ts computes:
`const live = logState.sub == null && !!liveRun && liveRun.handle === logState.handle;`
so every sub view (`logState.sub != null`) is non-live, and the next branch
`if (!live && logState.idle) { clearInterval(logTimer); logTimer = null; return; }`
stops the timer on the first poll that returns no new text ("past agents write no lines: one empty poll is proof"). For a subagent that is still running that proof is false.

## Symptom 1 — running subagent transcript freezes
Open a subagent transcript while the subagent is still writing: the pane stops updating after the first empty poll; the user must re-open the run (run button, then sub button) to see the rest.
Measured on the real UI: after opening a truncated transcript pane (43159 rendered characters) the client made exactly two /api/agent-log?sub=1 calls (init plus one empty poll) and then no call at all during the next 6 s while the test appended the rest of the transcript, so the pane stayed stale (the record's marker was absent). Re-opening showed the completed record exactly once.

## Symptom 2 — subagent spawned after the run was opened has no button
`fetchSubs` is called only when a run is opened, so a subagent spawned after the user opened the live run never appears in the sub button list until the run is re-opened.

## Need
- While a subagent transcript is still growing, the open sub pane keeps polling and new lines appear without re-opening.
- While the parent run is alive, the sub list refreshes (already-fetched runs' completed sub lists need not be re-polled on every tick — refreshing the live/parent run's list is enough to surface a newly spawned sub).
- A finished run keeps today's behaviour: one empty poll on a past agent's log stops the timer (no needless polling of logs nobody writes).
- Something must leave the pane live only while there is a reason to: the suggested scope is "parent run alive OR sub transcript still growing".

## Constraints
- Client-side change in src/webui.ts only. No server/API change, no orchestrator change.
- Do not change #118's rendering work and do not regress #121's in-place modal refresh (it must not touch #m-log / logState / pollLog).
- Keep the busy guard, the superseded-open generation checks, the scroll-to-top history retry and the stop-early path for finished runs intact.
- A running subagent is identified the same way the server already does for subagent lists; no new endpoint.

## Acceptance criteria
- `node src/webui.test.ts` passes, with a test covering that a sub transcript view with a still-alive parent run keeps its poll timer after an empty poll, while a past run's log still stops after the first empty poll.
- `node src/kanban.test.ts` passes.
- Live browser check on the real UI: open the detail card of a task with a running agent, open a subagent transcript while the subagent is still writing, and confirm appended lines appear in the open pane without re-opening it; and confirm a subagent spawned after the run was opened gets its button without re-opening the run.
- Live browser check that a finished run's log pane still stops polling after the first empty poll (no timer churn on past agents).

# Notes
