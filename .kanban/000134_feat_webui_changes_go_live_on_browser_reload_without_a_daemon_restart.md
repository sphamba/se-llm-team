---
name: "feat: webui changes go live on browser reload without a daemon restart"
priority: "medium"
state: "done"
worktree: ""
complexity: "moderate"
blockedBy: ""
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

- hub.ts no longer imports PAGE, taskPayload, agentLogPayload statically: a webuiLoader closure (per hub) returns the module from a dynamic import cache-busted with the file mtime as the version query (`import(pathToFileURL(path).href + "?v=" + mtimeMs)`), refreshed when a per-request statSync sees a new mtime. The hub's registry, heartbeats and election stay in the running process. A vanished or unparseable webui file serves the last good module, so an edit mid-write never blanks the ui. Comment marks the ceiling: hub.ts itself still needs a daemon restart; upgrade path is an out-of-process webui child.
- HubOptions gains an optional `webuiPath` (defaults to the sibling webui.ts) so the tests can point a live hub at a stub module.
- GET / now serves `cache-control: no-cache` so a browser reload re-fetches the fresh page.
- webui.test.ts: a live hub pointed at a stub webui module serves the stub page; after the stub is rewritten and its mtime bumped, a reload serves the fresh page (stale page gone), and /api/projects + /api/tasks keep answering (registry state survives the reload). An mtime bump of the real src/webui.ts makes the real hub re-import the real module graph with a fresh query, page and api stay up. GET / asserts the no-cache header.
- Checks: node src/webui.test.ts, src/kanban.test.ts, src/orchestrator.test.ts, src/extension.test.ts, index.test.ts all pass. Commit 68ede3c on feat/134-webui-changes-go.

## Review 1 (2026-10-12)
Reviewed d5a1ca1 against the Specs. Implementation matches every spec item: hub.ts references PAGE/taskPayload/agentLogPayload only through the per-hub webuiLoader closure (dynamic import cache-busted with the file mtime, per-request statSync), the hub's registry/heartbeat/election state stays in the running process, GET / serves cache-control: no-cache, the vanished/broken-file path serves the last good module, and the ceiling comment names the out-of-process webui child as the upgrade path. webui.ts itself is untouched. Tests cover the stub rewrite + mtime bump (fresh page served, stale page gone, /api/projects + /api/tasks keep answering), the real module re-import, and the no-cache header; all five test files pass. Found and fixed one hygiene issue: the real-webui reload test bumped src/webui.ts's mtime permanently; a review commit (d5a1ca1) now restores it after the assertions. Re-set to to-review for a re-pass.

## Review 2 (2026-10-12)
Re-passed d5a1ca1 against the Specs. The review 1 fix is in place (the real-webui reload test restores src/webui.ts's mtime after the assertions). Re-verified: hub.ts is the only caller of route() so the signature change is safe; DEFAULT_WEBUI_PATH resolves to the sibling webui.ts via import.meta.url; the loader serves the last good module when the file vanishes or the import fails, and keeps the old version so a later request retries. webui.ts is untouched (empty diff against main, no branch commits touch it). All five test files pass on a fresh run (node src/webui.test.ts, src/kanban.test.ts, src/orchestrator.test.ts, src/extension.test.ts, index.test.ts). No further findings; ready for live testing.

## Live test (2026-10-12)

Result: PASS. No findings, no new tasks. The unit suites were not run.

Setup: I copied the branch checkout to /tmp/live134/checkout (fixture, so the served webui.ts is editable), made a fixture project root with one done task and a project config `webUi: {enabled, 127.0.0.1:4399}`, isolated HOME=/tmp/live134/home (own hub registry and lock), and started the real daemon: `node src/orchestrator.ts --root /tmp/live134/root`. The daemon won the hub election and served the ui. Browser flow used real Chromium through Playwright (page loads and reloads, no cache tricks).

- Baseline: GET / answers 200 with `cache-control: no-cache`, the fixture task card is visible, /api/projects and /api/tasks answer.
- Core flow: the user edits the served webui.ts (page title, h1, and a new `taskPayload` field). A browser reload then serves the fresh page: the new title and h1 appear, the old title is gone, the card still renders, and the new payload field is in the page data. A second fresh browser visit sees the same new version.
- No daemon restart: one daemon process (PID 2686278) ran for the whole test, from start to cleanup. Its log has only the two startup lines and no errors.
- Mid-write or broken file: with garbage written over webui.ts, GET / still answers 200 with the last good page, and /api/tasks and /health stay up. After the file becomes valid again with a newer mtime, the next request picks up the new version (no permanent stick).
- Missing file: after webui.ts is renamed away, GET / still answers 200 with the last good page, and /api/tasks stays up.
- Hub state survives: /api/projects keeps the entry and the hub registry file keeps the same entry through every reload.
- Ceiling is respected and its comment is in hub.ts. webui.ts is untouched. The branch diff against main touches only src/hub.ts and src/webui.test.ts. The worktree is clean.
- Cleanup: daemon killed, port 4399 down, hub lock released, registry empty. No leaked daemons.

## Merge (2026-10-12)
Base branch both times: main. Step 1: main was already an ancestor of feat/134-webui-changes-go, so the worktree merge reported "Already up to date" with no conflicts; no test suites run (clean-merge rule). Step 2: main fast-forwarded 00e35bf..d5a1ca1, carrying src/hub.ts (+49/-7 lines region) and src/webui.test.ts (+41/-1). Root checkout was clean before and after; no conflicts anywhere. Merged state: main at d5a1ca1.
