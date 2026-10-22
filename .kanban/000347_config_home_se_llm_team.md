---
name: "feat: move the global config and hub files to ~/.se-llm-team"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "config-home-se-llm-team"
---

# Summary
All global state moves to the fixed directory ~/.se-llm-team: config.json, hub.json and hub.lock. The project config moves to <root>/se-llm-team.json. The XDG path, the ~/.pi/agent fallback, the .kanban config layer and the legacy hub migration are removed. Delivered on main in commit 3415fa4.

# Specs
## Delivered

Commit 3415fa4, on main at HEAD.

## Needs

- `globalConfigPath()` returns `~/.se-llm-team/config.json` (src/orchestrator/config.ts:93-95).
- The project config is `<root>/se-llm-team.json`. The `.kanban/se-llm-team.json` layer is gone (config.ts:93-95).
- The hub writes `hub.json` and `hub.lock` in `~/.se-llm-team` (src/hub.ts:44-45, :72-75).
- The read order is the global file, then the project file. A missing or a malformed file is ignored and does not crash the daemon (config.ts:114-127).
- The merge is deep. It skips the keys `__proto__`, `constructor` and `prototype` (config.ts:97-110).
- An unwritable `~/.se-llm-team` never kills the daemon. The log names EACCES and the path (tests/orchestrator/config.test.ts part Z2).
- No legacy path is read: `neutralConfigPath`, `legacyConfigPath`, the XDG lookup, the `~/.pi/agent` fallback and `migrateLegacyRegistry` are deleted.
- The webui layer reads the config through the shared `readConfigFiles` (src/webui/page.ts:22-25).
- README.md:97, :108-110, :127-129; docs/architecture.md:22, :26, :28; skills/se-llm-team/SKILL.md:18.

## Constraints

- There is no automatic migration. A user with an old file at `~/.config/se-llm-team/config.json` or at `~/.pi/agent/se-llm-team.json` moves it by hand.
- The path is fixed. `XDG_CONFIG_HOME` has no effect.
- This change supersedes the storage paths of tasks #215 and #220. Their done text still names the old directory. Board hygiene only.

## Acceptance

- `node tests/orchestrator/config.test.ts` exits 0. Part Z pins the global read, the project root override, the deep-merge sibling survival, the `hub.json` path and the absent legacy migration. Part Z2 pins the unwritable-directory case.
- `node tests/webui/hub.test.ts` exits 0. It pins the `webUi` precedence and the ignored legacy paths.
- `grep -rn "XDG_CONFIG_HOME\|neutralConfigPath\|legacyConfigPath\|migrateLegacyRegistry" src/` returns no match.
- `pnpm test` exits 0.

# Notes
