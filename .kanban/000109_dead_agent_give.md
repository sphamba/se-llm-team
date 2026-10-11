---
name: "fix: dead-agent give-up log fires only on exact equality - a second death streak stays silent"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#65"
---

# Summary
The dead-agent counter in the orchestrator poll loop logs its one-time "giving up" message only when the counter first crosses RESPAWN_CAP + 1. The counter is never reset, so a task that goes through a second death streak (after user intervention) gets a silent give-up: the poll keeps skipping respawn and transition without any message.

# Specs
Found during the review of task 000065 (push-warning counter). Evidence:

- src/orchestrator.ts, poll loop (~lines 828-831): `if (bumpCounter(root, `${slug}.dead`) > RESPAWN_CAP) { if (readCounter(root, `${slug}.dead`) === RESPAWN_CAP + 1) log("... giving up ..."); continue; }` - the give-up message fires only on the first poll past the cap.
- The `${slug}.dead` counter is never reset anywhere (grep confirms no reset or unlink), so after the first give-up for a task, a later death streak (user fixes the agent, respawns the task, agent dies again) bumps the counter past RESPAWN_CAP+1 and the give-up is silent: the poll keeps skipping respawn and transition with no message.
- Same class of bug as 000065: one-shot log gated on exact equality against a counter that only grows.

Suggested fix: keep a once-per-streak marker (like the push-warned marker from 000065), or reset the dead counter when the task successfully respawns, and log the give-up on every streak that crosses the cap.

Priority low, type fix.

# Notes
