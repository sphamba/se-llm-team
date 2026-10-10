---
name: "feat: optional in-process web dashboard for the orchestrator"
priority: "medium"
state: "backlog"
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
