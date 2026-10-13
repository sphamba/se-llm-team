---
name: "fix: poll false-bounces the second task in the merging state"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#187"
complexity: "simple"
shortName: "merger-poll-misattribution"
---

# Summary
With two tasks in the merging state, src/orchestrator/liveness.ts attributes the shared .pids/merger.exit to the first task and crash-bounces the second, which gets a false dead marker and dead-count increment even though its merger exited 0. Both tasks still reach to-merge, but the false death record is user-visible and counts toward RESPAWN_CAP.

# Specs
Symptom: with two conflicted to-merge tasks, one poll pass logs for task A "agent exited 0, merging -> to-merge" and for task B "agent pid=0 dead without state update, merging -> to-merge", although task B's merger resolved its merge and exited 0. The poll writes .kanban/.logs/B.merger.0.dead and bumps B's dead counter (clearDeadStreak later logs "run completed, cleared the dead-agent counter" for B only). Root cause: spawnAgent stores the merger pid and exit under the global .kanban/.pids/merger.pid and .kanban/.pids/merger.exit (pidName "merger"), and the poll's dead-pid branch maps every "merging" task to that pair; it clears the exit file after the first task. The stall check already guards with getMergerLogSlug() === slug. Two tasks can be in "merging" at once because the "at most one merger" guard only prevents two live merger processes.

Required behavior: with two tasks in the merging state and one merger at a time, each task must get the outcome of its own merger, and no task may get a false death record.

Fix sketch (developer decides the exact shape): in the poll, handle a merging task only when it is the current merger's task (same getMergerLogSlug() === slug guard as the stall check) and leave the other merging tasks for the sweep, OR keep the merger's slug next to its pid/exit file and match it.

Acceptance: (1) node tests/orchestrator.test.ts passes with a new case: two conflicted to-merge tasks, one merger at a time; after both mergers end, both tasks are in to-merge, no .logs/<slug>.merger.N.dead marker exists for the task whose merger exited 0, its <slug>.dead.count stays 0, and the log contains no "dead without state update" line for it. (2) node tests/kanban.test.ts and node tests/webui.test.ts stay green. (3) Live check: two conflicted merges queued at once produce no false dead line, no .dead marker and no dead-count bump.

Evidence is in /tmp/lt187 (fixture repo, log .kanban/.logs/orchestrator.log around 2026-10-13T08:37:42Z, calls.jsonl, and the task file's live-test report).

# Notes
