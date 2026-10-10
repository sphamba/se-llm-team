---
name: "fix: default pollMinutes is 15, set it to 1 minute"
priority: "medium"
state: "done"
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

- Changed DEFAULT_POLL_MINUTES 15 -> 1 in src/orchestrator.ts (line 19) and the `pollMinutes` default in the README config table. No other files touched.
- Verified: all 3 test files pass (node --test src/kanban.test.ts src/orchestrator.test.ts src/webui.test.ts). Runtime check in a throwaway temp root with no config file: startup log reads `poll=1min`. Precedence untouched (CLI --poll-minutes > config > default).
- Committed 282fff5 on branch fix/default-pollminutes-is-15-set-it-to-1-minute.
- Review (282fff5): no fixes needed. Diff touches only src/orchestrator.ts (DEFAULT_POLL_MINUTES = 1) and the README config table row; precedence code (parseArgs/loadConfig) untouched. All 3 test files pass. Independent runtime check in a throwaway temp root with no config file confirmed the startup log reads `poll=1min`. README example config still shows an explicit `pollMinutes: 15` — a user-set value in an example, not a default claim, so left as-is per the constraint.
- Live test (282fff5, worktree fix/default-pollminutes-is-15-set-it-to-1-minute): PASS. Ran the daemon from the worktree in throwaway temp roots like a user. (1) No config file, fresh empty HOME: startup log reads `poll=1min`. (2) Project .kanban/se-llm-team.json with pollMinutes: 2: reads `poll=2min`. (3) CLI --poll-minutes 7 on top of config 2: reads `poll=7min`. Precedence CLI > config > default holds. All 3 test files pass (node --test src/kanban.test.ts src/orchestrator.test.ts src/webui.test.ts). No issues found, no new tasks needed.
