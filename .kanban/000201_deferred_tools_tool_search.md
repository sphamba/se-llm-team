---
name: "feat: deferred tool exposure; auto-enable tool_search"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "deferred-tools-tool-search"
---

# Summary
Make all 11 se-llm-team tools deferred so they load on demand via tool_search, and auto-enable the built-in tool_search at session start from the extension itself (before_agent_start handler), so installing the plugin is enough. Document the on-demand loading in README.

# Specs
Requested by the user (2026-10-13): all 11 se-llm-team tools load on demand instead of into every session's startup tool list, and installing the plugin enables the built-in tool_search tool automatically in every session that loads the extension.

Facts (verified in pi source and docs):
- index.ts:27-244: 11 pi.registerTool calls with no exposure option, so all tools are direct and always active.
- pi docs extensions.md "Tool exposure": exposure: "deferred" keeps a tool out of the model's startup tool list; tool_search finds it and declares it on demand. The user chose deferred for ALL 11 tools (explicit decision; the role-agent tools included).
- tool_search is a built-in extension registered inactive: dist/extensions/tool-search/index.js registers it with defaultActive: false; activate with --tools, the defaultTools setting, or setActiveTools().
- setActiveTools (pi types.d.ts:1265-1267) REPLACES the active set; unknown and hidden tools are ignored; it can target built-in tool_search. So read pi.getActiveTools() and spread additively.
- Extension action methods throw during factory loading ("Extension runtime not initialized", dist/core/extensions/loader.js:104-127); they bind when the session runtime is created. Activation must therefore happen in an event handler that fires after bind: before_agent_start (docs: "A run proceeds from input and before_agent_start"; for that event "Prefer changing prompt sections, selected tools, or guidelines"). Extensions load in interactive, RPC, JSON, and print modes, so the handler covers the daemon-spawned role agents (src/orchestrator/spawn.ts:125 runs pi --approve --mode json -p with no flags).
- The package manifest (package.json "pi": { "extensions": ["./index.ts"], "skills": ["./skills"] }) has no tools-enabling key, so the manifest cannot enable tool_search; programmatic activation is the only self-serve path. The documented manual fallback for non-extension use is "defaultTools": ["+tool_search"] in ~/.pi/agent/settings.json.
- tests/extension.test.ts mocks registerTool (no exposure assertions) and its mock pi has no setActiveTools, with on() discarding handlers; tests/index.test.ts calls tools.get(...).execute(...) directly. Adding exposure and an event handler breaks nothing.

Changes:
- index.ts: pass exposure: "deferred" to all 11 registerTool calls.
- index.ts: register a before_agent_start handler that reads pi.getActiveTools() and adds "tool_search" when missing: pi.setActiveTools([...active, "tool_search"]). Idempotent (check before adding) and additive (never drop other active tools).
- README.md: in the Tools section (lists the 11 tool names around :114-116), add one or two lines documenting the new on-demand loading: the tools are deferred and declared to the model when tool_search finds them; the extension activates tool_search automatically at session start.
- No namespace and no other exposure values.

Constraints:
- Never call setActiveTools at factory top-level (it throws during extension loading).
- The handler must be additive and idempotent; it must not drop other active tools or double-register tool_search.
- Keep all four node suites green.

Acceptance:
- node tests/kanban.test.ts, node tests/orchestrator.test.ts, node tests/webui.test.ts, node tests/extension.test.ts all pass.
- rg -n 'exposure: "deferred"' index.ts finds exactly 11 occurrences.
- rg -n 'tool_search' index.ts finds the before_agent_start handler.
- README.md documents the on-demand loading.

# Notes
