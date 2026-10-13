---
name: "fix: clear the webui live-line pulse when the run dies"
priority: "medium"
state: "live-testing"
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
- Review (fix/193-webui-pulse-clear-on-death, HEAD before merge c0d545f): both death-observing paths sweep via the unchanged markLiveLine(), which reads the same activeBoard() payload renderAgent reads. updateOpenTask's sweep runs inside the refresh cycle that flips the payload (mergeBoards precedes updateOpenTask), satisfying "no later than the next board refresh"; pollLog's sweep is a belt-and-braces earlier trigger within one 1 s tick. Both idempotent, engage/demote from 54ccdd9 / e472661 intact, no existing assertion weakened; node tests/webui.test.ts passed on the pre-merge HEAD.
- Review merged main into the branch per the convention (main had moved 4 commits past da35d5b: #192 node --watch daemon, webui hot reload deletion): merge commit 077c67c, auto-merged with no conflicts. main touched tests/webui.test.ts (removed the hot reload section) and src/webui.ts, not src/webui/page.ts, so the fix is untouched. Full npm test (kanban, orchestrator, webui, extension, index) passes on the merged HEAD, run twice.
- Live test (merged 077c67c, no code edited, no unit suite run): the merged webui was served by a throwaway hub from the task worktree (startHub in src/hub.ts) on port 4388 with an isolated HOME, so the temp hub registry and lock stayed in /tmp and the production registry and port 4242 were untouched. Fixture root: two doing tasks, each with a live sleep pid in .kanban/.pids/<slug>.pid and a real-shape developer log (a session record, a turn_end usage record, then 8 text_start/text_delta pairs that render 8 element lines). Playwright headless chromium drove the real ui.
- Live test result: 15/15 checks pass. Engage: while the run is alive the first log line carries .pulse with shimmer:running, exactly one line is pulsed, and the run card shows .spin. Idle: after 3 s of empty 1 s log polls the rendered line count is unchanged and the pulse is still on. Death sweep: SIGKILL on the pid in .pids/000001_alive.pid, the board refresh drops .spin at 1188 ms, and in that same DOM state the first line has no .pulse, getAnimations() reports no shimmer, the pane holds no .pulse at all, and the run card reads agent-past. The sweep had already fired before the board refresh (pollLog's idle early-return on its 1 s tick), and markLiveLine is idempotent, so the two paths agree. The exact 6 s repro window after the kill still shows no pulse and no shimmer, so the reported loop is gone. Reduced motion (emulated): the live first line still carries .pulse but getAnimations() is empty, so no shimmer runs. No page errors.
- Differential control: the same scenario against the pre-fix client (merged tree with src/webui/page.ts taken from c0d545f~1) reproduces the reported bug. After .spin is gone the first line still has .pulse and shimmer:running, the pulse count is 1, and it is still that way 6 s later (5 death checks fail). The merged code passes all of them, so the test is sensitive to exactly this fix.
- Live test assumptions: "first line" means the pane's topmost element child, and the fixture uses real JSON records that render element lines. Aliveness ends with SIGKILL on the pid named in the .pids file, the same source pidAlive reads. The pollLog sweep can beat the board refresh by up to one 1 s log tick, which the Specs' "and/or" and "no later than the next board refresh" wording allows. The hub-only fixture serves the client without a daemon, matching the Specs' own repro recipe.
- Contradictions: none. The merged commit 077c67c serves the fix unchanged (page.ts is at c0d545f, main had moved only tests/webui.test.ts and src/webui.ts, no conflict there).

# Open questions

None.

Assumptions:
- Sweep placement in both death-observing paths (updateOpenTask and pollLog's idle early-return) is per the Specs' "and/or" latitude; either alone covers the repro, both make the refresh itself a guarantee.
- updateOpenTask's sweep also engages the pulse when a new live run surfaces on an open card, matching "the pulse still appears while the run is alive".
- The browser repro is verified at the live-testing stage; the developer check is the suite, per the Specs' Tests section.
