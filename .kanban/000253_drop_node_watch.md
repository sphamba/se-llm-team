---
name: "fix: remove node --watch from the orchestrator start path"
priority: "high"
state: "backlog"
worktree: ""
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
