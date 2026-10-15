---
name: "feat: MCP server exposing the kanban and orchestrator tools"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "mcp-server-tools"
blockedBy: "#216"
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
