---
name: "refactor: split webui.ts into src/webui modules"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "split-webui"
blockedBy: "#184"
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
