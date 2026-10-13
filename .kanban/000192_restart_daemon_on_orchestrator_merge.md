---
name: "fix: restart the daemon after a merge that changes the orchestrator"
priority: "high"
state: "done"
worktree: ""
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

## Live-test notes (2026-10-13)
Scope: the acceptance flows only, through their real interfaces. No unit suite ran. The fixture tests ran from a scratch clone of the merged commit 6fee955 in /tmp/live192/code, against a throwaway git root, an isolated HOME and a non-production port. The real checkout stayed untouched by those tests.

Assumptions:
- A merge that changes src/ is equivalent to a `touch` or an edit of a watched src file. Both trigger the fs.watch event that node --watch reacts to.
- "A page load no longer restarts the daemon" means that a page load writes nothing under src/ and does not change the lock pid.
- The "one-time hygiene" sentence in Summary/Specs is part of the deliverable. It was verified, not trusted.

Passed:
1. Watch restart (fixture): `touch src/kanban.ts` changed the lock pid 857511 -> 857570. The webui answered 200 after the re-election. A content edit of src/orchestrator/main.ts loaded the new code ([GEN2] marker, 3 starts in total).
2. Page loads (fixture): 3 HTTP GET /, then 5 GET /, then a real Playwright load (title "Software Engineering LLM Team", #board present, no page errors). No restart occurred. No src/.webui-hot-* dir existed. The src/ tree did not change.
3. Extension interface (fixture repo): orchestrator_start reported "Orchestrator starting (pid 861495)". The supervisor 861495 ran `node --watch <ext>/src/orchestrator.ts --root <root>`. The lock held its child 861508. orchestrator_status reported the child pid. orchestrator_stop reported "Sent SIGTERM to orchestrator pid 861508" and killed supervisor and child. The lock became empty. The log recorded "orchestrator stopped".
4. Production acceptance after the re-hygiene below: `touch src/kanban.ts` in the real checkout changed the lock pid 868296 -> 868359 under the same supervisor 868290. The webui answered 200 on 4242 and /api/hub carried the new pid. The file sha256 and `git status` did not change. The restart kept 3 in-flight tasks and left all 4 running agent pids alive.

Contradiction found, then repaired:
- The Summary/Specs sentence "One-time hygiene done: the production daemon already runs under node --watch" was false at test start. Lock pid 758169 had PPID 1 and no supervisor process. Main moved from 6fee955 to 077c67c (#193 merge, 13:24) and to 0bf8fed (#190 merge, 13:30) with no restart in .kanban/.logs/orchestrator.log. So the fix was inert on the real board across two merges.
- Cause: the old daemon started at 12:46, before the 13:14 merge, from a pi session with pre-#192 extension code. The pi docs (docs/extensions.md) load extensions at session start and apply a change only after /reload. The long-lived pi sessions on this machine started days ago. Therefore a future orchestrator_stop + orchestrator_start from one of them spawns an unwatched daemon again and silently regresses the hygiene. The dev observation was true when it was made (child self-restart at 12:46:11) and became false at 12:46:48 when the old session restarted the daemon without --watch.
- Repair during the live test (the documented recovery, from a fresh pi session with the merged extension): orchestrator_stop reported "Sent SIGTERM to orchestrator pid 758169" and freed port 4242. orchestrator_start reported "Orchestrator starting (pid 868290)". The supervisor 868290 ran the daemon child 868296 under --watch. The webui answered 200 on 4242. /api/hub reported pid 868296. Then check 4 passed. The real daemon now runs under --watch.
- Related trap for tests: `/api/hub.commit` is `currentCommit(CODE_ROOT)`, a live `git rev-parse` of the checkout (src/hub.ts line 204). It reports the on-disk HEAD, not the code the daemon loaded. Use the lock pid, its PPID and the supervisor argv to identify the running daemon.

No open questions. Evidence: /tmp/live192/{run1.sh,run3.sh,daemon.log,start-real.jsonl,stop-real.jsonl}.

# Open questions
