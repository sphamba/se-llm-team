---
name: "fix: agent card spinner survives the poll; time and tokens update at log cadence"
priority: "medium"
state: "done"
worktree: ""
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

# Notes
Done in worktree fix/142-agent-card-spinner-and-live-stats, commit e9a2d11 (src/webui.ts, src/webui.test.ts only).

- In-place stats sync: new exported helpers agentRowSig (the run set's structure: role/run/alive/status/handle per run), syncAgentStats (an unchanged row updates each card's .agent-stats text in place, span created when stats arrive and dropped when they vanish, matching agentCardHtml's markup) and agentStatsText (the tokens · duration string, now shared by agentCardHtml and the in-place pass). renderAgent (keep=true) calls syncAgentStats first and returns, so the .spin node is never replaced and the animation survives the poll; a structure change rebuilds, seeds el.__sig = agentRowSig(runs) and keeps the #120/#121/#130 behavior (sub boxes carried by handle .agent-subs).replaceWith(box), the live run's sub list re-fetched, agentGen superseded checks, markActiveAgent) intact. An empty run set clears the signature. Sub-card presence is not in the signature on purpose: sub cards change through fetchSubs independently and carry no spinner, so they must not force a rebuild.
- Log cadence: refresh() now chains on setTimeout instead of the fixed setInterval(refresh, 5000). The next tick keys on the fresh open card (the same activeBoard().tasks.find lookup) through refreshMs: 1000 while it shows a live agent, 5000 otherwise, log pane open or closed; a failed cycle retries at 5000. pollLog/closeLog/#130 untouched.
- Tests: the new 000142 block covers the identity check (same .spin node, only .agent-stats text moves, markup not rewritten), structure changes (run added/gone, live -> dead, missing row), the span join/drop and the refreshMs cadence (1 s live, 5 s otherwise); the setInterval page assertion and the updateOpenTask variable name assertion updated to the new source. All five test files pass, and the interpolated page script parses as JS.
- No open questions.

Review (state reviewing, commit e9a2d11): no defects found, no fixes made. Checked against the Specs:
- syncAgentStats returns before any mutation on a signature or length mismatch, so a rebuild decision never half-updates the row. The card lookup el.children[i].children[0] is right for both the fresh markup and the sub-carried one (the card button stays the first element child). The stats span joins and drops match agentCardHtml; fmtTokens/fmtDur return "" on null, so the empty-stats cases hold.
- The signature collapse alive ? "live" : status is exactly equivalent to carrying both fields: the payload sets status "live" whenever alive is true (webui.ts:152), so no alive/status flip can hide from the signature.
- Sub-card presence left out of the signature is correct, not a spec gap: sub cards change through fetchSubs box.innerHTML without touching the parent card, so putting them in the signature would rebuild (and restart the spinner) on every sub arrival, against the task goal. Documented in the notes above.
- No stale-signature hazard: openTask renders with keep falsy, so every open rebuilds and re-seeds el.__sig; a row from the old page (no __sig) also falls through to rebuild.
- The in-place path skips markActiveAgent by design: an unchanged signature means the same live run and the same open-log card, so the active classes persist; a live-run identity change flips the signature, rebuilds, and markActiveAgent runs on that path.
- Cadence: refresh() chains on setTimeout, so the setInterval double-scheduling is gone and fetches can no longer overlap; refreshMs(null) and missing agents fall back to 5 s; a failed cycle re-arms at 5 s and the next success restores the 1 s cadence. open shadows window.open only locally and the script never calls open().
- Verified the served client script still parses (the suite's new Function assert) and ran all five test files green (npx tsx --test index.test.ts src/*.test.ts). Scope holds: only src/webui.ts and src/webui.test.ts changed; SPECS.md makes no statement the change contradicts.

Live test (state live-testing, commit e9a2d11): PASS, 25/25 checks in a real Chromium against a fixture board that this worktree's webui.ts served.
- Method: the running orchestrator daemon serves the main checkout, whose webui.ts has no fix, and this session must not disturb the pipeline. The test therefore served the worktree module (PAGE, taskPayload, agentLogPayload) over HTTP from a fixture root with /tmp/lt142/test.mjs, then drove the page with Playwright. No unit suite ran, per the role rules.
- Board card spinner: the same .spin node stayed connected across a board poll.
- Open live card with the log pane closed: /api/tasks ticks at ~1 s (3 ticks in 3.2 s); a growing log moved the stats line from "1k · 1.0s" to "2k · 4.0s" within 2.6 s; the .spin node identity and the running CSS animation (spin/running) survived every tick.
- Structure changes: live -> dead rebuilt the row (spinner -> check, the old .spin node was disconnected) and kept the stats; a new run rebuilt into two labeled cards, and the newest run went live.
- #121: a body edit appeared in the open card without a reopen. #130: the Sub-developer card appeared under its run, survived both rebuilds carried by handle, and the log pane streamed new lines at its own 1 s poll.
- No live agent: the open modal fell back to ~5 s (1 tick in 6.5 s) for both a dead run and a task with no runs; the agent row was empty.
- Stats vanish in place: a live log rewritten with no usage or timestamps dropped the .agent-stats span and kept the spinner node.
Observation (minor, not a Specs violation, reported to the PM): the cadence changes only at the end of a poll cycle, so a card opened right after a 5 s tick waits up to ~5 s for the first fast refresh (measured 4983 ms on a fresh page load). The 1 s cadence starts after that first tick.
Accepted ceiling from the Specs: while the modal is open, the /api/tasks rate is 5x higher and each growing live log is re-parsed per request.

Merge (state done, both steps clean, no conflicts, no test suites needed):
- Step 1 (base branch main): git merge main in worktree fix/142-agent-card-spinner-and-live-stats -> Already up to date. Clean, so per the merge rules the test suites were skipped and step 2 carried nothing new.
- Step 2 (base branch main, re-resolved): git merge --no-edit fix/142-agent-card-spinner-and-live-stats in the project root -> fast-forward 03c450b..e9a2d11, src/webui.ts and src/webui.test.ts only. Root checkout was on main at both steps; never detached.
- No open questions.

# Open questions
