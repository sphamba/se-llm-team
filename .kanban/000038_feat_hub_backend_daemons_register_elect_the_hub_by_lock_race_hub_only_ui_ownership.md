---
name: "feat: hub backend; daemons register, elect the hub by lock race, hub-only UI ownership"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Hub inside a daemon process: daemons register on spawn, the hub is elected with a lock file race, the registry is one hub-written file, failover re-elects on hub death, and non-hub daemons stop serving HTML.

# Specs
Hub backend (design settled by the grill interview).

Facts:
- Today: one orchestrator daemon per project; the in-process webui serves only its own board on the webUi port; config ~/.pi/agent/se-llm-team.json {agent, pollMinutes, webUi{enabled,host,port}}; the daemon already uses a lock file (.kanban/.orchestrator.lock) and .kanban/.pids/ for liveness.
- Board files live in each project's .kanban/ and are read from disk per request.

Changes (src/hub.ts new, src/orchestrator.ts wiring, tests):
1. src/hub.ts: hub logic that runs inside a daemon process. Serves the tabbed UI and all APIs on the webUi host/port from the existing webUi block.
2. Registration: POST /register {name (repo basename), root} and POST /heartbeat {name}; a daemon retries until accepted; heartbeat about every 5s. GET /health answers ok.
3. Registry: one file, e.g. ~/.pi/agent/se-llm-team-hub.json, written ONLY by the hub, atomic rename (temp file + rename), one entry per registered project {name, root, start, lastHeartbeat}. Entries with a heartbeat older than about 15s are dropped when the file is rewritten. Any daemon can read the file for the alive-daemon list.
4. Election: at daemon startup, when webUi.enabled and no hub answers GET /health, the daemon races for a shared hub lock file (e.g. ~/.pi/agent/se-llm-team-hub.lock) with create-exclusive semantics; the winner starts the hub in-process; losers stand down, register with the winner, and retry until accepted.
5. Failover: daemons poll /health about every 5s. On repeated failures (about 2 in a row), a daemon re-runs the election; the new hub reads the registry file, serves the UI, ages out stale entries, and re-registers itself.
6. Hub only: the hub owner serves HTML; non-hub daemons do not serve HTML. One port, one UI.
7. Board reads: the hub serves /api/tasks?project=NAME from the registered root (board files + pids for liveness) and /api/projects listing registered projects. Reject unknown projects.
8. Tests: election race picks one winner; registry file is written atomically with one entry per project; stale entries drop; /api/tasks?project serves the right board; health and heartbeat work. All tests pass.

Constraints:
- Files: src/hub.ts (new), src/orchestrator.ts, orchestrator tests.
- HOLD behind 000034 (board mirror, doing): both rewrite src/orchestrator.ts startup and commit paths.

# Notes
