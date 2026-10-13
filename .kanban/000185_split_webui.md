---
name: "refactor: split webui.ts into src/webui modules"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "split-webui"
blockedBy: ""
---

# Summary
Split the 1779-line src/webui.ts into smaller more manageable modules in a src/webui/ folder, keeping every named export reachable so imports stay stable.

# Specs

## Change
- Move src/webui.ts into a src/webui/ folder as focused modules, for example: payload.ts (logStats, agentHistory, agentInfo, taskPayload, agentLogPayload, statsCache), board.ts (pairLayout, LAYOUT, spinnerHtml, numLinkHtml, cardHtml, taskStatsText, buildShell, syncBoard, relationPaths, curve, flipDiff, makeCard, hotRelations), logpane.ts (renderLogChunk, md, logFixups, LOG_LINES, LOG_ROLES constants), page.ts (PAGE template, loadWebUiConfig, refreshMs, tabNames, tabsHtml, boardOf, mergeBoards).
- src/webui/index.ts re-exports every named export the old module had, so index.ts keeps importing './src/webui.ts' (directory resolution) or './src/webui/index.ts', and tests/webui.test.ts keeps its named imports.
- CRITICAL: the PAGE template interpolates function SOURCE into the served page (JSON.stringify(LAYOUT), the functions as ${fn} source, src/webui.ts:1362-1369) and the client runs that tested code. The split must keep interpolating the same function objects; the shipped page's behavior must not change.
- Importers to keep working: src/orchestrator.ts imports loadWebUiConfig from './webui.ts'; tests/orchestrator.test.ts and the hub paths exercise it too. No new dependencies; no behavior change anywhere.

## Tests
- All five suites pass unchanged (only webui.test.ts's import path may change); the page still ships the tested layout/formatters (the includes(String(fmtDur)) contract stays).

# Notes
- Filed by the PM (user restructure order, 2026-10-12), after the tests move (#184) because both rename the same imports. Disjoint from the orchestrator split (#186), so they may run in parallel once #184 lands.
- Split done (commit 772685b): src/webui/logpane.ts (renderers, esc, role constants), payload.ts (taskPayload, agentLogPayload, log-reading and usage-stat helpers), board.ts (layout, cards, formatters, curves, FLIP), page.ts (PAGE template, loadWebUiConfig) with an index.ts barrel and a one-line re-export shim at src/webui.ts, so src/orchestrator.ts, src/hub.ts and tests/webui.test.ts keep importing "./webui.ts" unchanged.
- Two deliberate deviations from the suggested grouping: AGENT_ROLE and LOG_ROLES live in logpane.ts (newly exported there) so payload.ts imports them from the leaf instead of forming a payload <-> logpane cycle; esc lives in logpane.ts as the shared leaf helper (board.ts imports it). The graph is acyclic: page -> {payload, board, logpane, kanban}.
- Verified: served PAGE byte-identical against a pre-split baseline (via both the shim and the barrel), all 31 runtime exports plus the WebUiConfig type re-exported, all five test suites pass with tests/webui.test.ts untouched, and scripts/test-changed.mjs now maps src/webui/* changes to webui.test.ts (its own test assertions still pass unchanged).
- One mid-flight fix: an off-by-one extraction range cut logStats' closing brace; the parse check caught it and the file was corrected before commit.
- Review (2026-10-13, commit 772685b): re-verified independently. Served PAGE is byte-identical to a pre-split build through both the barrel and the shim (45,552 bytes). All 31 runtime exports match the old module by name and by String() value. Every top-level declaration of the old file is carried over, no duplicate helpers between modules, and the import graph is acyclic. All five suites pass. No code fixes.
- Review note: the Notes above name two newly exported constants but miss a third. `inline` also moved to logpane.ts as a new export, consumed by page.ts for the PAGE interpolation. It is deliberately NOT in the index.ts barrel, because the old module did not export it and the public API must stay the same. Same rationale as AGENT_ROLE and LOG_ROLES, so accepted.
- Merge (2026-10-13): base branch was main both steps. Step 1 (worktree): main was already contained in the branch, "Already up to date", nothing to resolve. Step 2 (root): fast-forwarded main from e3bfbf6 to 772685b, no conflicts either side. No conflict resolution needed, so per pipeline rules the suites were not re-run here; the live test runs on the merged commit next.
- Live test (2026-10-13, merged commit 772685b, PASS): the pre-split code (e3bfbf6) and the merged code ran side by side as two hubs on one fixture board. `GET /` is byte-identical (45,552 bytes, the same sha256). `/api/tasks` is identical after the live-agent duration (wall-clock based) is normalized. `/api/agent-log` is byte-identical for a done run, a live run and `sub=list`. An unknown handle gives 404 on both.
- Export surface: the old module, the barrel (`src/webui/index.ts`) and the shim (`src/webui.ts`) each expose the same 31 runtime names, and all 28 function sources are equal. `PAGE` is equal.
- Browser smoke on the merged hub: the board renders 10 columns, both probe cards land in `.c-done` and `.c-doing`, the task modal opens, and the agent log pane shows the live thinking text. No console or page errors.
- Hot reload: a marker added to `src/webui/page.ts` and a marker inside `esc` in `src/webui/logpane.ts` both appeared in the next `GET /` with no restart, and the `.webui-hot-*` dirs were swept. The reload graph still walks into the new `src/webui/` folder.
- Daemon importer: the merged daemon (`src/orchestrator.ts` -> the `src/webui.ts` shim -> `loadWebUiConfig`) bound the fixture port and served a page byte-identical to the pre-split page.
- Assumptions: the Specs offer directory resolution or `./src/webui/index.ts`; the merged tree uses the one-line shim, so the test covered both the shim and the barrel. The fixture board held synthetic logs and a live sleep pid, not a real agent run. No findings, no open questions.
