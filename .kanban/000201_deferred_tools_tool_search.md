---
name: "feat: deferred tool exposure; auto-enable tool_search"
priority: "medium"
state: "done"
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

Done in commit a46e9fe on the worktree branch:
- index.ts: added `exposure: "deferred"` to all 11 registerTool calls (rg confirms exactly 11 occurrences).
- index.ts: registered a `before_agent_start` handler that reads `pi.getActiveTools()` and calls `pi.setActiveTools([...active, "tool_search"])` only when "tool_search" is missing (idempotent, additive). Placed next to the existing session_start handler.
- README.md Tools section: added a short paragraph on the deferred on-demand loading, the automatic tool_search activation at session start, and the manual `"defaultTools": ["+tool_search"]` fallback.
- All five suites pass (`npm test`: kanban, orchestrator, webui, extension, index). Verified against pi docs and dist types before writing: `setActiveTools` replaces the set and ignores unknown/hidden tools, and the built-in tool_search extension registers inactive (`defaultActive: false`), so the additive spread is the correct activation shape.

Live test (2026-10-13, merged a46e9fe, default model RCP/GLM 5.3 Flash):
Method: real pi sessions from an isolated session dir but the real HOME, so the extension loads from the usual symlink. The session transcript records the declared tool set in the first `system` entry (`message.toolsAdded`), which is the exact set sent to the model, and later entries record each tool change. Fixture: a git repo with one `.kanban/` probe task. No unit suite was run.

| Flow | Startup declared set | Result |
| --- | --- | --- |
| JSON/print, the daemon role-agent shape (`pi --approve --mode json -p`, also through the `sh -c` exit-file wrapper) | 20 tools, `tool_search` active, 0 of the 11 se-llm-team tools | A natural prompt made the model call `tool_search` ("kanban board task"), which loaded 8 tools, then `kanban_list` ran for all three scopes and the answer named the probe task. All 19 other active tools stayed (additive). |
| Worktree shape (cwd with a `.kanban` symlink and `SPECS.md -> .kanban/<file>`) | 20 tools, `tool_search` active, 0 deferred | `tool_search` then `kanban_get {}` resolved the task from the cwd symlink and returned it. |
| RPC, the PM shape | 21 tools, `tool_search` active, 0 deferred | Turn 1: `tool_search` then `kanban_list`. Turn 2: `kanban_list` directly with no new tool change, so loaded tools persist in the session. `tool_search` stayed single in the set. |
| Differential control: pre-change `index.ts` from 2b5cd9b loaded with `--no-extensions -e` | 15 tools, the 11 se-llm-team tools direct, no `tool_search` | The old behavior, as expected. |

Acceptance checks: `rg -n 'exposure: "deferred"' index.ts` finds 11; the `before_agent_start` handler is at index.ts:369; README.md:118 documents the on-demand loading, the automatic activation and the manual `defaultTools` fallback.

Observations, not findings: one plain RPC run without a named task tool answered from `bash`/`read` instead of searching (the mechanism worked whenever the model searched, and the PM skill names the kanban tools). A broad `tool_search` query returned 8 of the 11 tools because the built-in default limit is 8. `limit: 11` or a second query reaches the rest.

Assumptions of this test: the transcript's first `toolsAdded` entry is the model's startup set (same claim as the pi docs), and the tool name list comes from index.ts. No assumption of the task was contradicted. No findings, so no new tasks were requested.

# Open questions

None.

Review (2026-10-13): no fixes needed, clean to merge.
- Diff vs main is exactly the three spec changes: 11 `exposure: "deferred"` lines, the `before_agent_start` handler, and the README paragraph.
- Verified the pi API against dist/core/extensions/types.d.ts: `getActiveTools(): string[]` (:1258), `setActiveTools(toolNames: string[]): void` (:1267), built-in tool_search registered inactive and activated by `setActiveTools` (:483). `before_agent_start` confirmed in docs/extensions.md (:62).
- The handler sits inside the factory function and only calls setActiveTools from the handler body, so nothing throws during factory loading. Additive and idempotent: checks `includes` before spreading.
- The handler covers the daemon-spawned role agents, which load the extension in JSON mode with no tool flags.
- Both assumptions below are recorded here, so nothing silent. Re-adding on every before_agent_start is required, not just harmless: the 11 deferred tools are undeclarable without tool_search, so keeping it active is the feature.
- npm test: all five suites pass (the `git rebase main failed` lines in orchestrator output are that suite's own conflict fixtures, resolved by the merger inside the test).

Assumptions (unconfirmed, flag anything wrong):
- The activation handler runs on every before_agent_start (cheap, keeps tool_search active even if a user later deactivates it with /tools mid-session).
- No tests were added for the new handler behavior: the existing extension.test.ts mock has no getActiveTools/setActiveTools, and the spec lists only the four suites plus rg checks as acceptance.
