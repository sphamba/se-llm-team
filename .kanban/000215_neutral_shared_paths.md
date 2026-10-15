---
name: "feat: neutral shared config and hub paths with pi fallback"
priority: "high"
state: "done"
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

2026-10-15 developer: implemented, all suites pass.
- src/orchestrator/config.ts: the neutral global config first ($XDG_CONFIG_HOME/se-llm-team/se-llm-team.json, else ~/.config/se-llm-team/), the legacy ~/.pi/agent/se-llm-team.json read as a fallback when the neutral file is absent (existence check, one log line naming both paths), then the project-local file keeps overriding both.
- src/webui/page.ts: loadWebUiConfig applies the same resolution order to its own copy of the path pair and logs nothing.
- src/hub.ts: the registry and the election lock live at the neutral path. startHub copies a legacy registry to the neutral path once (best effort, guarded by neutral-file-absent). becomeHub warns when a live process holds the legacy lock (an old-code daemon may still serve the hub) and takes the neutral lock only. The code never writes to ~/.pi/agent/.
- index.ts: the orchestrator_start tool description names the neutral path with the legacy fallback (user-visible text, outside the src/ grep).
- README.md and docs/architecture.md document the neutral path, XDG_CONFIG_HOME and the fallback. docs/agents-and-tools.md and docs/development.md name pi's own paths and stay unchanged.
- Tests: orchestrator.test.ts part Z drives loadConfig, startHub and a live daemon against a fixture HOME + XDG_CONFIG_HOME: the neutral config read when present, the legacy fallback with its log line, the project-local override, the one-time migration with no re-copy, and the legacy-lock warning with the lock taken at the neutral path only. Parts U, V, W and Y2 moved to the neutral registry/lock paths and assert the legacy files are never written or removed. webui.test.ts covers the same resolution order for loadWebUiConfig. XDG_CONFIG_HOME is deleted at the top of both suites so the temp-HOME sections stay isolated. kanban.test.ts passes unchanged.
- npm test passes (5 suites, exit 0). The acceptance grep holds: the legacy ~/.pi path appears in src/ only in the three read sites (config.ts, hub.ts, page.ts).

Findings worth keeping:
- On this machine ~/.pi and ~/.config are read-only bind mounts. The worktree-hub part closed its in-process hub after restoring the real HOME, so the close flush hit the real config dir and crashed. It now closes before the HOME restore (this also stops a pre-existing real-registry pollution on normal machines).
- process.env.X = undefined sets the env to the string "undefined" in node, so a later in-process hub start resolved the neutral dir as the relative path undefined/se-llm-team and left that dir in the worktree. The part Z env restore deletes the variable instead (stray dir removed).

2026-10-15 reviewer: reviewed, no fixes. All three affected suites re-run and pass: orchestrator.test.ts (exit 0, part Z neutral shared paths passed), webui.test.ts (exit 0), kanban.test.ts (exit 0). Every change item and acceptance criterion verifies against the code.
- All five assumptions that stood in the Open questions section verified, so the section is empty again: the XDG_CONFIG_HOME || fallback treats unset and empty the same (the XDG spec says both mean unset); the neutral-vs-legacy choice is the existsSync check in config.ts and page.ts, not parse success; readHubRegistry reads only the neutral registry; the legacy-lock warning lives in becomeHub only, and every production hub start goes main.ts -> joinHub -> becomeHub -> startHub (a direct startHub call is tests-only, and a worktree daemon stands down before becomeHub), so hub-eligible daemons log the warning and worktree checkouts do not; the path resolution stays inline in the three files per the spec.
- The acceptance grep holds: the legacy ~/.pi path appears in src/ only at the three read sites (config.ts, hub.ts, page.ts) plus comments; the code writes to a legacy path nowhere. The other ~/.pi/agent references in the docs are pi's own paths (the extensions and skills symlinks, settings.json), correctly unchanged.
- Minor, non-blocking: migrateLegacyRegistry copies straight to the final path (copyFileSync), not through the temp+rename pattern that writeRegistry uses. In production the only reader of the neutral registry is the same process's startHub seed right after the copy, so no real reader races, and the immediate flush() rewrites the file with well-formed content. Add temp+rename only if a second reader ever appears.
- Minor, non-blocking: the HOME fallback differs (hub.ts: HOME || homedir(), config.ts and page.ts: HOME ?? ""). Each file kept its own pre-existing convention from the old legacy-path code, so this is not a regression. Align them only if a machine without HOME matters.
- No silent assumptions found: the developer voiced all of them in the Open questions section, and the notes explain the test-environment findings.

2026-10-15 merger: resolved the rebase conflict and completed the replay.
- The rebase onto 9010e77 stopped once, in tests/efficiency-analysis.test.ts during the pick of 7572eaf (test: pin the short lead-in merge of the per-block analyser). One line differed: the base branch keeps the `atPrompts.slice(0, 2)` check with the `"lead-in ["` pattern, the replayed commit restored the wider `atPrompts` check. The Specs say nothing about this test, so the base branch wins; the ours line stands. No other file conflicted and the four later commits, including the main feat commit, replayed clean. `git rebase --continue` finished, working tree clean.

2026-10-15 live-tester: live test passed, no findings.
- Config resolution (merged `loadConfig` and `loadWebUiConfig`, fixture HOME + XDG_CONFIG_HOME): the neutral file wins when present. The legacy `~/.pi/agent/se-llm-team.json` is read when the neutral file is absent and logs one line that names both paths. The project `.kanban/se-llm-team.json` overrides both per key (a neutral `pollMinutes` survives a project-local agent override). `XDG_CONFIG_HOME` unset and set to the empty string both resolve to `$HOME/.config/se-llm-team`. `loadWebUiConfig` follows the same order.
- Real daemon runs on git fixtures with a configured fake agent: a neutral config spawns the neutral agent and writes nothing under `$HOME/.pi/agent` (a sentinel file stays alone); a project-local config spawns the project agent; a legacy-only config spawns the legacy agent, logs the fallback line, and creates no neutral config file. The legacy config sha256 is unchanged.
- Real hub runs: the neutral registry and lock are under `$XDG_CONFIG_HOME/se-llm-team/`; a legacy registry with a fresh `lastHeartbeat` seeds the neutral registry once and the migrated entry shows in `GET /api/projects`; a later legacy registry change is not copied again; the legacy registry and lock sha256 are unchanged. A live legacy lock pid logs `legacy hub lock held by pid N, an old-code daemon may still serve the hub` and the neutral lock holds the daemon pid. A dead legacy lock logs no warning.
- Real upgrade path on this machine (read-only): `~/.pi/agent/se-llm-team.json` exists, `~/.config/se-llm-team/` does not, and the new code reads the legacy file and logs the fallback line (`agent=pi`).
- Legacy-only webUi config through a real daemon: `webUi.enabled` and port 4332 bind, the page answers 200, `/api/hub` answers with the merged commit.
- Acceptance grep: the literal legacy path appears in `src/` only at the three read sites (`config.ts`, `hub.ts`, `page.ts`), never in a write. `README.md` and `docs/architecture.md` document the neutral path, `XDG_CONFIG_HOME` and the fallback; `docs/architecture.md` also documents the registry migration and the lock warning.
- Assumptions: fixture HOME and XDG_CONFIG_HOME isolate every write; the migrated legacy registry entry used a fresh `lastHeartbeat` so the hub seeds it; no unit suite ran.

# Open questions

None.