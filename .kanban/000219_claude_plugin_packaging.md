---
name: "feat: Claude Code plugin and marketplace packaging"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "claude-plugin-packaging"
blockedBy: "#218"
---

# Summary
Package se-llm-team as a Claude Code plugin with a repo-hosted marketplace: plugin manifest (skill, MCP server, report-drain hooks), marketplace.json, host-neutral SKILL.md wording, and install documentation for both hosts.

# Specs
# Goal
A user installs se-llm-team into Claude Code from this repo: claude plugin marketplace add <repo git url>, then claude plugin install se-llm-team@se-llm-team. The plugin ships the PM skill, the MCP server with the 12 tools, and hook-based board report delivery. The same SKILL.md works from pi and Claude Code.

# Decisions (user interview)
- The repo itself is the marketplace: .claude-plugin/marketplace.json at the repo root.
- Board reports reach the Claude Code PM session through plugin hooks (UserPromptSubmit and SessionStart), not through the MCP server.
- Distribution is plugin plus marketplace. The manual setup stays documented as the development path.

# Changes
1. .claude-plugin/plugin.json at the repo root: name se-llm-team, version, description. Components (verify the current plugin manifest format against the claude plugin documentation, web search, and record it in # Notes):
   - skills: the existing skills/se-llm-team directory.
   - MCP server: the manifest or .mcp.json starts node <plugin-root>/src/mcp.ts.
   - hooks: hooks/hooks.json with UserPromptSubmit and SessionStart hooks that run a repo script (node, zero dependencies). The script prints pending .kanban/.reports/* files to stdout. Hook stdout becomes additional context. The script removes the drained files. The drain is race-safe against the daemon's report writer: use the same atomic approach the pi extension drain uses.
2. .claude-plugin/marketplace.json at the repo root: lists the plugin with source ./.
3. skills/se-llm-team/SKILL.md: one copy for both hosts. Remove pi-only wording, for example the subagent_type wording and any pi-only references. Phrase the fact-finding delegation host-neutrally: delegate a read-only fact-finding subagent. Keep disable-model-invocation: true.
4. README.md Setup: document both installations side by side (pi install git:..., and the two claude plugin commands), Node >= 24, no build step for either host. The docs configuration pages cover the neutral config path and the agent key.
5. Plugin version: keep plugin.json version in sync with package.json version. State the mechanism in # Notes.

# Constraints
- No new runtime dependency. The plugin works from a bare git clone with node >= 24.
- The pi installation path (pi install git:..., local symlinks) keeps working unchanged.
- The plugin ships no Claude Code subagent definitions: agents/*.md are daemon role prompts, not session subagents.
- The repo root stays clean of build artifacts.

# Acceptance criteria
- New node tests/plugin.test.ts passes: .claude-plugin/plugin.json, .claude-plugin/marketplace.json, and hooks/hooks.json parse as JSON; every path the manifests reference exists in the repo; the MCP command points at an existing file; the drain script exits 0 on an empty reports dir and drains a fixture report.
- node tests/mcp.test.ts passes. This is the server the plugin starts.
- Full suite passes: node tests/kanban.test.ts, node tests/orchestrator.test.ts, node tests/webui.test.ts, node tests/extension.test.ts, node tests/efficiency-analysis.test.ts, node index.test.ts.
- Task-specific CLI check when the claude CLI is available: in a temp HOME, claude plugin marketplace add <repo path> and claude plugin install se-llm-team@se-llm-team succeed, and a headless claude -p session in a temp git repo sees the se-llm-team tools. When the CLI is absent, record the skip in # Notes.

# Notes
