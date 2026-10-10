---
name: "fix: PM skill spawns a Watcher without checking for a live one; keep exactly one Watcher"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
Patch the PM SKILL.md Watcher step: before spawning a Watcher subagent, check whether one is already running (by agent ID or handle), and spawn only when none is running or the last one has finished.

# Specs
Keep exactly one Watcher running.

File: skills/se-llm-team/SKILL.md, line 35 ("## Watcher subagent" section):
- Current text: "At session start, spawn one Watcher with the Agent tool (subagent_type "watcher", run in background). Spawn a fresh Watcher again after every Watcher report; never leave it dead."
- Change to: at session start, spawn one Watcher and remember its agent ID/name. After every Watcher report, check whether another Watcher is already running before spawning: use get_subagent_result on the last known Watcher's agent ID or handle with wait=false; spawn a fresh Watcher only when no Watcher is running or the last one has finished and reported. Never leave the board without a Watcher; never run two at the same time.

Acceptance:
- The skill instructs the check-then-spawn pattern with the exact tool call (get_subagent_result, wait=false, agent ID or handle).
- Exactly one Watcher runs at any time; no duplicate or stacked watchers.

Constraints:
- Only skills/se-llm-team/SKILL.md changes. No overlap with the in-flight tasks (000029: src/webui.ts; 000034: src/orchestrator.ts, .gitignore).

# Notes
