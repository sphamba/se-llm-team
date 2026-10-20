---
name: "fix: dialog throws on table bodies, md table helpers not injected"
priority: "high"
state: "done"
worktree: ""
issuer: "#291"
complexity: "simple"
shortName: "fix-dialog-table-helpers"
---

# Summary
Repair Finding 1 from #291's live test: the task details dialog throws ReferenceError: TABLE_SEP is not defined on any task body with a GFM table, because the page script injects only the md function source while the table helpers (TABLE_SEP, tableCells, tableAlign) stay at module scope in logpane.ts. The throw also kills the chained history fetch, so agent cards never render for that task. Deliver the helpers to the browser and add a served-page test that actually runs md on a table body.

# Specs
## Need

Finding 1 of #291's live test: any task whose body contains a GFM table breaks the task details dialog. The browser raises `ReferenceError: TABLE_SEP is not defined`, `#m-body` stays on the "Loading task details..." placeholder, and the throw also kills the history fetch chained after `setBody` in `openTask` (`src/webui/page.ts:608-638`), so the agent cards and log pane never open for that task. The 5 s poll throws again and does not recover. The agent-log path (server-side `renderLogChunk`) is unaffected and fully verified.

## Facts (from #291's live test, verified against the code)

- Cause: the `md()` table branch (`src/webui/logpane.ts:115-129`) reads the module-scope helpers `TABLE_SEP` (`:91`), `tableCells` (`:92`) and `tableAlign` (`:99`). The page script injects only `esc` (`page.ts:351`), `inline` (`page.ts:363`) and the `md` function source; the three helper definitions never reach the browser.
- Test gap: `tests/webui/page.test.ts` asserts only that the page string contains `String(md)`; a page whose `md` cannot run still passes.
- Control that proves the cause: a table-free task body renders at once and its log shows tables; the served CSS rules for both sites are correct.
- The repair paths named by the live test: inject the helpers into the page script, or move the three helpers into `md()`.

## Repair (decided)

Deliver the three helpers to the browser through the established injection pattern: alongside the `esc`/`inline` consts in the PAGE script (`page.ts:351`, `page.ts:363`), add the `TABLE_SEP`, `tableCells` and `tableAlign` definitions interpolated the same way. If the developer finds folding the helpers into `md()` cleaner, that is acceptable, provided the injected `md` source stays a single self-contained function. Either way the log-pane output must stay byte-identical to #291's.

## Test gap to close (required)

`tests/webui/page.test.ts` must gain a check that extracts the served page script's `md` (with the helpers it needs) and runs it against a GFM table body without throwing, asserting the `md-table-wrap` wrapper and table markup. A `String(md)` presence assert alone must not be able to pass a broken renderer again.

## Constraints

- No change to the rendered markup or CSS from #291: same wrapper class, same `md-pin` sticky column, same alignment styles.
- Keep `esc()`-first escaping; no new injection surface beyond the three helper definitions.
- No changes to `renderLogChunk` output or the log-pane path.

## Acceptance criteria

1. The scoped webui suites pass (`node tests/webui/logpane.test.ts`, `node tests/webui/page.test.ts`, `node tests/webui/agentlog.test.ts`, `node tests/webui/board.test.ts`, `node tests/webui/hub.test.ts`), with the new served-page `md` check green.
2. The new check renders a GFM table body through the served page script without throwing and asserts the wrapper, thead and pinned-cell markup.
3. Live check: the #291-style fixture task with a table body opens in the dialog with the body rendered, the history fetch completing, agent cards present, and zero page errors; the log-pane table behavior stays as verified in #291.

# Notes
- Repair (folded path, allowed by Specs): moved `TABLE_SEP`, `tableCells` and `tableAlign` inside `md()` (`src/webui/logpane.ts:91-101`). The page's existing `${md}` interpolation now ships every name the renderer reads; `src/webui/page.ts`, the markup and the CSS are untouched, so the log-pane output is unchanged (`tests/webui/logpane.test.ts` green).
- Test gap closed: `tests/webui/page.test.ts` replaces the `String(md)` presence assert with a served-page check. It extracts `esc`, `inline` and the `md` function source from the served `<script>`, evaluates them, and runs a GFM table body. First run was red with the reported `ReferenceError: TABLE_SEP is not defined`; after the fix it asserts the exact `md-table-wrap`, `thead` and `md-pin` markup.
- Scoped suites pass in order: `tests/webui/page.test.ts`, `tests/webui/logpane.test.ts`, `tests/webui/agentlog.test.ts`, `tests/webui/board.test.ts`, `tests/webui/hub.test.ts`.
- Acceptance 3 (live dialog check) was not run here: it needs a browser and a daemon restart, because a page change reaches the live UI only after restart. The served `md` is now executed by the page test, so the ReferenceError path is covered.
- Commit: `3dccce2` on `fix/292-fix-dialog-table-helpers`.
- Review (read-only, no reviewer fixes): repair took the fold path, which the Specs allow. `src/webui/logpane.ts:92-101` moves `TABLE_SEP`, `tableCells` and `tableAlign` inside `md()`; the moved block is byte-identical to main's `src/webui/logpane.ts:91-99` apart from indentation (md5 `955bf35` on both sides), so log-pane output cannot change. `src/webui/page.ts`, the markup and the CSS from #291 are untouched.
- Test gap is closed and the new check really fails on the bug: with `src/webui/logpane.ts` reverted to main and the new test kept, `node tests/webui/page.test.ts` exits 1 with `ReferenceError: TABLE_SEP is not defined` in the served `md`; with the fix it exits 0. `tests/webui/page.test.ts:177-195` pulls `esc`, `inline` and the served `md` out of the fetched page script and pins the exact table markup, so a `String(md)` presence assert can no longer pass a broken renderer.
- Acceptance 1: `page`, `logpane`, `agentlog`, `board` and `hub` each exit 0 (run serially). `tests/webui/logpane.test.ts:277-311` still pins alignment, ragged rows, escaped pipes and links, unchanged by the move.
- Acceptance 2: `tests/webui/page.test.ts:191-195` asserts the `md-table-wrap` wrapper, the `thead`, and the `md-pin` header and body first cells by exact string.
- Acceptance 3 (live dialog on the #291 fixture, history fetch completing, agent cards present, zero page errors) is not run here. It belongs to the live-test stage after merge, because a page change reaches the UI only after a daemon restart. The throw came from `md` itself in the dialog path (`src/webui/page.ts:608-638`), which the served-`md` run now covers.
- Non-blocking: the `new Function` harness (`tests/webui/page.test.ts:185-190`) runs in sloppy mode while the page runs `"use strict"` (`src/webui/page.ts:347`). Reading an un-injected name throws in both modes, so today's bug class is caught. Only a future write to an undeclared name inside `md` would pass the test and throw in the browser. Add `"use strict";` to the harness body if `md` ever assigns to module-scope state.
- No silent assumption found: the fold path is named in the Specs and the Notes state that the live check was deferred.
- total 2 files, +31/-13 from the diff; reviewed commit `3dccce2`.

## Live test (2026-10-20)

- Lane: board and dialog behavior in a browser, on a hub-only fixture. `/api/hub` served commit `3dccce2` from this worktree, before any check ran.
- Fixture: `/tmp/t292/root/.kanban` holds `001-table-body.md` (state `live-testing`, a GFM table in the body with left, center and right alignment and an escaped pipe) and `002-plain-body.md` (control, no table). The log `001-table-body.live-tester.1.log` holds two `turn_end` records and a pipe table in its streamed text. The hub ran on 127.0.0.1:4391 with `XDG_CONFIG_HOME` inside the fixture. The real board, port 4242 and the project daemon stayed untouched.
- Harness: `/tmp/t292/run.sh` (setup, launcher, health and `ss` proof, Playwright driver, pidfile teardown). The last run log is `/tmp/t292/run.log`.
- Result: 16 of 16 checks pass.
  - The dialog renders `#m-body` as `div.md-table-wrap > table > thead`: 3 headers, `md-pin` on the first header and the first body cell, center on column 2, right on column 3, wrapper `overflow-x: auto`, pinned cell `position: sticky`. The escaped pipe shows as `a | pipe`.
  - The `Loading task details...` placeholder is replaced by the table.
  - `/api/task-detail?num=1` and `/api/task-history?num=1` answer 200, and the history render puts one `live-tester` card in `#m-agent-btns` (300 tokens, 1 m).
  - Zero `pageerror` and zero `console.error` during the open, and also after the 5 s poll. The table stays rendered past the poll.
  - The control task without a table renders its paragraph at once, with no `md-table-wrap`.
  - Log pane: the agent card opens the pane, `#m-log-text` shows its own table, the pinned cell background equals the pane background (`rgb(235, 238, 240)`), and the right-aligned header keeps `text-align: right`.
- Assumptions that shaped the test:
  - The fixture log is a small hand-written pi JSONL, so the agent card shows small stats. The check proves the history fetch and render path, not the stats arithmetic.
  - The task state is `live-testing` so the log role maps to `live-tester` and a card renders. No pid file exists, so the run shows as finished.
  - The fixture root is not a git checkout, so the commit in `/api/hub` comes from the worktree code root, not from the fixture.
- These checks fail without the change by construction: a helper missing from the served `md` throws while the dialog runs, so the "table rendered" and "zero page errors" checks cannot pass. No second control was needed.
- First run reported 2 failures that were checker bugs: the escaped-pipe check read row 1 instead of row 2, and an 80 character text slice cut the control text before its match. Only the checks changed; the second run is the result above.
- No observed behavior contradicts the task's assumptions.

# Open questions
