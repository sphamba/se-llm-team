---
name: "fix: default pollMinutes is 15, set it to 1 minute"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The daemon's default agent liveness poll interval is 15 minutes (DEFAULT_POLL_MINUTES, src/orchestrator.ts:19). Set the default to 1 minute so a dead agent is retried quickly even with no config file.

# Specs
Change the built-in default poll interval from 15 minutes to 1 minute.

Changes:
- src/orchestrator.ts line 19: DEFAULT_POLL_MINUTES = 15 → DEFAULT_POLL_MINUTES = 1.
- README.md config table: the `pollMinutes` row default `15` → `1`.

Keep the precedence unchanged: CLI --poll-minutes overrides the config file, which overrides the default (parseArgs + loadConfig need no change).

Acceptance:
- With no config file, the daemon startup log line reads poll=1min.
- Existing tests pass: they set pollMinutes explicitly (0.05), so no test change is expected.

Constraints:
- Only src/orchestrator.ts (the constant) and README.md change.

# Notes
