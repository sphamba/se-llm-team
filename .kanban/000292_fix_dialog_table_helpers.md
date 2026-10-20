---
name: "fix: dialog throws on table bodies, md table helpers not injected"
priority: "high"
state: "backlog"
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
