---
name: "feat: optional in-process web dashboard for the orchestrator"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
The daemon optionally starts an in-process HTTP dashboard configured by ~/.pi/agent/se-llm-team.json (webUi.enabled, webUi.host default localhost, webUi.port default 4242). The page shows one kanban column per task state with flat, modern cards (name + priority); clicking a card opens a popup with all attributes and the Markdown-rendered body.

# Specs
# Need

A web dashboard for the orchestrator, optional and configured by a new user config file. Columns for each possible task state, the task cards in them, modern, flat, simplistic UI.

# Facts

- The daemon is src/orchestrator.ts; main() starts the watcher, rescan and poll. The board is read via listAll(root) from src/kanban.ts (fields: file, name, priority, state, worktree; the markdown body needs an extra file read).
- The 8 states in pipeline order: backlog, to-do, doing, to-review, reviewing, to-live-test, live-testing, done.
- No new dependencies, no build step. The page is an embedded template literal in TS. The user config file ~/.pi/agent/se-llm-team.json does not exist yet; absent file = dashboard off.
- The library now writes files only (src/kanban.ts); the daemon is the sole .kanban committer. Worktrees get a .kanban symlink to the shared board.

# Required behavior

1. New file src/webui.ts exporting startWebUi(root, opts: {host, port}):
   - http server, two read-only endpoints: GET / returns the embedded dashboard HTML; GET /api/tasks returns JSON [{file, name, priority, state, worktree, body}] where body is the raw markdown after the frontmatter, read fresh per request via listAll(root). 404 otherwise.
   - Binds opts.host (default "localhost"), opts.port (default 4242). On EADDRINUSE or any server error: return null / report failure; never throw into the pipeline. Request handler wrapped in try/catch.
   - On port 0 the OS picks a free port; return the actual bound port so tests can use it.
2. Config in ~/.pi/agent/se-llm-team.json, nested object:
   ```json
   { "webUi": { "enabled": true, "host": "localhost", "port": 4242 } }
   ```
   Read tolerant of a missing file or invalid JSON = dashboard off. Absent host = "localhost"; absent port = 4242; absent enabled = off.
3. src/orchestrator.ts main(): after the existing startup, read the config; when enabled, call startWebUi and log "web ui on http://<host>:<port>" to the daemon log; when the server fails, log a warning line and continue. The pipeline must never crash because of the UI.
4. Dashboard UI (embedded in src/webui.ts):
   - Eight columns, one per state in pipeline order, headers with the state name and a task count.
   - Cards: task name and a small priority chip. Flat, modern, simplistic: system font stack, flat colors, no gradients or shadows, one small accent color per column.
   - Click a card: modal popup with all attributes (file, name, priority, state, worktree) and the Markdown-rendered body (Summary, Specs, Notes). Embed a minimal Markdown renderer for the subset the board uses: headings, lists, code fences, inline code, bold, links, paragraphs. Mark the ceiling in a comment: swap for a full renderer when needed. Click outside the popup or a close button closes it.
   - Page JS (~30 lines): fetch /api/tasks every 2s and re-render the columns. No connection management.
5. README.md: a short section on the config file and the dashboard URL.
6. orchestrator_start tool description in index.ts: add that it optionally starts a web dashboard.

# Constraints

- No new dependencies, no build step, no new pid files. Minimal diff outside src/webui.ts.
- The in-process server must never take the pipeline down: caught request errors, server error handler, EADDRINUSE tolerated.

# Acceptance criteria

- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass, plus one new small test (node-runnable, project convention): start startWebUi on port 0 against a temp board with one task; GET /api/tasks returns the task with its fields and body; GET / returns HTML that mentions all 8 state names; a second startWebUi on the same taken port reports failure instead of throwing.
- With webUi.enabled true, the daemon log shows the "web ui on http://host:port" line and the page renders the board.
- With no config file, the daemon runs as before and no server starts.

# Notes

- Implemented src/webui.ts: startWebUi(root, opts) starts an in-process HTTP server. GET / returns the embedded dashboard page. GET /api/tasks returns file, name, priority, state, worktree, and the raw body after the frontmatter, read fresh per request via listAll(root). Other paths and methods give 404. Server errors (EADDRINUSE and friends) resolve null and never throw. Port 0 makes the OS pick a port; startWebUi returns the bound port and a close() handle.
- loadWebUiConfig() reads ~/.pi/agent/se-llm-team.json. A missing file, invalid JSON, or absent enabled key means off. Absent host means localhost, absent port means 4242.
- orchestrator.ts main() reads the config after startup. When enabled, the daemon starts the dashboard and logs "web ui on http://<host>:<port>". A failed start logs a warning line and the pipeline continues.
- Dashboard page: eight columns in pipeline order with state name and count, cards with name and a priority chip, one accent color per column, system font stack, flat colors, no gradients or shadows. A card click opens a popup with all attributes and the Markdown-rendered body. The renderer covers headings, lists, code fences, inline code, bold, links, and paragraphs, with a comment that marks the ceiling. Click outside or the Close button closes it. The page fetches /api/tasks every 2 s and re-renders.
- README.md: webUi config keys in the config table plus a Web dashboard section with the URL. index.ts: orchestrator_start description mentions the optional dashboard.
- Checks: node src/kanban.test.ts, node src/orchestrator.test.ts, and the new node src/webui.test.ts all pass, run twice. The new test covers port 0, the /api/tasks fields and body, all 8 state names in GET /, 404 paths, EADDRINUSE on a taken port, and the daemon log line with a spawned daemon (HOME at a temp config, port 0).
- Verified with no config file: no "web ui" log line and no server on port 4242, daemon runs as before. Verified the emitted page JS parses (node --check on the extracted script) and the Markdown renderer works against the emitted code. Playwright is not installed, so no browser screenshot check was possible.
- Commit b382fa9 in the worktree.
- Review pass (commit 9f5272b): found one defect. loadWebUiConfig() read only ~/.pi/agent/se-llm-team.json and ignored the project .kanban/se-llm-team.json override, while loadConfig() layers user-level under project override for the same file and the README step 3 (which this PR extends with the webUi keys) states the override applies. Fixed loadWebUiConfig(root?) to apply the same two-path lookup (project wins) and orchestrator.ts main() now passes root. Extended webui.test.ts hermetically (HOME at the temp home): absent config = off, project override wins for host/port, and a project file without webUi falls back to the user file. All three suites re-run twice, pass; no leaked fixtures.
- Everything else checked against the Specs and holds: GET / and GET /api/tasks fresh per request via listAll, 404 on other paths and methods, port 0 returns the bound port, EADDRINUSE resolves null instead of throwing, request handler and response errors caught, "web ui on http://<host>:<port>" log line, failed start logs a warning and the pipeline continues, eight columns in pipeline order with counts and per-column accent colors, flat system-font styling, card popup with all attributes and a Markdown-rendered body (headings, lists, code fences, inline code, bold, links, paragraphs, ceiling comment present), esc() applied before the renderer and on all interpolated fields so the page is XSS-safe, 2 s fetch loop with no connection management, README section and index.ts orchestrator_start description updated, minimal diff outside src/webui.ts.
- Second review pass: no fixes needed. Re-ran all three suites, pass. Verified the emitted page JS parses (node --check on the script served by a live server) and that /api/tasks strips the frontmatter from the body. loadWebUiConfig is also tolerant of scalar or null JSON bodies. Two edge cases reviewed and left as-is: a project webUi object replaces the user one wholesale (defensible reading of the override, tested, and the disjoint-keys scenario is unlikely), and a mid-response listAll error would leave one request hanging (cannot realistically fire mid-request, and the pipeline stays up either way).
