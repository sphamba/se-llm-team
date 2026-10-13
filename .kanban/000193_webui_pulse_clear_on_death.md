---
name: "fix: clear the webui live-line pulse when the run dies"
priority: "medium"
state: "reviewing"
worktree: "fix/193-webui-pulse-clear-on-death"
issuer: "#191"
complexity: "simple"
shortName: "webui-pulse-clear-on-death"
---

# Summary
The .pulse shimmer on the first line of the agent log pane is never cleared when the viewed run dies while its log has gone idle: markLiveLine() is only called from pullLog() and closeLog(), and pollLog()'s idle early-return stops the log timer before any sweep, while the board refresh that drops the .spin card never calls markLiveLine() either. The pulse must stop as soon as the board knows the run is no longer alive.

# Specs
# Origin

Found by the live test of #191 (feat: subtle animations and transitions across the webui, branch feat/191-webui-motion, merged commit da35d5b): 37 of 38 checks passed; this was the one finding. Real bug, not a test artifact. In scope for #191, whose Specs say the shimmer `.pulse` class is applied "only when the run is alive".

# Bug

The live-line pulse (`.pulse` on the first line of `#m-log-text`, an infinite `shimmer` animation) is not cleared when the viewed run dies while its agent log has gone quiet/idle. The run card correctly reads `agent-past` with no `.spin`, but the first log line keeps `class="pulse"` and `getAnimations()` reports `shimmer:running` forever — a visible loop on a dead run. Closing and reopening the log clears it, so the class condition itself is right; only the death sweep is missing.

# Root cause pointers (src/webui/page.ts, as of da35d5b)

- `markLiveLine()` (src/webui/page.ts:494) is the only place that toggles `.pulse`. It is called only from `closeLog()` (src/webui/page.ts:632) and at the end of `pullLog()` (src/webui/page.ts:690).
- `pollLog()` sets `logState.idle` when a poll returns empty text. Once the run is no longer alive, the early return `if (!live && logState.idle) { clearInterval(logTimer); return; }` (src/webui/page.ts:642-646) stops the log timer and returns before any `pullLog()` / `markLiveLine()` call.
- `refresh()` (src/webui/page.ts:707) -> `updateOpenTask(open)` (src/webui/page.ts:731, defined at :458) rebuilds the run cards via `renderAgent(t, true)`; when the run set changes, the card loses its `.spin` node, but nothing on this path calls `markLiveLine()`.

# Exact repro (hub-only fixture, real record shapes)

1. Open a live run's agent log in the task detail card.
2. Wait ~3 s so the 1 s polls return empty and `logState.idle` is set.
3. SIGKILL the pid named in `.kanban/.pids/<slug>.pid`.
4. Wait 6 s.
Observed: the run card reads `agent-past` with no `.spin`, yet `#m-log-text > *:first-child` still has `class="pulse"` and `firstLine.getAnimations()` returns `shimmer:running`.

# Required behavior

- `.pulse` and the `shimmer` animation must stop as soon as the board knows the viewed run is no longer alive (the same aliveness signal that drops `.spin` in `renderAgent`) — without close/reopen. The sweep must happen no later than the next board refresh after the aliveness change.
- Sweep from the death-observing paths: the board refresh / open-card update path (`refresh()` -> `updateOpenTask` / `renderAgent`) and/or when `pollLog()` stops the log timer on the idle early-return. Calling `markLiveLine()` from those paths is the obvious shape; exact placement is the developer's choice.
- Do not regress the existing engage/demote behavior: the pulse still appears while the run is alive (engage) and stays on the first line only — a history back-fill that inserts older lines above must demote it (engage/demote paths fixed in 54ccdd9 / e472661). `prefers-reduced-motion` already disables the shimmer — keep that.

# Tests / regression check

- Add or extend a regression check in `tests/webui.test.ts` covering the death sweep (for example: drive the refresh/open-card update path with a board payload whose run is dead and assert the `.pulse` class is gone, or assert that the refresh path clears it). The developer owns and runs this suite; do not weaken existing pulse engage/demote assertions.

# Acceptance

- `node tests/webui.test.ts` passes.
- Browser check on the repro above: after the killed run's death is reflected in the board (no `.spin` on the run card), within the next board refresh the first log line has no `.pulse` and no running `shimmer` animation, without closing the log.
- Sanity: while a run is genuinely alive the pulse still engages on the first line, and with `prefers-reduced-motion` the shimmer does not run.

# Notes

- Fix committed as c0d545f on fix/193-webui-pulse-clear-on-death: two one-line sweeps in the client source of src/webui/page.ts, both calling the existing markLiveLine().
  - updateOpenTask() calls it after renderAgent(t, true) and setBody(t): the board refresh that rebuilds the run cards and drops the dead run's .spin now sweeps the pulse in the same cycle, which satisfies "no later than the next board refresh".
  - pollLog()'s idle early-return calls it right after clearInterval: the exact repro (run dies while logState.idle is set) sweeps within one 1 s log tick of the board payload flipping to dead, even before that refresh lands.
- markLiveLine() itself is unchanged: it reads aliveness from the same activeBoard() payload renderAgent reads, keeps the pulse on the first line only (engage/demote from 54ccdd9 / e472661 intact), and prefers-reduced-motion still disables the shimmer. Both calls are idempotent, so a still-alive run re-engages the pulse with no visual change.
- Regression check in tests/webui.test.ts: asserts the updateOpenTask source and pollLog's idle-early-return block both include markLiveLine(); the "pullLog and closeLog drive the pulse" message was extended to name the new drivers, no assertion weakened.
- node tests/webui.test.ts passes; full npm test passes (kanban, orchestrator, webui, extension, index).
- The browser repro from the Specs (SIGKILL the pid, watch the first log line) was not run here: markLiveLine's engage/demote logic is unchanged and already covered, and the browser check is left for the live-testing stage.

# Open questions

None.

Assumptions:
- Sweep placement in both death-observing paths (updateOpenTask and pollLog's idle early-return) is per the Specs' "and/or" latitude; either alone covers the repro, both make the refresh itself a guarantee.
- updateOpenTask's sweep also engages the pulse when a new live run surfaces on an open card, matching "the pulse still appears while the run is alive".
- The browser repro is verified at the live-testing stage; the developer check is the suite, per the Specs' Tests section.
