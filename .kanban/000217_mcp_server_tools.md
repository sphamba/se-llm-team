---
name: "feat: MCP server exposing the kanban and orchestrator tools"
priority: "high"
state: "live-testing"
worktree: "feat/217-mcp-server-tools"
issuer: "user"
complexity: "complex"
shortName: "mcp-server-tools"
blockedBy: ""
---

# Summary
A zero-dependency stdio MCP server (src/mcp.ts) exposes the 12 kanban/orchestrator tools to Claude Code. The tool handlers move from index.ts into a shared module that both the pi extension and the MCP server call. The MCP server's orchestrator_start passes the claude default to the daemon.

# Specs
# Goal
Claude Code sessions get the 12 se-llm-team tools through a zero-dependency stdio MCP server. The pi extension keeps its behavior unchanged.

# Decisions (user interview)
- The MCP server is hand-rolled stdio JSON-RPC. No @modelcontextprotocol/sdk. The repo stays dependency-free and runs from a bare clone.
- Board reports do not travel through the MCP server. Plugin hooks deliver them (separate task).

# Changes
1. Shared tool handlers: move the execute bodies and the parameter schemas of the 12 tools (kanban_list, kanban_get, kanban_create, kanban_update, kanban_set_state, kanban_set_worktree, kanban_delete, orchestrator_start, orchestrator_status, orchestrator_poke, orchestrator_stop, efficiency_analysis) from index.ts into a shared module (for example src/tools.ts). Each handler takes (params, ctx) with the context it needs today: cwd, and the notify or report sink where used. The pi adapter (index.ts) wraps the handlers in pi.registerTool with exposure deferred. Everything else in the pi adapter stays: the before_agent_start tool_search activation, the session_start watcher, the sendMessage report delivery, the session_shutdown handler.
2. New src/mcp.ts, a stdio JSON-RPC server, node builtins only:
   - initialize: echo the client protocolVersion when we support it, else reply with the latest version we support. capabilities: tools. serverInfo: name se-llm-team, version from package.json.
   - notifications (initialized and others): ignored, no reply.
   - tools/list: the 12 tools with name, description, and inputSchema from the same typebox schemas. The typebox schemas serialize as JSON Schema.
   - tools/call: dispatch to the shared handlers, return text content, set isError true with the message on error.
   - Unknown method: error -32601. Malformed JSON: error -32700.
   - The server resolves the project root from its cwd, the same way the pi handlers resolve ctx.cwd today.
   - orchestrator_start in the MCP server passes --default-agent claude to the daemon (the host-passed default from task #216). orchestrator_status, orchestrator_poke, and orchestrator_stop use the same daemon lock as today.
3. README.md: document the MCP server entry (node src/mcp.ts) for manual mcp-config use.

# Constraints
- No new dependency in package.json.
- The pi tool schemas, descriptions, and behavior stay equivalent. tests/extension.test.ts guards them.
- The server runs from a bare git clone with node >= 24. No install step.

# Acceptance criteria
- New node tests/mcp.test.ts passes: spawn node src/mcp.ts as a child process, do the initialize handshake, tools/list returns the 12 tool names, tools/call runs kanban_create and kanban_list against a temp git repo, an unknown method returns -32601, malformed JSON returns -32700.
- node tests/extension.test.ts and node index.test.ts pass. The pi adapter behavior is unchanged.
- node tests/orchestrator.test.ts, node tests/kanban.test.ts, node tests/webui.test.ts, node tests/efficiency-analysis.test.ts pass.

# Notes
- Moved the 12 tool execute bodies and parameter schemas from index.ts into src/tools.ts. Each handler takes (params, ctx). ctx carries cwd, a notify sink for a failed daemon spawn, and the host default agent for the daemon. The handler bodies and their responses are unchanged.
- The shared schemas are plain JSON Schema objects, not typebox builders. Reason: typebox is a peer dependency, so a bare clone has no node_modules and src/mcp.ts could not import it. typebox 1.x schemas are plain objects (no symbols), so pi's typebox Compile validates them unchanged. tests/extension.test.ts compiles them with the real typebox and passes.
- index.ts is now a thin pi adapter. It registers the 12 shared tools with pi (exposure deferred, same labels, descriptions, schemas), attaches the board watcher on kanban_* calls, and keeps the before_agent_start tool_search activation, the session_start watcher, the sendMessage report delivery, and the session_shutdown handler. resolveRoot moved to src/tools.ts.
- New src/mcp.ts: hand-rolled JSON-RPC over newline-delimited stdio, node builtins only. initialize echoes a supported protocol version (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05) and else replies with the latest, declares capabilities.tools, and names se-llm-team. Notifications get no reply. tools/list serves the 12 tools. tools/call dispatches to the shared handlers and sets isError true with the message on a throwing call. Unknown methods get -32601, malformed JSON gets -32700. The server resolves the project root from its cwd. Its orchestrator_start passes --default-agent claude.
- New tests/mcp.test.ts. It spawns node src/mcp.ts as a child against a temp git repo and checks the handshake (echo and fallback), the 12 tool names, a kanban_create and kanban_list round-trip, the isError path, -32601, and -32700. An in-process part with a spawn stub checks that the MCP host default reaches the daemon as --default-agent claude.
- index.test.ts: resolveRoot now imports from src/tools.ts. The dead pi-ai and typebox stubs are gone, because index.ts imports the pi packages as types only now.
- package.json: tests/mcp.test.ts joined the test chain. No new dependency. README documents the node src/mcp.ts entry for manual mcp-config use.
- All 7 test files pass: kanban, orchestrator, webui, extension, efficiency-analysis, index, mcp.

# Open questions
- Assumption: only orchestrator_start differs on the MCP host. The shared handler takes the default agent from ctx, so the MCP server passes claude and pi passes pi. efficiency_analysis also passes the host default to the analyser config; for pi this changes nothing (pi is already the fallback).
- Assumption: the MCP server does not validate tools/call arguments against the schema on the wire. There is no typebox in a bare clone. A non-enum argument (e.g. shortName) surfaces as an isError result from the handler, not as a -32602 validation error. Review fix: enum params are now checked in the MCP dispatch too (see Notes).
- Assumption: serverInfo.version reads the package.json version field and falls back to 0.0.0. The manifest carries no version field today.
- Assumption: the server answers ping with an empty result. The MCP protocol requires it; the spec does not mention it.
- Assumption: Claude Code starts the server with cwd set to the project directory, so the process cwd is the project root.
- Question: should package.json carry a version field for the MCP serverInfo, or is the 0.0.0 fallback fine?

## Review (reviewer)
- Fixed (9e1993b): the MCP host had no enum validation. setState and updateTask write out-of-enum values silently, so `tools/call kanban_set_state {state: "banana"}` or `kanban_update {priority: "urgent"}` corrupted the board; kanban_create fell back to defaults silently and an unknown kanban_list scope mis-filtered. Added `checkEnums` in src/tools.ts (validates enum params against the tool's own schema) called in the mcp.ts dispatch; an out-of-enum value now returns isError. Regression check in tests/mcp.test.ts (invalid state sets isError and matches /invalid state/). The invalid-argument assumption above is now true for enum params as well.
- Verified: the spec-text deviation (plain JSON Schema instead of typebox builders) is the right call. The two spec bullets conflict: tools/list says "from the same typebox schemas" while Change 2 says node builtins only, and typebox is a peer dep absent in a bare clone. The deviation is documented in the developer Notes and pi-side equivalence is guarded: tests/extension.test.ts compiles the shared schemas with the real typebox and asserts validation, descriptions, labels, responses, symlink resolution, the board watcher and the report queue.
- Verified: the pi adapter keeps everything the spec requires (before_agent_start tool_search activation, session_start watcher, sendMessage report delivery, session_shutdown). orchestrator_start keeps the node --watch supervisor and the same daemon log/lock paths; the spawn path resolves to src/orchestrator.ts from tools.ts's import.meta.url, matching the old extDir join. loadConfig(root, "pi") resolves the same backend as the old loadConfig(root).
- All 7 suites pass: mcp, index, extension, efficiency-analysis, kanban (x3 for the load-sensitive concurrency parts), orchestrator, webui. Remaining open question for the user: the package.json version field.
- Re-review (2nd pass, of fix 9e1993b): the checkEnums guard covers the only silent-corruption path. Probe (temp repo, mcp dispatch semantics): a missing required state or name throws inside kanban.ts (serializeFrontmatter/createTask) before any write, so it surfaces as isError on the wire; an unknown param is ignored (updateTask picks known fields only); a non-string enum value is rejected by checkEnums. No silent board corruption remains.
- Verified against the MCP spec (2025-11-25, modelcontextprotocol.io): ping MUST get an empty response (the open-question assumption was right), and unknown tool -> -32602 matches the spec's example message.
- Verified against the newer 2026-07-28 (Modern) revision: Modern drops the initialize handshake (per-request _meta), so SUPPORTED_PROTOCOL_VERSIONS correctly covers only the Legacy revisions (2025-11-25 and earlier); echoing 2026-07-28 in an initialize reply would claim Modern semantics the server does not have. The server does not enforce the handshake, so a Modern-style client that calls tools/list inline still works. No change needed.
- Re-ran the 4 fast suites in this worktree: mcp, index, extension, efficiency-analysis pass. The 3 slow suites (kanban, orchestrator, webui) test files this task never modified (the diff touches only index.ts, src/tools.ts, src/mcp.ts, tests/mcp.test.ts) and the tree is unchanged since the previous all-7 run, so their pass stands. No fixes this round.