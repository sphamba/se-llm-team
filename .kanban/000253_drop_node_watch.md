---
name: "fix: remove node --watch from the orchestrator start path"
priority: "high"
state: "live-testing"
worktree: "fix/253-drop-node-watch"
issuer: "user"
complexity: "simple"
shortName: "drop-node-watch"
---

# Summary
The orchestrator must run without a node --watch supervisor: no auto-restart on file changes, no supervisor outliving the daemon. A daemon exit or crash is final until a manual restart; UI changes apply only after a manual restart.

# Specs
Decision (user, 2026-10-16): remove the --watch. The orchestrator must be manually restarted to apply UI changes.

Problem (facts, found by the PM on 2026-10-16): orchestrator_start (src/tools.ts:230) spawns the daemon via spawn(process.execPath, ["--watch", ...orchestrator.ts...]). node --watch keeps the supervisor process alive after the daemon exits ("Waiting for file changes before restarting...") and respawns a stopped daemon on the next .kanban file write. Consequences observed live: orphaned supervisors accumulate across sessions (two found for se-llm-team, six for akantu-rs, aged 31 min to 6 h, all holding nothing but waiting to respawn); a daemon that OOM-crashes at 255 MB gets silently resurrected on the next board write; orchestrator_stop cannot fully stop the pair.

Requirements:
1. Drop "--watch" from the spawn args at src/tools.ts:230: the daemon runs as a plain node process. A daemon exit or crash is final; only a manual start brings it back.
2. Update the tool messages that describe the self-restart behavior (src/tools.ts:215-230): the running-daemon message no longer offers "stop, then start again to restore the self-restart".
3. Update the watched-supervisor detection helper (src/pid.ts:49-61, used by src/tools.ts:215): without --watch there is no supervisor, so the helper is dead code; remove it or keep it reporting false, developer's call.
4. Keep everything else unchanged: hub registration, singleton lock, poll and rescan cadences, web UI ownership.
5. State the big assumptions affecting the feature.

Acceptance:
- node tests/orchestrator.test.ts and node tests/webui.test.ts pass.
- Live test: starting the orchestrator spawns ONE process (no supervisor pair); stopping it leaves no process behind; a killed daemon stays dead until a manual start.

# Notes
- Dropped "--watch" from orchestrator_start's spawn args (src/tools.ts): the daemon is a plain detached node process. An exit or crash is final, only a manual start brings it back. UI and src changes apply on the next manual start.
- Removed the "already running without a node --watch supervisor" message branch and the now-dead orchestratorWatched helper with its only helper procPpid (src/pid.ts).
- orchestrator_stop keeps the process-group signal (unchanged behavior, comment updated): a hand-set lock pid can still name a detached group leader.
- Tests: mcp.test.ts and index.test.ts pin the new spawn args; orchestrator.test.ts part AV now asserts that a src touch restarts nothing and that one SIGTERM clears the lock; a webui.test.ts comment lost the watch clause. Ran node tests/mcp.test.ts, node index.test.ts, node tests/orchestrator.test.ts (55 smokes) and node tests/webui.test.ts: all pass.
- Live check (temp root, isolated HOME and XDG_CONFIG_HOME, git repo, done task): the tool start spawned one process (lock pid 1823885, cmdline without --watch, ppid 1, no supervisor pair); the tool stop left no process and cleared the lock; kill -9 stayed dead across a .kanban board write; a manual start brought the daemon back.
- Four --watch supervisors from earlier sessions (se-llm-team x2, akantu-rs x2) still run in the main checkout. This change stops new ones only.
- Review at 38dad90: specs 1-2 settled by the diff (spawn args plain, warn branch gone); spec 3 settled by grep (no orchestratorWatched or procPpid consumers left); spec 4 settled by the diff (hub registration, singleton lock, poll cadences untouched). Ran index.test.ts, mcp.test.ts, orchestrator.test.ts, webui.test.ts: all exit 0. The first orchestrator run flaked at the per-role notes mirror check (a part the diff does not touch); the second run passed clean. Fixed the garbled index.test.ts comment (duplicate fragment plus a stale warning reference) in 38dad90.


