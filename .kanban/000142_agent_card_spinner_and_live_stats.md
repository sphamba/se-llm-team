---
name: "fix: agent card spinner survives the poll; time and tokens update at log cadence"
priority: "medium"
state: "doing"
worktree: "fix/142-agent-card-spinner-and-live-stats"
blockedBy: ""
issuer: "user"
complexity: "moderate"
shortName: "agent-card-spinner-and-live-stats"
---

# Summary
In the task detail card the running agent's spinner animation survives the page poll instead of restarting, and the card's time and tokens update as frequently as the logs while the agent is running, even when the log pane is closed.

# Specs
Root cause (verified from code and a live browser probe): agent cards are built by renderAgent (src/webui.ts:1310 via agentCardHtml :1300; a live run emits `<button class="agent-card agent-live"><span class="spin"></span>...`, CSS animation spin .9s linear infinite at :942-944). The #121 in-place modal refresh calls updateOpenTask (:1457-1460) = writeHead + renderAgent(t, true) + setBody; the body is html-gated (el.__html compare at :1206-1211) but renderAgent has NO gate: `el.innerHTML = runs.map(...)` (:1320-1323) rebuilds the whole row every 5s even when nothing changed, so the .spin node is replaced and the animation restarts every 5s (the board card spinner survives because syncBoard keeps unchanged nodes). Tokens/duration are fresh per /api/tasks (taskPayload :493-511 -> agentHistory :123-165 -> logStats :224-258, statsCache memoized by size so a growing live log re-parses) but only at the 5s refresh cadence; pollLog's 1s timer is set in openLog (:1373) and cleared in closeLog (:1378-1379), so with logs closed there is no 1s carrier at all.

Fix, src/webui.ts plus src/webui.test.ts only:
- Stop rebuilding unchanged agent rows: split stats from structure in renderAgent. When the modal row exists and the run set (role, run, alive, status, handle, sub-card presence) is unchanged, update each card's .agent-stats text (tokens · duration) in place instead of rebuilding, so the .spin animation keeps running; rebuild the row only when the structure changed. Keep the current markup, classes, fmtTokens/fmtDur output and the #120/#121/#130 behavior (sub boxes carried by handle .agent-subs).replaceWith(box), agentGen superseded checks) intact.
- Log-cadence updates: while the modal is open and the fresh task has a live agent (the same activeBoard().tasks.find lookup updateOpenTask already uses), the refresh cadence runs at 1s instead of 5s; when no agent is live it falls back to the current 5s. This covers "even if the logs are closed" because the refresh runs regardless of the log pane, and pollLog/closeLog/#130 sub-list behavior stays untouched.
- No orchestrator changes, no new endpoint (the whole-board /api/tasks payload already carries the fresh per-request agentHistory; the board render keeps unchanged card nodes so its spinners are unaffected by the faster cadence).
- Tokens/duration only advance on timestamped/turn_end records, so a quiet log freezes them at the current values; that is accepted and unchanged.

Tests (extend the flat assertion script in src/webui.test.ts):
- An in-place stats update on a live agent card keeps the same .spin node (identity check, the pattern of the board refresh identity test at :387-410) and only the .agent-stats text changes.
- A structure change (run added, live -> dead) still rebuilds the card.
- The refresh interval is 1s while the open task has a live agent and 5s otherwise (assert the timing logic as far as the flat script allows, e.g. the exported helper if one is factored).
- The #121, #130 and #120 blocks stay green.
