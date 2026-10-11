---
name: "feat: configure LLM provider, model, and reasoning level; overrides per agent type"
priority: "critical"
state: "done"
worktree: "feat/71-configure-llm-provider"
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

- Implemented the LLM config in src/orchestrator.ts. Top-level provider/model/thinking keys plus a top-level roles object with per-agent-type entries. loadConfig validates the values. An unknown thinking level drops with a warning. spawnAgent resolves the flags per role. A provider without a model drops with a warning. Flags are appended after --mode json and before -p, in the order provider, model, thinking.
- Per-field precedence: roles.<role> > global > unset. Unset fields add no flag. A ":<thinking>" suffix in the model pattern stays native.
- README.md: new config table rows, an updated example, and the documented spawn command now names the flags.
- Tests in src/orchestrator.test.ts: part X checks the global flags, a developer override, a reviewer provider+model override, the live-tester globals, and a merger override through a real merge conflict. Part Y checks the bad-value warnings and the absence of flags. The daemon stays alive in both parts.
- Checks pass: node src/kanban.test.ts, node src/orchestrator.test.ts (all parts), node src/webui.test.ts. A strict tsc run reports no error in src/orchestrator.ts or the new test code. The repo has no tsconfig. Pre-existing strict errors remain in untouched files.
- Commit f28f0de in the worktree.
- Review (commit f28f0de): no fixes needed. Spec compliance: the config schema, the per-field precedence (role entry > global > unset), the flag mapping and order (after --mode json, before -p), all four spawn call sites, and the README config docs match the Specs. Only spawnAgent spawns agents, so every role gets the flags.
- Bad values stay non-fatal: an unknown thinking level (global or role) warns and drops, a provider without a resolved model warns and drops. The warnings come from loadConfig at daemon start, so they do not repeat on each sweep.
- Checked pi --help: --provider requires --model, --model accepts "provider/id" and a ":<thinking>" suffix, and the thinking levels are exactly off, minimal, low, medium, high, xhigh, max. The code matches.
- Ran the full suite in the worktree: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass. Ran src/orchestrator.test.ts a second time: the new parts X and Y pass again, no flakiness seen.
- Strict tsc (from an installed typescript, flags --strict --target es2022 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions): no error in src/orchestrator.ts or the new test code. The reported errors are pre-existing in hub.ts, kanban.ts, webui.ts, and old test lines.
- Existing roleStub argv parsing is untouched, so the old assertions stay valid. The role names in the four agent prompts are unique, so the test stub classifies every spawn correctly.
- The HOLD constraint is satisfied: 000038 is done and merged into main, and this branch sits on that merge.

Live test (worktree feat/71-configure-llm-provider, commit f28f0de). Result: PASS.

What ran:
- node src/kanban.test.ts, node src/orchestrator.test.ts (all parts, parts X and Y included), node src/webui.test.ts. All pass.
- Strict tsc --noEmit on src/orchestrator.ts. No error.
- Live daemon runs from this worktree against scratch project roots. Each root had its own .kanban/se-llm-team.json and a stub agent executable. The stub records its argv and drives the task through the pipeline.

Results:
- Global provider/model/thinking plus four role overrides: every spawn carries the right flags and the pipeline reaches done. Developer: --provider gprov --model devmodel --thinking low. Reviewer: --provider rprov --model revmodel --thinking high. Live-tester: --provider gprov --model gmodel --thinking off.
- No LLM config: the argv is unchanged, that is --approve --mode json -p. No extra flag.
- Bad values (thinking "banana", role thinking "wild", role entry as a string, provider without a model): the daemon logs a warning for each bad value, adds no flag, stays alive, and the pipeline reaches done.
- A role provider with a global model resolves to --provider roleprov --model gmodel. This is the intended per-field precedence.
- A real merge conflict spawns the merger with --provider mprov --model mergemodel --thinking high.
- Real pi CLI: the generated flags parse. The session event shows thinkingLevel equal to the --thinking value (high, off, medium). A model pattern with the :thinking suffix still works without a --thinking flag.
- Only spawnAgent spawns agents, and all four call sites pass the resolved flags.

Observations (no task needed):
- The provider-without-model warning comes from llmFlags and repeats at each spawn. The thinking warnings come from loadConfig at daemon start. The earlier note that says all warnings come from loadConfig is true only for the thinking warnings. The behaviour matches the Specs.
- The two-file merge is shallow for roles. A project-level roles object replaces the user-level roles object. This matches the merge rule of every other key and the Specs, but a user may expect a per-role merge.

Conclusion: the change meets the acceptance criteria. No blocking or non-blocking defect found. No new task needed.
