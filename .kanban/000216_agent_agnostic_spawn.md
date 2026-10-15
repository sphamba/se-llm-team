---
name: "feat: agent-agnostic spawn layer for pi and claude backends"
priority: "high"
state: "reviewing"
worktree: "feat/216-agent-agnostic-spawn"
issuer: "user"
complexity: "complex"
shortName: "agent-agnostic-spawn"
blockedBy: ""
---

# Summary
The orchestrator and the efficiency-analysis tool spawn role agents through per-backend command builders: pi (unchanged) or claude (bypassPermissions, stream-json output). A host-passed --default-agent flag plus the config agent key select the backend; the pi extension passes pi as default.

# Specs
# Goal
The daemon and the efficiency-analysis tool spawn agents through a configurable backend CLI: pi or claude. The backend default comes from the host that starts the daemon. No backend is hardcoded beyond the documented fallback.

# Decisions (user interview)
- Backend selection: config key `agent` (pi or claude). Resolution order: the config `agent` key, then the host-passed default, then pi.
- Host-passed default: the daemon takes a --default-agent <name> CLI flag. The pi extension's orchestrator_start passes pi. A Claude host (later task) passes claude.
- Headless claude agents run with --permission-mode bypassPermissions. This matches pi --approve. The risk is contained to the task worktree.
- Claude agents write stream-json logs. The log renderers are a separate task. This task only builds the command.

# Changes
1. Extract the argv construction from src/orchestrator/spawn.ts into per-backend builders (for example src/orchestrator/backends.ts).
   - pi backend: argv byte-identical to today: --approve --mode json [provider/model/thinking flags] [--append-system-prompt <AGENTS.md content, 131000-byte cap>] -p <prompt>.
   - claude backend: -p <prompt> --permission-mode bypassPermissions --output-format stream-json --verbose [--model <model>] [--effort <effort>] plus the system-prompt injection (see point 3). Verify every flag name against the current claude CLI documentation (web search) before implementation. Record the verified flag set in # Notes.
2. LLM config mapping for claude: model passes through. thinking maps to --effort: low, medium, high, xhigh, max pass through; off and minimal map to low. provider is ignored for claude and stays valid for pi.
3. System-prompt injection for claude: prefer --append-system-prompt-file <path> over inline content, because it avoids the argv size cap. Inject the project AGENTS.md (same 131000-byte policy) and the role notes (.kanban/AGENTS.<role>.md). Verify whether the flag repeats. When it does not repeat, concatenate into one temporary file, or rely on the cwd symlink. State the chosen mechanism in # Notes. The worktree SPECS.md and AGENTS.md symlinks stay identical for both backends. Do not rely on claude auto-loading AGENTS.md from cwd: claude reads AGENTS.md only when no CLAUDE.md exists.
4. src/orchestrator.ts: parse --default-agent and feed it into the config resolution.
5. index.ts orchestrator_start: pass --default-agent pi to the daemon.
6. src/efficiency-analysis.ts: build the analyser command with the same backend builders. For claude, replace the pi isolation flags (--no-session --no-extensions --no-skills --no-mcp --no-tools --mode json) with the claude isolated-run equivalent (--bare plus the output-format flags; verify against current docs). Parsing of claude output is out of scope here. Until the renderer task lands, efficiency-analysis with the claude backend does not produce parsed results. State this limitation in # Notes.
7. README.md configuration table: document `agent` (values pi and claude, default by host, fallback pi).

# Constraints
- The pi backend argv stays byte-identical. Tests assert it.
- The daemon does not require the claude CLI when the backend is pi. It does not require pi when the backend is claude.
- agents/*.md role prompts stay backend-neutral: no backend-specific commands in them.
- The exit-code wrapper (sh -c '"$@" ; echo $?'), the detached spawn, the stdio wiring, and the cwd stay identical for both backends.

# Acceptance criteria
- node tests/orchestrator.test.ts passes. New cases use an argv-recording stub agent with the claude backend and assert the full claude argv: permission mode, output format, verbose, model, effort mapping, system-prompt injection, and the -p prompt. The existing pi argv assertions stay unchanged.
- node tests/efficiency-analysis.test.ts passes, with claude-backend argv cases added.
- node index.test.ts passes, extended to assert that orchestrator_start passes --default-agent pi.
- node tests/kanban.test.ts, node tests/webui.test.ts, node tests/extension.test.ts pass unchanged.

# Notes
- 2026-10-15: Implemented the agent-agnostic spawn layer. New src/orchestrator/backends.ts holds the per-backend argv builders (piSpawnArgs, claudeSpawnArgs, claudeAnalyserArgs, claudeEffort) and the Backend type ("pi" | "claude").
- 2026-10-15: Backend resolution in loadConfig(root, defaultAgent?): a config agent key that names a backend wins, then the host-passed --default-agent, then pi; any other agent value stays an executable override (stubs, custom wrappers). parseArgs accepts --default-agent; main threads it into loadConfig and logs the backend; an invalid --default-agent warns and falls back to pi.
- 2026-10-15: spawnAgent dispatches per backend. Pi argv byte-identical to the pre-backend construction (suite asserts it). Claude spawn argv: -p <prompt> --permission-mode bypassPermissions --output-format stream-json --verbose [--model <model>] [--effort <effort>] [--append-system-prompt-file <file>]. Verified against the claude CLI docs (code.claude.com): -p/--print headless with the prompt positional; bypassPermissions is a valid --permission-mode value (equivalent documented: --dangerously-skip-permissions); stream-json in print mode errors without --verbose; --model takes an alias or full id; --effort accepts low/medium/high/xhigh/max (plus ultracode), no off/minimal, so both map to low; --append-system-prompt and --append-system-prompt-file exist but the same flag does not repeat twice (from v2.1.283+ the text form and its file form can combine), so the system prompt travels as ONE file ref.
- 2026-10-15: Claude system-prompt mechanism chosen: the project AGENTS.md (same 131000-byte policy, skips with one logged warning above the cap) and the role notes .kanban/AGENTS.<role>.md are concatenated into one file .kanban/.pids/<name>.system-prompt.md at every spawn, passed as --append-system-prompt-file. Chosen over the cwd-symlink option because the flag does not repeat and claude's AGENTS.md auto-load from cwd is not relied on (claude reads AGENTS.md only when no CLAUDE.md exists). The SPECS.md and AGENTS.md cwd symlinks stay identical for both backends.
- 2026-10-15: index.ts orchestrator_start passes --default-agent pi to the daemon; the efficiency_analysis tool passes backend + the resolved llm triple to analyseLog. Efficiency-analysis AnalyseOptions: llmFlags replaced by backend + llm; buildAnalyserCommand keeps its pi shape byte-identical. Claude analyser argv: claude --bare --no-session-persistence -p <prompt> --permission-mode bypassPermissions --output-format stream-json --verbose [--model] [--effort]. --bare skips hooks, skills, commands, subagents, plugins, MCP servers and memory (the isolated-run equivalent of pi's --no-* flags; it still leaves Bash/read/edit tools, pi's --no-tools removes all). Parsing of claude stream-json output is out of scope: until the renderer task lands, efficiency-analysis with the claude backend spawns the analyser but does not produce parsed results (the pi-format analyserAnswer parser reads nothing from stream-json lines).
- 2026-10-15: Operational notes for the claude backend: --bare ignores OAuth/keychain, so agents need ANTHROPIC_API_KEY or an apiKeyHelper via --settings; --effort support depends on the model. Suite: node tests/orchestrator.test.ts gained a claude-backend part (resolution asserts, full claude argv stub case, effort mapping, cap policy), tests/efficiency-analysis.test.ts gained claude analyser argv cases, index.test.ts asserts --default-agent pi. All six test files pass.

# Open questions
- Assumption: the config agent key doubles as backend selector (pi/claude) and executable override (any other value); a future Claude host would pass --default-agent claude. The pi extension passes pi.
- Assumption: claude role agents keep session persistence (pi does the same); only the analyser runs with --no-session-persistence.
- Assumption: --permission-mode bypassPermissions for headless claude agents matches pi's --approve containment (risk limited to the task worktree); the analyser gets it too because headless claude cannot answer permission prompts.
- Assumption: claude stream-json log parsing and rendering stays a separate task; until it lands, claude-backend efficiency analysis spawns the analyser but returns no parsed results.
