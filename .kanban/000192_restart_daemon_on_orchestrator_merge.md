---
name: "fix: restart the daemon after a merge that changes the orchestrator"
priority: "high"
state: "live-testing"
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

## Developer notes (2026-10-13)
- `orchestrator_start` (index.ts) now spawns the daemon as `node --watch <extDir>/src/orchestrator.ts --root <root>` (detached, stdio into the daemon log).
- `orchestrator_stop` (index.ts) was fixed as part of this change: empirically, SIGTERM to the `node --watch` supervisor leaves the daemon child alive, and SIGTERM to the daemon child leaves the supervisor lingering, which resurrects the daemon on the next watched change. The stop now signals the daemon's process group when that group is not the caller's own group (guard so a test victim sharing the caller's group still gets a bare pid kill). On non-Linux (/proc unavailable) it falls back to the bare pid kill. `src/pid.ts` exports the existing `procPgrp` for the group read.
- Deleted the #165 webui hot reload in `src/hub.ts` per the updated Specs: the module-graph walk, the common-dir copy into `src/.webui-hot-<pid>-*/`, the dynamic import of the copy, the stale-dir sweep and the `webuiPath` option. `route`/`startHub` now use the statically imported `webui` module, so a page load writes nothing under src/.
- Tests: `index.test.ts` asserts the `--watch` spawn arg and that a detached supervisor-plus-child victim dies together on stop (both the group-kill and the bare-kill paths covered). `tests/orchestrator.test.ts` gains part AV, an end-to-end restart: the daemon acquires the lock under `--watch`, an mtime-only touch of a watched src file changes the lock pid, the webui answers again after the re-election, and the daemon releases the lock on stop; `killAll` also kills the lock pid, which the supervisor kill does not take down. The stub-mtime and graph-copy hot-reload tests were removed from `webui.test.ts`.
- All five suites pass (`npm test` order: kanban, orchestrator (3m15s), webui, extension, index).
- Note: the `Orchestrator starting (pid N)` message now names the `node --watch` supervisor; the daemon's real pid lands in `.kanban/.orchestrator.lock` and `orchestrator_status` reports it.
- Live observation: the production daemon already runs under `--watch` (relaunched 12:37, hygiene) and its child self-restarted at 12:46:11 after a src/ merge on main, with the webui re-elected on 0.0.0.0:4242 and the in-flight state kept.

## Review notes (2026-10-13)
- Verified the diff against the Specs. index.ts spawns the daemon under `node --watch`, and orchestrator_stop signals the daemon's process group when that group is not the caller's own group; src/pid.ts exports procPgrp. The hot reload is fully deleted in src/hub.ts. No file references `webuiPath`, `webuiLoader` or `.webui-hot` any more. No README, SKILL.md or .kanban change (empty diff stat).
- Verified the test coverage against the Acceptance. index.test.ts covers both stop paths: a plain victim shares the caller's group and gets the bare pid kill, and a detached supervisor plus child dies together on the group kill. Orchestrator part AV covers the end-to-end restart: an mtime-only touch of a watched src file changes the lock pid, the webui answers again after the re-election, and the daemon releases the lock on stop. killAll kills the lock pid too, so a --watch daemon child cannot leak between suite parts.
- Verified the three assumptions that were listed under Open questions against the code, and removed them: the diff touches no file under src/orchestrator/; the daemon's module graph (src/orchestrator.ts and its imports) excludes index.ts, which only the extension process loads; procPgrp reads null when /proc is unavailable, so stop falls back to the bare pid kill there.
- Review fixes (1e12884): the src/webui.ts shim comment still said the hub loads a "reloadable module path", which this change deletes, so the comment now names the static import. webui.test.ts now asserts that a page load leaves no `.webui-hot-*` dir under src/ (Acceptance: a page load no longer writes temp copies). All five suites pass after the fixes.

# Open questions
