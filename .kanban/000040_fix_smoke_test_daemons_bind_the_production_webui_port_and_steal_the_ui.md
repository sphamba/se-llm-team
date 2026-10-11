---
name: "fix: smoke test daemons bind the production webui port and steal the UI"
priority: "medium"
state: "done"
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

- src/orchestrator.ts: added a `--no-webui` CLI flag and a `SE_LLM_TEAM_NO_WEBUI` env override (values "1"/"true"); when set, main() skips the webui start entirely and logs "web ui disabled (no-webui)". Usage line mentions the flag.
- Hardening: a webui bind failure now logs "web ui failed to start on <host>:<port> (port taken by another webui?), continuing without it" so EADDRINUSE is diagnosable. startWebUi's resolve-null contract is unchanged.
- src/orchestrator.test.ts: runDaemon and the second-start spawn now set SE_LLM_TEAM_NO_WEBUI=1, so test daemons are hermetic. New part S covers both override paths against a global-config-shaped HOME (webui enabled on a fixed port) and asserts no "web ui on"/"web ui failed" lines.
- agents/developer.md: added a smoke-test line: start smoke daemons with `--no-webui` (or SE_LLM_TEAM_NO_WEBUI=1).
- Verified live with the real global config: flag and env paths log "web ui disabled (no-webui)" and never touch 4242; a daemon without the override while 4242 is taken logs the new port+hint message; the production webui still serves 200. orchestrator.test.ts, webui.test.ts, kanban.test.ts all pass.
- Note on the HOLD: 000034 is done; 000038 (hub backend) is still in backlog and rewrites src/orchestrator.ts, so the merge may conflict there. The change is small (one arg, one env check, one log line).
- Review (2026-10-11): implementation matches the Specs. Flag + env override skip the webui start; the bind-failure log names host:port with the taken-port hint; the usage line mentions the flag; agents/developer.md tells smoke daemons to use `--no-webui`; runDaemon and the second-start spawn in orchestrator.test.ts are hermetic. webui.test.ts's daemon spawn deliberately tests webui startup on ephemeral port 0 and correctly does not get the override (setting it would defeat that test's own assertion), so no change there.
- Reviewer re-verified live from the worktree: `--no-webui` with the real global config logs "web ui disabled (no-webui)", touches nothing on 4242, and the production webui still serves 200. Full suite passes (orchestrator.test.ts, webui.test.ts, kanban.test.ts).
- One fix committed (aae03f6): part S never pushed `homeS` into `cleaned`, so a failed assert or timeout in part S leaked the temp home dir in /tmp. Now pushed; suite re-run passes.
- Re-review (2026-10-11): no new issues. Verified end to end: `--no-webui` flag + `SE_LLM_TEAM_NO_WEBUI` ("1"/"true", case-insensitive) skip the webui start with the "web ui disabled (no-webui)" log; bind failure names host:port with the taken-port hint; the usage line mentions the flag; agents/developer.md tells smoke daemons to use the override; runDaemon and the second-start spawn in orchestrator.test.ts are hermetic; part S covers both paths against a global-config-shaped HOME (webui enabled on 4277) and cleans up both temp dirs (aae03f6 verified). webui.test.ts's daemon spawn keeps no override on purpose (it tests webui startup on port 0).
- Re-review live checks: flag path with the real global config logs "web ui disabled (no-webui)" and touches nothing on 4242; port 4242 is held only by the production daemon (extensions install, main repo root). Suite passes: kanban.test.ts, webui.test.ts, orchestrator.test.ts (part S included). HOLD check: 000034 done, 000038 still in backlog, so a future merge may conflict in src/orchestrator.ts as already noted.
- Live test (2026-10-11, worktree at aae03f6): all flows pass, no issues found. Smoke daemons ran from the worktree against temp roots.
  - `--no-webui` with the real global config: logs "web ui disabled (no-webui)"; 4242 stayed bound by the production daemon only; the production webui served 200 before and after.
  - `SE_LLM_TEAM_NO_WEBUI=1` and `True` (case-insensitive): same result, no listener on 4242.
  - No override while 4242 is taken: logs "web ui failed to start on 0.0.0.0:4242 (port taken by another webui?), continuing without it" (the new diagnosable message) and does not steal the port.
  - Normal bind path with the new code (temp HOME, webui on free port 4288, no override): logs "web ui on http://127.0.0.1:4288", serves 200 while alive, and a SIGTERM stop exits cleanly and releases the port. The production daemon's path still binds normally.
  - Usage line shows `[--no-webui]`; agents/developer.md tells smoke daemons to use the override.
  - Suite passes: kanban.test.ts, webui.test.ts, orchestrator.test.ts (part S included).
  - Note: an early check showed port 4288 still bound after a stop, but the kill had targeted the wrong pid (test-harness artifact, not a product bug). A correct SIGTERM exits cleanly and releases the port.
  - Two smoke daemons from other agents' orchestrator.test.ts runs ran in parallel and did not touch 4242: the hermetic fix works in practice.
