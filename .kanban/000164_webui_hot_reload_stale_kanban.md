---
name: "fix: webui hot reload leaves stale kanban.ts, so pipeline-order changes need a daemon restart"
priority: "medium"
state: "done"
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

# Decision
Reload the whole graph (user's answer, 2026-10-12): the mtime-based reload version-busts/invalidates the whole webui import graph (src/kanban.ts and every other module src/webui.ts imports, e.g. src/pid.ts), so a reloaded webui.ts recomputes LAYOUT from fresh STATES. No daemon restart is needed for a kanban.ts change; the #134 dashboard-reload promise now covers kanban.ts too. The restart-based candidate direction is dropped.

1. Should the hub reload or invalidate the whole webui import graph (including src/kanban.ts), or should the daemon/hub restart after a kanban.ts change?
2. If a restart is the answer, how should it avoid SIGKILL-ing in-flight child agents (developer, reviewer, live-tester, merger)?

## 2026-10-12, developer
Implemented the # Decision in the worktree (commit 856bcf6):

- src/hub.ts webuiLoader no longer imports webui.ts with a bare ?v= query. It walks the static relative-import graph from webui.ts (webui.ts -> kanban.ts, pid.ts; pid.ts -> kanban.ts), copies the whole graph into a per-version dir .webui-hot-<pid>-<newestGraphMtime> next to the webui file, and imports the copy, so relative imports inside the copy resolve to fresh sibling modules. A kanban.ts-only change now goes live on browser reload, no daemon restart.
- The reload version is the newest mtime across the whole graph, so a kanban.ts-only change triggers the reload even though webui.ts keeps its mtime. A failed version (broken file, edit mid-write) keeps the last good module until the version changes again, the same last-good semantics as #134. Concurrent reloads serialize through one in-flight promise.
- The copy dir is removed after each import (node keeps the modules in memory) and stale .webui-hot-* dirs are swept on every reload, so the repo tree stays clean; the test cleanup also removes leftovers from a crashed run.
- webui.test.ts: a new block starts a hub on a stub webui that imports a stub kanban, rewrites ONLY the stub kanban (the webui file keeps its mtime), and asserts the next fetch serves the new states. The #134 stub test and the real-graph mtime-bump test still pass through the new copy-dir path.
- node src/webui.test.ts, src/kanban.test.ts, src/orchestrator.test.ts, src/extension.test.ts and index.test.ts all pass. kanban.ts and the daemon lifecycle are untouched.

## 2026-10-12, reviewer
Reviewed commit 856bcf6 against main (diff: src/hub.ts, src/webui.test.ts). No fixes made; the branch holds only this task's commit.

- The implementation matches the # Decision: the loader walks the static relative-import graph from webui.ts, copies it into .webui-hot-<pid>-<newestGraphMtime> beside the webui file, and imports the copy, so a reloaded webui.ts sees fresh sibling modules. The version is the newest mtime in the graph, concurrent reloads serialize through one in-flight promise, and a failed version keeps the last good module until the version changes again. The restart-based direction is gone.
- All four assumptions in the Open questions section hold against the code: the signal is mtime-based with no content hashing; coverage is webui.ts plus its static relative-import graph (kanban.ts, pid.ts) while hub.ts and orchestrator.ts still need a restart; the copy dir is transient, swept after each import, and no .webui-hot-* leftovers stayed in src after the test runs; the graph imports only node builtins and relative src modules today.
- Copy-approach safety checks pass: webui.ts, kanban.ts and pid.ts use no import.meta.url or __dirname paths, kanbanDir(root) is argument-driven, and no module in the graph dynamic-imports at call time (the ceiling the loader comment names).
- Tests run in the worktree: src/webui.test.ts with the new graph-fresh reload block, src/kanban.test.ts, src/orchestrator.test.ts, src/extension.test.ts and index.test.ts (repo root) all pass. scripts/test-changed.mjs already maps src/hub.ts to the webui and orchestrator tests.
- Minor, no action: two hub processes that share one src dir could sweep each other's hot dir mid-import; that import fails and the catch keeps the last good module. One daemon per repo in practice.

## 2026-10-12, merger
Merged in two steps, no conflicts anywhere, no fixes needed.

- Step 1: merged main (0aee405) into fix/164-webui-hot-reload-stale-kanban in the worktree (merge commit ed55fe1). Clean ort merge: main carried agents/*.md role notes, src/kanban.ts, src/orchestrator.ts and src/orchestrator.test.ts changes; the branch carries src/hub.ts and src/webui.test.ts. No overlap, so test suites were skipped per merge policy.
- Step 2: merged fix/164-webui-hot-reload-stale-kanban into main at the project root (fast-forward 0aee405..ed55fe1).
- The live test runs on merged commit ed55fe1 on the root checkout.

## 2026-10-12, live-tester
Result: PASS. No findings, no new tasks. The unit suites were not run.

Setup: the root checkout's main had moved on to merge commit 7ecec18 (task #166 merged on top); ed55fe1 is an ancestor of that HEAD, so the tested code is the merged #164 change. I cloned the merged checkout to a scratch dir (/tmp/live164/repo) and started the real daemon from there with `node src/orchestrator.ts --root /tmp/live164/root`, plus a fixture project root (`webUi: {enabled, 127.0.0.1:4488}`) and an isolated HOME. I ran the daemon from the clone, not the root checkout, because the served webui graph must be editable to simulate a STATES change and the real checkout must stay untouched. Browser flow used real Chromium through the local Playwright install (paseo/node_modules).

- Baseline (webui.ts and kanban.ts untouched): GET / serves `LAYOUT = ["backlog",["to-do","doing"],["to-review","reviewing"],["to-merge","merging"],["to-live-test","live-testing"],"done"]`; real Chromium shows to-merge at x=959 left of to-live-test at x=1269.
- Core flow: I swapped the to-merge and to-live-test pairs in the served src/kanban.ts only (src/webui.ts mtime unchanged). Without any daemon restart, a fresh browser load shows the new order: to-live-test at x=959, to-merge at x=1269, DOM column order backlog | to-do | doing | to-review | reviewing | to-live-test | live-testing | to-merge | merging | done. The reproduced backward-movement scenario is gone.
- No restart: one daemon process (pid 3809772) ran for the whole test (115s+), its log has only the two startup lines and no errors, and /api/projects kept the fixture entry.
- A card ('done probe') still renders in its column after the reloads.
- Broken file: with garbage written over src/kanban.ts, GET / still answers 200 with the last good LAYOUT, and /api/tasks and /health stay up. After a valid file with a newer mtime, the next request serves the new order (no permanent stick).
- Regression: a webui.ts-only change (page title) still reloads on the next fetch through the new copy-dir path.
- Repo hygiene: no .webui-hot-* leftovers in src after every reload, the broken-file case, and the webui.ts change.
- Cleanup: daemon killed, port 4488 down, hub lock released, isolated registry empty, scratch dirs removed. No leaked processes.
- All four stated assumptions hold against the running system: mtime is the only version signal; the graph covers kannan.ts and pid.ts; the copy dir is transient; the graph needs no node_modules.

Assumptions made by the live test: the scratch-clone run is equivalent to the root checkout because both are the same merged commit (ed55fe1 ancestor of root main 7ecec18); the fixture board's single done task is enough for the page to render.

# Open questions
No open questions: both recorded questions are answered by the # Decision above. Assumptions (confirm or correct any of these):

- The reload signal stays mtime-based: a changed mtime means changed code; no content hashing.
- Hot reload covers src/webui.ts and its whole static relative-import graph (today src/kanban.ts and src/pid.ts, plus any module they reach); hub.ts and orchestrator.ts still need a daemon restart.
- A reload transiently creates and then removes a .webui-hot-* copy dir inside the directory of the webui file; no long-lived state is added to the repo tree.
- npm/node_modules resolution in the webui graph keeps working while the graph stays inside one package (true today: the graph imports only node builtins and relative src modules).
