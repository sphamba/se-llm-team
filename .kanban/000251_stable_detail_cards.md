---
name: "fix: stable task detail cards, no appear/disappear/reappear flicker"
priority: "critical"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "stable-detail-cards"
blockedBy: "#248"
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
