---
name: "fix: stable task detail cards, no appear/disappear/reappear flicker"
priority: "critical"
state: "done"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "stable-detail-cards"
blockedBy: ""
---

# Summary
Keep run, subagent and doctor cards mounted: no unmount on open, no innerHTML nukes on agent-row changes, no per-second sub-card rebuilds, no alive flips from stale pids. Frontend log memory lives only while the task detail card is open.

# Specs
Problem (facts, pinned by the PM probe on 2026-10-16, five flicker paths):
1. openTask (src/webui/page.ts:557) renders from the light row first: renderAgent with runs=[] clears el.innerHTML (page.ts:816) and renderDoctor removes all cards, so every run/sub/doctor card unmounts on open and remounts when the detail lands; pollDetail (page.ts:1099) can fire first, bump detailGen and discard openTask's response, extending the cleared window.
2. Any agentRowSig change (src/webui/board.ts:81) rewrites #m-agent-btns via innerHTML, destroying the doctor cards slotted inside .agent-col; syncDoctorCards' parentElement check (board.ts:152-158) then fails and recreates all doctor cards.
3. fetchSubs (page.ts:896) re-fetches sub=list every 1 s for the live run; its html gate includes tokens/duration, so a growing transcript rebuilds the sub cards every second.
4. Doctor alive keys on <slug>.<role>.<n>.analysis pid files (payload.ts:157); stale analysis pids and pid recycling flip alive, changing the sig and rebuilding the cards.
5. Loaded log content accumulates in frontend memory across opens.

Decisions (user, 2026-10-16): cards must stay mounted, no appear/disappear/reappear cycles. The frontend holds log content in memory only for the opened agent cards of a task while the task detail card is open; discard it when the card closes.

Requirements:
1. openTask renders without unmounting cards: cards mount once when the detail arrives and stay mounted across open, close, 5 s polls and detail refreshes; pollDetail never discards a fresher openTask response.
2. renderAgent and syncDoctorCards preserve existing doctor cards across agent-row sig changes (no innerHTML nuke of the slotted cards).
3. Sub cards do not rebuild every second on a live run: the html gate excludes stable parts or diffing keeps mounted cards; tokens and duration update in place.
4. Doctor alive does not flip on stale or recycled analysis pid files (verify the pid is alive, or drop the alive key from the sig so it cannot trigger rebuilds).
5. Loaded log content lives in frontend memory only for the opened agent cards of the currently open task detail; closing the card discards it.
6. State the big assumptions affecting the feature.

Assumptions (confirmed by the user, 2026-10-16):
- On close, run, sub and doctor cards stay mounted with labels and stats; only the heavy log text is discarded and reloads on the next open.
- A switch to a different task clears the agent row once immediately, so stale content never shows through the loading state.
- No strict freshness ordering between a just-opened fetch and a same-URL poll response: the later-arriving one writes and the next poll cycle corrects the stats.

Acceptance:
- node tests/webui.test.ts passes.
- Live test (feel-based): run, subagent and doctor cards stay mounted across open, close, 5 s polls and live transcript growth; no reappear flicker; closing the detail card releases its log memory.

# Notes

- Splitter, 2026-10-16: no split. The five flicker paths share one render machine: openTask, renderAgent, renderDoctor and fetchSubs (src/webui/page.ts) with the sig and sync helpers (src/webui/board.ts). Paths 1, 2 and 3 change the same functions. Path 4 touches the machine in both options: agentRowSig (board.ts) or the alive read (src/webui/payload.ts). Path 5 touches closeLog/closeModal in page.ts. Every subtask would append assertions to the shared 2350-line tests/webui.test.ts (the 000242 merge-conflict pattern) and carry its own review, merge and live-test cycle for a partial feel test. The acceptance is one integrated live test. One developer with the full picture is cheaper than three agents that read the same machine again and merge into one test file.
- Current-code facts (the code moved after the PM probe): fetchSubs already html-gates and animates only new subs, but the gate includes sub tokens/duration, so a live sub still rebuilds the cards every second (path 3, half-mitigated). #248 split the open sequence into row render, detail fetch and history fetch, so openTask renders the cards up to three times (path 1). The light board row carries agents for visible cards but never doctors, so renderDoctor(t) on the row removes every doctor card on open. renderAgent and renderDoctor have keep modes (syncAgentStats, syncDoctorCards) that hold cards across a poll when the sig does not change; the innerHTML rebuild path still nukes the slotted doctor cards (path 2).
- 2026-10-16 (Splitter): No split. The five flicker paths share one render contract: renderAgent keep-vs-rebuild, sub-box carry-over, fetchSubs html gate, syncDoctorCards slot checks and the openTask/pollDetail gen discipline interlock across src/webui/page.ts and src/webui/board.ts. Splitting re-litigates that contract across developers (the 000242-style light-row tension, again).
- Every subtask would add assertions to tests/webui.test.ts (one shared 2350-line file; payload/doctorHistory tests live there too). Any split pays a merge-conflict cost in that file.
- The only clean seam is the server-side doctor aliveness (payload.ts:157, src/pid.ts), and it is small: pid.ts already stores <pid> <disc> discriminators and the analysis wrapper self-removes its pid file, so the remaining fix is narrow and shares the same feel-based live test. Split overhead (one more review, merge and live test) exceeds the saved time.
- Keep as one complex task: one developer reads the flow once, makes five targeted edits, one review, one merge, one live test.
- Developer, 2026-10-16: fixed in a582b65. openTask no longer renders the agent/doctor rows from the light row: the row clears once only on a task switch, a same-task reopen keeps the mounted cards, the history render passes keep mode, and the detailGen counter is gone (the modalFile and modal-state checks gate the writes, so a poll cycle never discards a just-opened task's response). fetchSubs gates on the sub index set only; an unchanged set moves the stats lines in place and only a new sub animates. renderAgent lifts the slotted doctor cards out before the innerHTML write and re-slots them after, and the keep tail fetches a run whose sub box carried over nothing. closeModal drops the heavy log text at close; the small cards stay mounted for the reopen. Path 4 needed no code change: with the pidEntry + disc pid.ts the stale/recycled analysis pid read dead consistently (pinned with new stale and recycled pid tests). Proof: one red run (the new gate pin failed first), one green run (node tests/webui.test.ts, all assertions passed), and the live check (run, sub and doctor cards marked in the DOM stayed mounted across open, 1 s pane polls, transcript growth, two 5 s detail cycles, close and reopen; the doctor stats line moved in place across a 5 s poll; the log text was released at close).
- Developer, 2026-10-16: for a task in state done the run card reads alive=false by design (AGENT_ROLE keys the live role off the task state, not the pid file), so the live check sampled the doctor card (alive, duration ticks) for the in-place stats move. The sub card's in-place stats path for a done task only fetches on an empty box or a rebuild, so the live check proved its mount persistence, the suite pins the in-place gate.
- Reviewer, 2026-10-16 (a582b65): all six requirements verified, no fixes. Req 1: the diff drops the light-row agent render (renderAgent({})/renderDoctor({}) on a switch only, keepCards same-task reopen, history render keep mode) and detailGen is gone, writes gate on modalFile plus the hidden/closing state; the switch path nets to a cleared row because renderDoctor({}) removes all cards and resets #m-doctor.__cards. Req 2: the lift/re-slot verified against doctorCol (board.ts:118) and syncDoctorCards' parentElement check, which holds on re-slotted cards. Req 3: the gate keys on the sub index set; syncStatsLine(card, tokens, duration, doc) (board.ts:87) matches the new call, tokens/duration move in place. Req 4: no code change needed — agentAlive (pid.ts:94) reads pidEntry and pidAlive(pid, disc), the discriminator decides, so stale and recycled analysis pids read dead; two new payload tests pin both. Req 5: #m-log-text is the only transcript holder, closeLog already clears the log state, the close wipe drops the DOM text. Req 6: the three assumptions were voiced (they restated requirements 1/5 and the code's freshness behavior, so the Open questions section is now deleted). Tests: node tests/webui.test.ts exit=0, all assertions passed.

## Live test (2026-10-17)

- Setup: hub-only run from the merged worktree (a582b65), port 4351, isolated HOME, fixture `/tmp/lt251/repo/.kanban`: a live `doing` task (sleep pid, one run log, one subagent transcript, one doctor log) and a done task. 35 checks, 0 failed, 0 page errors. The served merged page holds 0 `detailGen` occurrences. The parent commit (b02daed) page holds 8.
- Cards mount once and stay mounted (acceptance line 1): the tagged run, sub and doctor card nodes kept their identity across the open, the first live poll (5.6 s), two more 1 s polls, two 5 s poll cycles on the done task, close and reopen. A node-identity remount detector showed 0 remounts in the whole session. Control: the parent commit on the same fixture remounted the run card and both sub cards on open (3 remounts), so the harness detects the removed flicker.
- Live transcript growth (path 3): an appended `turn_end` moved the run card and the mounted sub card stats lines in place, with the same nodes. The per-second sub list fetch did not rebuild the unchanged sub set. A new sub index then mounted with one entrance animation, and the new set stayed mounted across two more live polls with no per-second rebuild.
- Doctor alive (path 4): a recycled analysis pid (a live sleep pid with the wrong discriminator) and a stale pid (999999999) both left the doctor card dead (no `.spin`, check mark present), with the same node and 0 remounts. `/api/task-history` reported `doctors[0].alive = false` for the recycled file, the stale file and a missing file.
- Log memory (requirement 5): after the run log rendered in the pane (`LIVE251MARKER`), the close emptied `#m-log-text`, hid the pane and kept the cards mounted. A same-task reopen kept the same card nodes, and the log re-fetched from the server and rendered the marker again.
- Late response guard: with `/api/task-history` delayed 1.5 s, an open followed by a close 300 ms later left `#m-agent-btns` empty and the modal closed, so the late response rendered nothing.
- Skipped: the exact poll-versus-open generation race was not forced. The checked observable is the late-response guard plus the mount-once open render. The structural half (the counter is gone) comes from the served-page grep.
- Assumptions: (a) the fixture is a hub-only board with a live `doing` task for the 1 s cadence and a done task for the 5 s cadence. (b) The log memory observable is `#m-log-text` plus the pane state, because the in-page `logState` is not reachable from the test. (c) A new sub index may rebuild its box (requirement 3 excludes stable parts only), so one rebuild of the existing sub card is expected.
- Technical difficulties: the first harness run had 4 script defects (a spread Playwright `waitForFunction` argument, a class-list identity key that read the `agent-card-active` toggle at close as a remount, and a descendant selector). The fixture was rebuilt before the clean second run. No product issue found.

# Open questions

