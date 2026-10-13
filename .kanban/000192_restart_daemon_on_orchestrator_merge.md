---
name: "fix: restart the daemon after a merge that changes the orchestrator"
priority: "high"
state: "to-do"
worktree: "fix/192-restart-daemon-on-orchestrator-merge"
issuer: "#187"
complexity: "simple"
shortName: "restart-daemon-on-orchestrator-merge"
---

# Summary
The daemon self-restarts when its own code changes: it runs under node --watch (no README/SKILL.md change), and the #165 webui hot reload is deleted because its src/ temp copies conflict with the watcher (each hot reload restarted the daemon, one page load = one restart). One-time hygiene done: the production daemon already runs under node --watch.

# Specs
## Decision (user, 2026-10-13)
- The daemon self-restarts when its own code changes by running under `node --watch` (module graph = index.ts/src/* resolved through the extension symlink). No README/SKILL.md change.
- The #165 webui hot reload is deleted: under --watch it is dead weight and conflicts with the watcher. The hub wrote temp copies into src/.webui-hot-<pid>-*/ and dynamically imported them, so every hot reload restarted the daemon (confirmed: one page load = one restart, lock pid 690865 -> 691050).

## Work (developer)
- Delete the webui hot-reload mechanism in src/hub.ts: the temp-copy creation (join(srcDir, `.webui-hot-${process.pid}-${v}`)), the dynamic import of the copy, and the stale .webui-hot dir sweep. The hub serves the page from the statically imported webui module.
- Remove the hot-reload tests; the hub serving/election tests stay green.
- Already done (one-time hygiene, no code): the production daemon was relaunched under node --watch on 2026-10-13; touching src/kanban.ts restarted it (lock pid changed, webui re-elected on 0.0.0.0:4242).

## Acceptance
- Touching a watched src file restarts the daemon (lock pid changes, webui answers after the re-election).
- A page load no longer restarts the daemon (no temp writes under src/).
- All five suites pass; no README/SKILL.md change.

# Notes
