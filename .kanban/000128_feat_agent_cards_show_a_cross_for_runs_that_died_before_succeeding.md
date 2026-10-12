---
name: "feat: agent cards show a cross for runs that died before succeeding"
priority: "medium"
state: "done"
worktree: ""
complexity: "complex"
blockedBy: ""
---

# Summary
All finished agent cards in the task detail show a checkmark, whether the run succeeded or died before succeeding. The orchestrator already distinguishes the two (a run that advanced the state itself vs a bounced/killed run); record a per-run death marker and have the webui show a cross with red text for dead runs.

# Specs
# Server: per-run death marker (src/orchestrator.ts, src/orchestrator.test.ts)

bounceDead (src/orchestrator.ts ~:1160) fires for both death kinds (dead pid, stalled log) and knows the task, the state-mapped role, and the dying pid. The dying run is the newest existing run log for that role (the run index known at spawn = nextRunIndex - 1).

- In bounceDead, compute the newest `.kanban/.logs/<slug>.<role>.<n>.log` for the role at bounce time and write a sibling marker `<slug>.<role>.<n>.dead` (one line: the bounced state or the pid). Skip when no run log exists for the role.
- The marker is per-run, so a fresh respawn (new index) is unaffected; markers never touch the counter files, the armed marker, or the gzip sweep's live-pid check.
- Markers may linger after the task moves on - harmless, no janitor required.
- src/orchestrator.test.ts: a bounced fake agent produces the `<n>.dead` marker for the right run index; a run that advances the state itself produces no marker.

# Webui: cross icon and red text (src/webui.ts, src/webui.test.ts)

- agentHistory (src/webui.ts ~:102-126) checks for the sibling `.dead` marker per run entry and serves a status field: "live" when alive, "dead" when the marker exists, "ok" otherwise (no marker means the run advanced the state itself, the same signal consumeReviewerRun uses).
- agentCardHtml / renderAgent: a dead run's card shows a cross mark (e.g. ✗) instead of the check and red text (a muted red that reads in both themes, e.g. color-mix or an existing var). Live keeps the spin, ok keeps the check.
- Subagent cards keep the check - a sub has no pid file or bounce machinery, so no death signal exists for subs (deliberate non-goal).
- src/webui.test.ts: payload status for a fixture with and without the marker, and the card markup showing the cross/red for dead.

# Complexity

complex (user-ordered complexity assignment; multi-file, two subsystems). Files: src/orchestrator.ts, src/orchestrator.test.ts, src/webui.ts, src/webui.test.ts.

# Notes

- bounceDead (src/orchestrator.ts) now writes a per-run death marker `<slug>.<role>.<n>.dead` (one line: the dying pid) after the state-match check passes, so a run that advanced the state itself (the early return) leaves no marker. The marker names the dying run's index (nextRunIndex - 1 of the state-mapped role) and skips when no run log exists for the role. Marker files never match the counter/armed names or the gzip sweep's role-log pattern, so the sweep, nextRunIndex and the webui run index all ignore them.
- agentHistory (src/webui.ts) serves a `status` field per run entry: "live" (newest run of the live role), "dead" (sibling .dead marker exists), "ok" otherwise; `alive` is unchanged and the dead card carries the `agent-dead` class.
- renderAgent: a dead run's card shows `<span class="cross">✗</span>` instead of the check and red text via `.agent-dead { color: var(--critical-fg); }` plus `.cross { color: var(--critical-fg); margin-right: 5px; }` (the existing priority-critical muted red, readable in both themes). Live keeps the spin, ok keeps the check, sub cards are untouched (no death signal for subs).
- Tests: orchestrator.test.ts part B asserts each bounced developer run (0..5) carries its marker with a numeric pid line, and part A asserts a full self-advancing pipeline leaves no .dead files. webui.test.ts asserts the payload status triple (legacy ok / marked run dead / newest live), and the served page carries the cross span, the dead-class ternary and both CSS rules. Existing agents deepEqual fixtures updated with the status field; the marker fixture files are removed after their assertion so later fixtures stay untouched.
- All four test files pass (webui, orchestrator, kanban, index); no tsc in this project, node runs the .ts sources directly.
- Commit: 8992a12 in feat/128-agent-cards-show.
- Review (8992a12): verified against the specs, no fixes. Marker write sits after the state-match early return, so a run that advanced the state itself (or a task the user moved on) leaves no marker; role comes from WORKING_STATES, index from nextRunIndex - 1, and the run log always exists for a spawned run (the daemon opens the fd at spawn), so the n >= 0 skip covers only the no-log case. Marker files match none of the three `.log`-keyed patterns (nextRunIndex, the compactor, indexRuns) and `.kanban/` is gitignored. A stalled-log bounce (`kill=true`) marks the still-alive pid too, per spec. For a merging task the marker names this task's own newest merger log; the shared project-wide merger pid can only mark a sibling task's completed run in the rare two-tasks-in-merging bounce, harmless by the lingering-markers rule. In agentHistory, `alive` outranks a marker (a marker can never name the newest live run: respawn always takes a new index), legacy unsuffixed entries can never match an indexed marker and always read ok. renderAgent's dead-class ternary survives markActiveAgent (it only toggles agent-card-active); var(--critical-fg) is defined in both themes. All five checks pass (orchestrator, webui, kanban, extension, index).
- Live test (8992a12, no code edits): ran the real daemon from this worktree against two scratch projects (/tmp/lt128, /tmp/lt128b) with stub agents, in an isolated HOME so each scratch daemon served its own hub UI (ports 4399, 4398), then drove the real webui in headless Chromium. No unit suite was run.

| User-flow check | Result |
| --- | --- |
| A dead-pid bounce writes `<slug>.<role>.<n>.dead` with the dying pid | pass: developer.0 = 2430728, and five reviewer runs 0..4 each got one marker naming its own pid |
| A stalled-log bounce (SIGTERM, kill=true) marks the killed run | pass: developer.0 = 2435947 and developer.1 = 2436040, both killed and marked |
| A run that advanced the state itself shows the check and leaves no marker | pass: developer.1 card = agent-past + green check |
| A live run keeps the spinner | pass: reviewer.0 while alive = agent-live + spin animation |
| A dead card shows the cross and red text, light theme | pass: agent-dead class, cross glyph, card and mark rgb(230, 80, 80) |
| A dead card shows the cross and red text, dark theme | pass: rgb(217, 87, 87); ok and live cards unchanged |
| Per-run markers survive a respawn (new index, old marker intact) | pass: developer.0's marker stayed while reviewer runs 0..4 each got a new one |
| The 5 s detail-card refresh keeps the crosses | pass: 6 dead cards, 6 crosses after a refresh |
| A dead card still opens its log, plain and gzipped | pass: developer.0 (.gz) and reviewer.4 (.gz) logs both opened |
| Console errors during the flows | none |
| Subagent cards keep the check | not live-exercised (stub agents emit no subagent transcripts); the sub path is untouched and covered by webui.test.ts |

- Not exercised live: a marker that lingers after the task reaches done (the scratch task stayed in to-review before the respawn cap), and the two-tasks-in-merging merger case (review-covered).
- Evidence: screenshots in /tmp/lt128-evidence/ (board, modal light and dark, dead-card log).
- Live-test result: no issues found.
