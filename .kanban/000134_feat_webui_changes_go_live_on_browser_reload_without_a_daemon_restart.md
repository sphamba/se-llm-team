---
name: "feat: webui changes go live on browser reload without a daemon restart"
priority: "medium"
state: "backlog"
worktree: ""
complexity: moderate
blockedBy: "#122, #133"
---

# Summary
The hub serves the webui in-process with statically imported src/webui.ts, so webui code changes need an orchestrator restart. Make the hub re-load the webui module when the file changes, so a browser reload serves the new page and handlers.

# Specs
# Change (src/hub.ts, src/webui.test.ts, src/webui.ts only if needed)

Today hub.ts imports the webui's page and payload functions statically (the PAGE template, taskPayload, agentLogPayload, renderLogChunk...), so the daemon process keeps serving the code it loaded at startup; editing src/webui.ts does nothing until the daemon restarts.

Make the webui module reloadable:

- hub.ts references the webui functions through a dynamically imported module instead of static imports, and refreshes that reference when src/webui.ts's mtime changes (check per request via a cheap stat, or a watcher; node cache-busts ESM imports with a query like import(`${path}?v=${mtimeMs}`)).
- The hub's own state (registry entries, heartbeats, election) stays in the running process; only the request-handling code reloads. The daemon itself never restarts.
- Serve the HTML with no-cache headers so a browser reload reliably fetches the fresh page (today no Cache-Control is set, src/webui.ts ~:401, so a stale page can linger).
- Tests: src/webui.test.ts covers that a changed webui module is picked up (e.g. import the module twice with a different mtime query and see fresh exports), and that the hub keeps serving after a reload.

# Deliberate ceiling

Changes to src/hub.ts itself (the server code) still need a daemon restart - only the webui module (page, rendering, payload builders) reloads. Mark that in a comment naming the upgrade path (out-of-process webui child).

# Complexity

moderate. Focused change in hub.ts's import path plus tests.

# Notes
