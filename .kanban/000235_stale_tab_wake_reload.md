---
name: "feat: stale-tab wake forces a board reload"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "stale-tab-wake-reload"
---

# Summary
When the webui tab slept (browser timer throttling), the next refresh waits up to a full cadence after the user returns. Add a staleness check: on tab wake, if now minus last reload exceeds twice the last scheduled cadence, force a refresh cycle immediately.

# Specs
# Problem
A webui tab that slept (browser timer throttling in a background tab) shows stale data when the user returns; the next refresh lands 5-8 s later instead of immediately.

# Root cause
The poll loop (the refresh() chain in the PAGE script, src/webui/page.ts:845-880) schedules setTimeout(refresh, refreshMs(open)) after each cycle with no staleness check. A throttled or sleeping tab delays the timer, so on wake the user waits up to a full cadence.

# Fix
Track the last reload time and force a cycle on wake:
- Stamp lastReload = Date.now() where the "updated" line is stamped, under the same condition (only when a served board lands; during a hub outage the old stamp stays).
- Keep the delay the chain schedules as lastDelay (the refreshMs(open) value).
- Add a visibilitychange listener: when the tab becomes visible and Date.now() - lastReload > 2 * lastDelay, cancel the pending timer and start a fresh refresh() cycle immediately.
The threshold is twice the last scheduled cadence: a live 1 s cadence forces on a gap over 2 s, the 5 s board cadence on a gap over 10 s.

# Constraints
- tests/webui.test.ts:754 pins setTimeout(refresh, refreshMs(open)) and :755 pins .catch(() => setTimeout(refresh, 5000)): both expressions stay in the page source, so the poll chain and the failed-cycle retry cadence are unchanged.
- The wake check must not double-cycle: cancel the pending timer before forcing the cycle.
- refreshMs stays a pure helper (it is unit-tested); no server or API changes, the change is client-only in the PAGE script.

# Acceptance
- Live check: load the board, leave the tab (or let it throttle), return after more than twice the cadence, and the "updated" line advances within about a second of the wake with no full-interval wait.
- The tests the developer ships (per the role test policy) pass, including the :754 and :755 poll-chain pins.

# Notes
- Implemented the wake check in the PAGE script (src/webui/page.ts): `pollTimer` / `lastReload` / `lastDelay` state, the reload stamp set with the "updated" line only for a served board, the tick cadence kept in `lastDelay` and its handle in `pollTimer`, and a `visibilitychange` listener that clears the pending tick and calls `refresh()` when a visible tab is past `2 * lastDelay` since the last served board.
- Both pinned expressions stay in the page source: `setTimeout(refresh, refreshMs(open))` (now returned to the chain) and `.catch(() => setTimeout(refresh, 5000))` (now followed by `.then(t => { pollTimer = t; })`, so the retry tick is cancellable too).
- Test first: the new asserts in tests/webui.test.ts failed before the source edit (first failure: "the client tracks the pending poll timer"), and the whole webui suite passed after it ("webui.test.ts: all assertions passed").
- Live check (Playwright against a temp hub on 127.0.0.1:4321, isolated HOME and XDG_CONFIG_HOME): with `lastReload` aged past twice the 5 s cadence, the forced refresh fired 25 ms after the simulated wake and exactly one /api/tasks request followed in the next second, so the pending tick was cancelled; a fresh wake forced no cycle.
- `lastReload` starts at script load time, so a wake before the first board lands does not add a second initial cycle.
- Review: the diff matches the Fix section on every point (stamp inside the served-board condition, `lastDelay = refreshMs(open)`, wake listener forcing on a gap strictly over `2 * lastDelay`, `clearTimeout(pollTimer)` before the forced cycle, the handle captured on both the success and retry paths). Both pinned expressions and the :754/:755 assertions are unchanged. Diff touches only src/webui/page.ts and tests/webui.test.ts; ran tests/webui.test.ts once (exit=0, "webui.test.ts: all assertions passed"). No fixes; no open questions.
- Rebase: the stopped rebase carried no conflict markers; the resolved changes were already staged and matched the Fix section, but the replayed pick was uncommitted because a prior continue could not sign the commit (commit.gpgsign=true while ~/.gnupg is read-only, so gpg cannot reach the agent) and git rescheduled the pick onto the todo. Committed the staged changes as 89f2c76 with the original message, author identity and date plus --no-gpg-sign (the base HEAD 889b0d3 is unsigned for the same reason), then continued; the rescheduled pick d392275 dropped as "patch contents already upstream" and the rebase finished on 889b0d3.
- Full suite after the rebase: npm test exit 0 (kanban, orchestrator, webui, extension, efficiency-analysis, index, mcp, plugin all passed).

## Live test (000235, 2026-10-16T06:37Z)
- Setup: hub-only fixture /tmp/lt235/repo (task `000001_fixture_live.md`, state doing, one live developer run with a live pid and a 300-token log). Two hubs serve the same board: the new code 89f2c76 on 127.0.0.1:4351 and the pre-fix control 889b0d3 on 4352, each with an isolated HOME and XDG_CONFIG_HOME. Playwright 1.58.2, headless Chromium.
- Assumption (environment): headless Chromium on this machine does not flip `document.visibilityState`. `Page.setWebLifecycleState` frozen/active and `page.bringToFront()` leave it "visible", and `Emulation.setPageVisibilityOverride` is unsupported. The sleeping tab is simulated with two real mechanisms: the page `Date.now` jumps forward by the gap while the pending poll timer stays real and pending, then a `visibilitychange` event is dispatched with the document visible. The production listener and its guard run unchanged.
- 5 s board cadence, wake gap 11 s: the forced cycle fires 11 ms after the wake, the `updated` line advances, the stale pending tick is cancelled (exactly 1 `/api/tasks` request in the first 4.9 s), and the chain continues at the cadence (next request at +5026 ms).
- 1 s cadence (modal open on the live task, measured request gaps 1015 and 1014 ms), wake gap 3 s: the forced cycle fires 11 ms after the wake, exactly one cycle runs, and the `updated` line advances.
- Threshold: a fresh wake with a gap of 1.5 s (below 2 x 5 s) forces no cycle, the `updated` line stays, and the natural tick still lands at +5014 ms.
- Hub outage: the forced cycle still attempts a fetch, and the `updated` line keeps the old stamp (mutation count unchanged).
- Differential control (pre-fix 889b0d3, same fixture and wake event): no request within 1.2 s of the wake, and the delayed tick lands 4621 ms after the wake. This confirms that the immediate refresh comes from the wake check.
- Result: 17 new-code checks and 5 control checks, 0 failures, no page errors. The first run had 2 false FAILs from the check script (windows evaluated before their end time), fixed in the script. The acceptance bullet that names the shipped test suite is not part of this live run, because the role policy keeps unit suites out of live tests. No findings, no open questions.
