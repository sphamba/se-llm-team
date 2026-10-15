---
name: "feat: neutral shared config and hub paths with pi fallback"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "neutral-shared-paths"
---

# Summary
Move the global config file, hub registry and hub lock from ~/.pi/agent/ to ~/.config/se-llm-team/ (XDG), with read-only fallback to the legacy pi paths so existing setups keep working. Config keys and semantics stay unchanged.

# Specs
# Goal
The global config file, the hub registry file, and the hub lock file move from ~/.pi/agent/ to an agent-neutral directory. No path that the code writes depends on the pi coding agent.

# Decisions (user interview)
- Neutral directory: $XDG_CONFIG_HOME/se-llm-team/ when XDG_CONFIG_HOME is set, else ~/.config/se-llm-team/.
- Legacy fallback: the code reads ~/.pi/agent/se-llm-team.json when the neutral file is absent. The code never writes to ~/.pi/agent/.
- Config keys, defaults, and override semantics do not change. Only the location changes.

# Changes
1. src/orchestrator/config.ts (loadConfig): resolve the global config from the neutral directory first, then the legacy path, then defaults. Project-local <root>/.kanban/se-llm-team.json keeps overriding the global file. Log one line when the legacy path is used.
2. src/webui/page.ts: apply the same resolution to its copy of the config path pair.
3. src/hub.ts: REGISTRY_FILE and LOCK_FILE live under the neutral directory. On daemon start, when the neutral registry is absent and the legacy ~/.pi/agent/se-llm-team-hub.json exists, copy it to the neutral path once, best effort. Take the lock only at the neutral path. When a legacy lock file is held by a live process, log a warning that an old-code daemon may still serve the hub, then continue.
4. README.md and the docs/ configuration sections: document the neutral path, XDG_CONFIG_HOME, and the legacy fallback.

# Edge cases
- A machine with only the legacy config keeps working. No user action is needed.
- During an upgrade, an old-code daemon may hold the legacy lock. The new code takes the neutral lock and logs the warning for the overlap window.

# Acceptance criteria
- node tests/orchestrator.test.ts passes. New or extended cases use a fixture HOME and XDG_CONFIG_HOME and assert: the neutral config is read when present; the legacy config is read when the neutral file is absent; the project-local config overrides both; the hub registry migrates once from legacy; the hub lock is taken at the neutral path.
- node tests/webui.test.ts passes. The config-loading cases cover the same resolution order.
- node tests/kanban.test.ts passes unchanged.
- grep -rn '\.pi' src/ shows the legacy path only in the fallback read sites (src/orchestrator/config.ts, src/hub.ts, src/webui/page.ts). No write to a legacy path.

# Notes
