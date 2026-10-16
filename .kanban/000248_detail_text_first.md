---
name: "fix: serve task detail text before heavy history"
priority: "critical"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "detail-text-first"
---

# Summary
Split the per-task detail read so the task text renders from a light read of the task .md file with no log parsing in that path; agent/doctor history and log stats load in a follow-up fetch. The hub's HTTP handlers must stop letting a synchronous heavy parse block every other client.

# Specs
Problem (facts, measured by the PM probe on 2026-10-16): taskDetail (src/webui/payload.ts:514) builds body + agentHistory (payload.ts:98) + doctorHistory (payload.ts:143) in ONE response, so the task text cannot render until every run log AND every doctor log is parsed; task #242 carries 3 doctor logs (26.8+9.5+4.8 MB) plus 4 run logs. Measured cold: 0.41-1.09 s per detail open; warm 4-21 ms. Parsing runs synchronously in the hub's HTTP handler (src/hub.ts), so one heavy parse blocks all clients. The client polls at 1 s cadence while a live run re-parses its parent log whole every second, so every detail open queues behind constant heavy parses.

Requirements:
1. A light task-detail read serves body, sections and attributes without parsing any log; the text shows as soon as it lands, on every open including the first open after a daemon restart.
2. Agent history, doctor history and log stats load in a follow-up fetch after the text shows; the client renders them when they arrive (loading state per #243's lifecycle).
3. The hub's request handling must not let a synchronous heavy parse delay other clients' responses (async handling or yielding), so a heavy parse never stalls a concurrent /api/tasks poll.
4. Fix forward on the #242 light-rows architecture (user decision 2026-10-16); no revert of #242/#243/#245.
5. No numeric performance bar (user decision 2026-10-16): the live test judges by feel that nothing hangs for seconds. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui.test.ts passes (task-specific suites: also node tests/orchestrator.test.ts when src/hub.ts changed).
- Live test: opening a task shows its text fast on every open, including the first open after a daemon restart and while a live run polls; the heavy history appears after without blocking the text.

# Notes
