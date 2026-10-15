---
name: "feat: Claude Code plugin and marketplace packaging"
priority: "high"
state: "done"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "claude-plugin-packaging"
blockedBy: ""
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

- Plugin manifest format verified against the current Claude Code docs (manifest reference, marketplace reference, components, hooks pages, retrieved 2026-10): components auto-discover from the conventional paths, so plugin.json declares identity only. skills/<name>/SKILL.md is auto-scanned (frontmatter supported, disable-model-invocation: true included); .mcp.json at the plugin root auto-loads the mcpServers stdio entry; hooks/hooks.json auto-loads with a required top-level "hooks" wrapper (UserPromptSubmit takes no matcher, SessionStart without one fires for every session kind). ${CLAUDE_PLUGIN_ROOT} expands in hook and MCP stdio command/args. Exit 0 plain-text stdout on both hook events is added to context directly, no JSON envelope needed (10k-char cap; over-cap output is not truncated, it is saved to a file in the session directory and replaced with its path plus a 2k-char preview).
- Report drain parity with pi: hooks/drain-reports.ts imports REPORT_MAX_AGE_MS and reportsDir from src/orchestrator/report.ts, so the 1h delivery cutoff is one knob across the pi drain, the daemon prune and the hook drain. The race guard is the same claim-by-rename the pi extension drain uses (the daemon writer renames a tmp file into place; the hook renames the report to <file>.claiming before printing), so a partial write is never claimable and concurrent consumers never double-drain.
- Version sync: package.json gains its first version field (0.1.0; the MCP server previously fell back to 0.0.0) and plugin.json mirrors it. The mechanism is the test, not a build step: tests/plugin.test.ts asserts the equality, so a drift fails the suite.
- The plugin ships no session subagents: plugin.json sets "agents": [], the manifest key the docs say replaces the agents/ scan. The docs do not state whether an empty array counts as set, so tests/plugin.test.ts asserts it and the upgrade path is moving the role prompts out of agents/ if a future CLI treats [] as unset.
- README Setup documents both hosts side by side (pi install git:..., the two claude plugin commands, a shared Node >= 24 no-build note); the manual .mcp.json stays documented as the development path.
- tests/plugin.test.ts covers the acceptance list (the three manifests parse as JSON, every referenced path exists, the MCP command points at an existing file, the drain exits 0 on an empty reports dir and drains a fixture report) plus the stale-report drop and the no-claim-left-behind check. Wired into npm test and test-changed (rules for .claude-plugin/, hooks/, .mcp.json; the test-changed ALL list also gained the mcp and plugin suites it was missing).
- Full suite passes: npm test exit 0 (plugin, mcp, kanban, orchestrator, webui, extension, efficiency-analysis, index).
- Claude CLI check skipped: the claude CLI is not installed on this machine and there is no Anthropic auth (the same park as the #221 smoke run). When available: temp HOME, claude plugin marketplace add <repo path>, claude plugin install se-llm-team@se-llm-team, then claude -p in a temp git repo to see the tools.
- SKILL.md is one copy for both hosts: the pi-only "(subagent_type subagent)" wording is gone, the fact-finding delegation reads "delegate a read-only fact-finding subagent", disable-model-invocation: true kept. In Claude Code the skill invokes as /se-llm-team:se-llm-team.
- Review pass (2026-10): the Notes claims re-verified against code.claude.com/docs (plugins-reference, marketplace-reference, hooks, mcp, skills, cli-reference) and the full suite re-run in the worktree (npm test exit 0, all eight suites, plugin and mcp included). Fix made: README marketplace add command corrected to the documented owner/repo shorthand (bare github.com/owner/repo without scheme is not a documented form; the CLI hint says "Try: owner/repo, https://..., or ./path"). Confirmed: the agents manifest key exists ("Path, or array of paths. Directories aren't accepted. Replaces the default agents/ scan"), the empty array stays docs-silent as parked above; SessionStart fires on startup, resume, clear, compact and fork; the "./" marketplace source fits the documented ./-prefix rule; plugin skills invoke as /plugin-name:skill-name; the plugin .mcp.json example in the docs omits "type", but explicit "type": "stdio" is the standard scoped-server form and docs-silent, no change made.
- Known dev-path wart, no change made: ${CLAUDE_PLUGIN_ROOT} is plugin-scope only, so opening this repo itself as a Claude Code project loads the repo .mcp.json as project config where the variable does not expand and the in-repo server fails to start; the documented dev path is manual registration (README, MCP server section).
- Review pass 2 (2026-10): re-verified the hook and manifest claims against the current docs (hooks reference, plugin manifest reference, marketplace reference). Confirmed: the `args` array on a hook handler is the documented exec form (command resolved on PATH, spawned directly with args, no shell), and ${CLAUDE_PLUGIN_ROOT} substitutes into command and into each args element; exit 0 plain-text stdout on UserPromptSubmit and SessionStart is added to the context; the 10k cap saves over-limit output to a file with a 2k preview; UserPromptSubmit has no matcher support and SessionStart fires on startup, resume, clear, compact, fork. Manifests: identity-only plugin.json is valid (the manifest is optional, components auto-discover), marketplace.json carries the required name, owner and plugins, the "./" plugin source fits the relative-path rule, and the entry omits version so plugin.json's version wins with no validate warning. Fix made: the webui suite's finished-run fixture derived its parsed last - first from two separate Date.now() calls; under load the calls straddle a millisecond boundary, the exact 5000 assertion failed (observed 5001 in a full-suite run). The fixture now derives both timestamps from one base. Full suite re-run in the worktree: npm test exit 0, all eight suites. The claude CLI is still absent, the skip stands.
- Live test (2026-10-15, merged bb2ea59): the change was exercised from a bare `git clone` of the worktree with no `node_modules`, because the marketplace installs the repo as the plugin root. The unit suites were not run (developer and reviewer gate). The claude CLI is absent on this machine, so the task-specific install check (claude plugin marketplace add, claude plugin install, headless claude -p tool discovery) was skipped, as the acceptance criteria allow. Tested surfaces: (1) manifest resolution from the marketplace source "./" to the plugin root. plugin.json, marketplace.json, hooks/hooks.json and .mcp.json parse. Every ${CLAUDE_PLUGIN_ROOT} path exists. plugin.json version 0.1.0 equals package.json 0.1.0. agents is []. (2) The drain hook, run as the host runs it (node <plugin-root>/hooks/drain-reports.ts with cwd = the project root). Exit 0 and no output on an empty or missing reports dir. A fresh report written by the real daemon writer (writeReport) prints byte for byte and is removed. Two reports print oldest first. A report older than 1 h is dropped. A writer tmp file is never claimed. Four concurrent hooks x 10 reports drain each report exactly once with no claim left behind. A run from a subdirectory is a no-op, and the reports stay at the root. (3) The plugin's own MCP argv (node <plugin-root>/src/mcp.ts with cwd = a fixture repo). initialize echoes 2025-11-25 and 2025-06-18 and falls back to 2025-11-25 for an unknown version. serverInfo.version is 0.1.0 (the version-sync change). tools/list serves the 12 registry tools (efficiency_analysis included, orchestrator_wait does not exist by design). kanban_create writes the task file on disk, and stdin close exits 0. (4) The pi path unchanged: pi -p -nt --no-session from a scratch directory delivers the merged SKILL.md and quotes "Delegate a read-only fact-finding subagent", and the main checkout's skills/se-llm-team/SKILL.md is byte-identical to the worktree copy. The tested surfaces had no failures. One finding: src/mcp.ts:16 still says "the repo's package.json carries no version field, 0.0.0 is the fallback", but the version field now exists, so the comment is stale (reported as a new task). Live-test assumptions: the hook and MCP server root is the session cwd (the Specs' assumption), the marketplace source "./" resolves to the repo root, and ${CLAUDE_PLUGIN_ROOT} expands to the installed plugin directory. Real claude CLI behavior (schema validation, marketplace install, hook context injection) stays unverified until the CLI is available.

# Open questions

None. Assumptions made during implementation, for the PM and the user to confirm:
- The marketplace name is "se-llm-team" (the marketplace.json name field), so the install resolves as claude plugin install se-llm-team@se-llm-team, matching the Specs' flow.
- The plugin version starts at 0.1.0: package.json gains its first version field and plugin.json mirrors it.
- The drain hook reads reports from the session cwd, the same root rule as the MCP server: a Claude Code session drains reports only when started at the repo root.
- SessionStart drains on every session kind and UserPromptSubmit on every prompt; a report drained once never comes back.