---
name: "feat: stale-tab wake forces a board reload"
priority: "medium"
state: "backlog"
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
