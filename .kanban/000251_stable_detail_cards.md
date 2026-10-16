---
name: "fix: stable task detail cards, no appear/disappear/reappear flicker"
priority: "critical"
state: "doing"
worktree: "fix/251-stable-detail-cards"
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
