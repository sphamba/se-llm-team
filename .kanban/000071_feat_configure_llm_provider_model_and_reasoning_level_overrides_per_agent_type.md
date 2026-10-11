---
name: "feat: configure LLM provider, model, and reasoning level; overrides per agent type"
priority: "critical"
state: "backlog"
worktree: ""
---

# Summary
New config keys in se-llm-team.json set the LLM provider, model, and reasoning (thinking) level used when the daemon spawns agents, with per-agent-type overrides for developer, reviewer, live-tester, and merger. Unset fields keep the current behavior (no extra flags).

# Specs
Configurable LLM provider, model, and reasoning (thinking) level for the daemon-spawned agents, with a global default and per-agent-type overrides (developer, reviewer, live-tester, merger). Facts verified in the current root checkout.

Facts:
- Agent spawning: spawnAgent(root, agent, role, task, cwd, pidName?) (src/orchestrator.ts:134-155). argv (line 140): [agent, "--approve", "--mode", "json", "-p", renderPrompt(...)]. No env option (inherits process.env), no model/provider/thinking flags. Spawn call sites: line 499 "developer" (cwd=worktree dir), 537 "merger" (cwd=root, pidName slug.merger), 580 "reviewer", 587 "live-tester" (both cwd=worktree dir).
- Config: loadConfig (src/orchestrator.ts:39-53) reads ~/.pi/agent/se-llm-team.json then {root}/.kanban/se-llm-team.json (shallow merge, catch = optional file) and returns { agent: cfg.agent ?? "pi", pollMinutes, autoScheduleMinutes }. No validation; missing file or key silently defaults.
- pi CLI (pi --help, docs cli.md:65-66): --provider <name> (requires --model), --model <pattern> (accepts "provider/id" and an optional ":<thinking>" suffix), --thinking <level> (off, minimal, low, medium, high, xhigh, max). Per-invocation selection is flag-only: PI_PROVIDER/PI_MODEL/PI_REASONING_LEVEL (docs environment-variables.md:22-32) are bash-tool session outputs, not invocation inputs.
- The spawn currently passes no model/thinking flag.
- Tests: src/orchestrator.test.ts parses the stub argv (line 75 "-p"+1; lines 81-82 check --mode json). Config is exercised via .kanban/se-llm-team.json writes (lines 207, 251, 300, ...). webui.test.ts covers loadWebUiConfig.

Changes:
1. Config schema (same two-file merge order as today): top-level global keys "provider" (optional string), "model" (optional string), "thinking" (optional, one of off|minimal|low|medium|high|xhigh|max), plus a top-level "roles" object keyed by agent type: { "developer": {...}, "reviewer": {...}, "live-tester": {...}, "merger": {...} }, each entry with the same optional provider/model/thinking fields.
2. loadConfig returns the new fields (llm defaults + roles map, each unset field undefined, roles {} when absent). Validate: an unknown thinking value logs a warning and is dropped; the daemon never crashes on bad config.
3. spawnAgent gains the resolved per-role LLM flags. Per-field precedence: roles.<role> entry > global default > unset. Flag mapping: model -> ["--model", model]; provider -> ["--provider", provider, "--model", model] (the CLI requires --model with --provider; a provider without a model logs a warning and is ignored); thinking -> ["--thinking", level]. Flags are appended after "--mode json" and before "-p". A ":<thinking>" suffix inside the model pattern keeps working natively.
4. Wiring: resolve once per spawn at the call sites or inside spawnAgent from the loaded config; keep the diff minimal (pass the resolved flag array or the config into spawnAgent, whichever is cleaner).
5. Docs: update the config-keys documentation in README.md if it exists there.
6. Tests: extend src/orchestrator.test.ts - with .kanban/se-llm-team.json holding global model + thinking and a role override, that role's stub argv carries the override plus remaining globals; other roles carry only globals; unset config leaves argv unchanged (existing assertions at lines 75-82 stay valid); provider without model -> warning, no --provider flag; invalid thinking -> warning, no --thinking flag. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- se-llm-team.json can set provider/model/thinking globally; every spawned agent (developer, reviewer, live-tester, merger) gets the flags.
- A roles.<name> entry overrides any global field for that agent type only.
- Unset fields spawn exactly the current argv (no new flags).
- Bad values (unknown thinking level, provider without model) log a warning and never crash or block the pipeline.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/orchestrator.ts, src/orchestrator.test.ts, README.md (config docs only).
- HOLD behind 000038 (reviewing): it rewrites src/orchestrator.ts (hub wiring). Promote only after 000038 is done and merged, and rebase line numbers on the merged code. 000070 (reviewing) touches only src/webui.ts - no conflict with this task.
- Do not use env vars for per-invocation selection; flags only (see Facts).

# Notes
