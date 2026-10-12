---
name: "fix: subagent transcript panes keep updating; refresh sub lists while the parent run is alive"
priority: "low"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "subagent-transcript-pane-keeps-polling"
blockedBy: ""
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

Implemented in worktree fix/130-subagent-transcript-pane-keeps-polling, commit ed64d1f.

- pollLog (src/webui.ts): the live check dropped its `logState.sub == null` condition and is now `!!liveRun && liveRun.handle === logState.handle`. logState.handle is the parent run's handle for a sub view too (the sub button carries the parent's data-handle), so run aliveness keeps both the run's own log and its sub transcripts polling while the run is alive. The stop-early path for past runs (`!live && idle` after the first empty poll) is unchanged, and the busy guard, superseded-open generation checks and scroll-to-top history retry are untouched.
- renderAgent keep branch (src/webui.ts): the 5 s refresh now re-fetches only the live run's sub list (the live run is the last column), passing the unchanged agentGen so the superseded-open check still guards the write. A sub spawned after the card was opened therefore gets its button without re-opening the run; past runs' sub lists are never re-fetched. The keep branch still never touches #m-log, logState or the log timer (#121 intact), and #118's rendering is untouched.
- src/webui.test.ts: static assertions pin the new live computation (sub view of a still-alive parent keeps its poll timer after an empty poll), the preserved `!live && idle` stop for past runs, and the keep refresh re-fetching only the live run's sub list with the generation unchanged.
- `node src/webui.test.ts` and `node src/kanban.test.ts` pass. orchestrator.test.ts and extension.test.ts were not run here: they spawn real daemons/agents and hang in this sandbox, and neither imports webui, so this change cannot affect them.
- The live browser checks from the acceptance criteria (running subagent transcript keeps appending in the open pane; sub spawned after open gets its button; finished run's pane still stops after the first empty poll) are left for the live-testing phase.

Review (passed, no fixes): re-checked the full pollLog and renderAgent flow in commit ed64d1f against the Specs.

- Verified the sub button carries the parent run's data-handle (fetchSubs renders `data-handle=<parent> data-sub=<n>`), so logState.handle is the parent's handle for a sub view and `liveRun.handle === logState.handle` holds there. When the parent run dies, liveRun becomes undefined and the next empty poll (idle=true) stops the timer, so a finished run keeps today's stop-early behaviour.
- Verified `.agent-col:last-child > .agent-subs` resolves to the live run's sub list: #m-agent-btns only ever contains .agent-col divs, and renderAgent splices the live run to the end of runs before rendering. The query also runs after the carried-over boxes replace the fresh containers, so fetchSubs writes into the actual DOM node.
- Verified the sub-list endpoint payload is id/index/stats only, with no per-sub aliveness flag, so the client cannot know when an individual sub finished. Polling a sub view until the parent run dies is therefore the only option within the no-new-endpoint constraint, and it matches the suggested scope (parent run alive OR sub transcript still growing). A finished sub of a still-alive run keeps polling until the parent finishes; negligible, within scope.
- One self-healing nuance, no fix needed: an older keep-refresh fetchSubs response can land after a newer one and briefly hide a sub spawned between the two ticks; both writes carry the same agentGen, the last write wins, and the next 5 s tick re-renders the current list.
- `node src/webui.test.ts` and `node src/kanban.test.ts` re-run in the worktree, both pass.

Live test (passed, no issues found). Worktree fix/130-subagent-transcript-pane-keeps-polling at ed64d1f. Headless Chromium through Playwright.

Method: served the worktree's real src/webui.ts (PAGE + taskPayload + agentLogPayload) over HTTP for the real board root, and served the pre-fix main-checkout src/webui.ts on a second port as a control. Each check opened both versions side by side on the same run and the same transcript. One extra check used a controlled fixture board (a past run and a live run in one task) because the real board has no task with both. Evidence is under /tmp/lt130.

- Running sub transcript keeps updating (symptom 1 fixed). A live sub transcript (a real background-agent .output under /tmp/pi-subagents-1000) kept growing while the pane was open. Worktree pane: 43 /api/agent-log?sub=N requests in 42 s (init plus one per second), rendered text grew from 242 to 331 characters, and lines appended after the pane opened appeared without a re-open. Control pane: exactly 2 requests (init plus one empty poll), then no request at all, and the text stayed at 242 characters. Screenshots /tmp/lt130/p1-fixed.png (later lines visible) and /tmp/lt130/p1-main-control.png (frozen on the first tool call).
- Sub spawned after the run was opened gets its button (symptom 2 fixed). With the live run's detail card open, a new background Agent spawned. Worktree card: the new Sub-live-tester button appeared at +24.5 s (the spawn was about 22 s in, so within one 5 s refresh) with no re-open, and a click opened the new transcript. Control card: still 2 buttons after 45 s.
- Finished run keeps stop-early. Past run's own log pane: 2 requests (init plus one empty poll) in 8 s. Past run's sub pane: 2 requests in 8 s. In the fixture card with a live run present: past sub pane 2 requests in 12 s with the content intact, 0 past-run sub=list re-fetches, and the live run's list re-fetched twice in 12 s (the refresh targets only the live run). The control gives the same past-run numbers.
- Live run's own log pane unchanged: init plus one request per second (7 requests in 6 s).
- #121 non-regression. With a finished sub pane open, 12 s (2 or more board refreshes) gave 0 extra log requests, the same text and scroll position, and the pane stayed visible.
- No console or page errors in any phase. A sub=list request on the 4 MB live log answered in about 70 ms including the curl start.
- No finding needs a new task.

Merge (done). Base branch at both steps: main (root checkout clean).

- Step 1: merged main into fix/130-subagent-transcript-pane-keeps-polling in the worktree. Already up to date: main was already an ancestor of the branch, no merge commit, no conflicts. Per procedure, test suites were skipped because the merge was clean.
- Step 2: merged fix/130-subagent-transcript-pane-keeps-polling into main in the project root. Fast-forward dd25b25..ed64d1f (src/webui.ts, src/webui.test.ts; 22 insertions, 5 deletions). No conflicts.
- Task state set to done.

# Open questions
