---
name: "feat: agent-agnostic spawn layer for pi and claude backends"
priority: "high"
state: "doing"
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
