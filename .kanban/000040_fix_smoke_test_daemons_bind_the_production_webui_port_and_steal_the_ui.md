---
name: "fix: smoke test daemons bind the production webui port and steal the UI"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Smoke-test runs read the global config, so their webui binds the production port 4242 and wedges the real UI (the real daemon starts "continuing without it"). Smoke runs must disable the webui or bind an ephemeral port.

# Specs
Stop smoke runs from stealing the production webui port.

Observed live (2026-10-10): while the 000030 Developer smoke-tested, its daemon (started from the worktree with --root /tmp/orch-smoke-wMFBzN) read the global config (~/.pi/agent/se-llm-team.json, webUi enabled, host 0.0.0.0, port 4242) and bound the production port. The real daemon then started with "web ui failed to start, continuing without it", and the browser showed the smoke root's fake board on 4242.

Changes:
1. src/orchestrator.ts: add a way to disable the webui for smoke runs, e.g. a --no-webui CLI flag and/or a SE_LLM_TEAM_NO_WEBUI env override; when set, the daemon skips the webui start entirely.
2. agents/developer.md: the smoke-test procedure says to start smoke daemons with the flag (and any other place the repo starts test daemons: the test helpers in src/*.test.ts).
3. Optional hardening: when the webui bind fails (EADDRINUSE), log the blocking cause clearly (port and hint) so the failure is diagnosable.

Acceptance:
- A smoke run with the flag starts no webui and never touches port 4242.
- The production daemon's webui still binds normally.
- Existing tests pass.

Constraints:
- Files: src/orchestrator.ts, agents/developer.md, test helpers.
- HOLD behind 000034 (board mirror, doing) and 000038 (hub backend): both rewrite src/orchestrator.ts.

# Notes
