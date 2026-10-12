---
name: "fix: webui hot reload leaves stale kanban.ts, so pipeline-order changes need a daemon restart"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#157"
complexity: "moderate"
shortName: "webui-hot-reload-stale-kanban"
---

# Summary
After a STATES or pipeline-order change merges, the running hub serves the new webui.ts with the old kanban.ts, so the live dashboard keeps the old layout until a daemon restart; the dashboard reload promise from #134 does not hold for kanban.ts.

# Specs
Found in the live test of #157 (merge commit 42b6e50). Verified against main at that commit.

# Reproduction

1. With a daemon/hub already running, change the STATES order in src/kanban.ts (e.g. apply the #157 reorder) so src/webui.ts would compute a different LAYOUT.
2. Hard-reload the browser on the hub page (e.g. http://localhost:4242).
3. Observed: the page keeps the OLD column order. A task that goes reviewing -> to-merge -> to-live-test still moves backwards on the live board even though the merged code produces the new order; only a daemon restart applies it.

# Evidence (live test of #157, 2026-10-12)

- Production hub http://localhost:4242, daemon pid 3381383 started 13:31:13, before the #157 merge commit 42b6e50 at 13:37:07.
- The served page carries the NEW accent class order from the merged src/webui.ts (.c-to-merge at src/webui.ts:1180 before .c-to-live-test at src/webui.ts:1182), which proves the #134 loader DID re-import webui.ts.
- The served LAYOUT is still the OLD one: ["backlog",["to-do","doing"],["to-review","reviewing"],["to-live-test","live-testing"],["to-merge","merging"],"done"].
- A real Chromium load of http://localhost:4242 shows to-live-test/live-testing at x=948 and to-merge/merging at x=1258 (old order); a card going reviewing -> to-merge -> to-live-test moves backwards.
- A freshly started daemon on the merged checkout (isolated root, isolated HOME) serves the correct order (to-merge/merging x=948 before to-live-test/live-testing x=1258) and a scratch card moved rightward: reviewing x=638 -> merging x=948 -> live-testing x=1258.

# Root cause

src/hub.ts:52 reloads the webui with a version query on the file mtime only: `await import(`${pathToFileURL(path).href}?v=${mtime}`)`. The reloaded src/webui.ts keeps its static `import { ... STATES ... } from "./kanban.ts"` (src/webui.ts:4), which resolves to the unversioned, already-cached kanban.ts, so the fresh webui.ts recomputes `LAYOUT = pairLayout(STATES)` (src/webui.ts:802) from the stale STATES.

# Scope of #134

#134 (done) deliberately scoped the hot reload to src/webui.ts only. Its own record names hub.ts changes as still needing a daemon restart, and its review claim that an mtime bump re-imports "the real module graph" does not hold for kanban.ts. The dashboard reload promise ("webui changes go live on browser reload without a daemon restart") therefore does not cover a STATES or pipeline-order change.

# Candidate directions (not decided; see Open questions)

- Version-bust / invalidate the whole webui import graph, at least src/kanban.ts (and any other module webui.ts imports, e.g. src/pid.ts), so a reloaded webui.ts sees the new STATES.
- Or make a kanban.ts change trigger a safe hub/daemon reload instead of an in-process re-import.

# Extra impact (restart)

Applying a fix to the running dashboard needs a daemon restart. The live tester judged the restart unsafe because the production daemon owned its live-test session as a child process. Note added at task creation, checked against main 42b6e50: since #125 agents are spawned detached with the log fd owned by the child (src/orchestrator.ts:277-286) and the daemon's exit handler SIGKILLs only in-flight push children (src/orchestrator.ts:1361-1364), so the restart-kills-in-flight-agents premise should be re-verified before designing around it.

# Acceptance

The reproduced scenario no longer needs a daemon restart to serve the new pipeline order: after a STATES/pipeline-order change, a browser reload on a running hub shows the new order (or the agreed alternative resolution holds). A test covers the reload path across the kanban.ts dependency, and `node src/webui.test.ts` passes (plus src/orchestrator.test.ts if the daemon lifecycle is touched, and src/kanban.test.ts if kanban.ts changes).

# Notes

# Open questions
1. Should the hub reload or invalidate the whole webui import graph (including src/kanban.ts), or should the daemon/hub restart after a kanban.ts change?
2. If a restart is the answer, how should it avoid SIGKILL-ing in-flight child agents (developer, reviewer, live-tester, merger)?
