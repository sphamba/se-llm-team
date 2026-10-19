---
name: "fix: doctor notes contract in prompt, config and starter"
priority: "high"
state: "live-testing"
worktree: "fix/280-doctor-minimal-role-notes-code"
issuer: "#279"
complexity: "moderate"
shortName: "doctor-minimal-role-notes-code"
---

# Summary
Code half of #279: land the role-notes contract (at most {{maxNotesBullets}} top-level bullets, task-agnostic only, full rewrite each run) in agents/doctor.md, wire the configurable cap (default 20) through config and both analyseLog call sites, and change the ensureRoleNotes starter. Content half (role prompt prohibitions + one-time notes distill) is the sibling task.

# Specs
# Need

The doctor's prompt lets .kanban/AGENTS.<role>.md grow unboundedly. Land the written contract in the shipped prompt and code: at most N top-level bullets per role notes file (N configurable, default 20, config key roles.doctor.maxNotesBullets), task-agnostic content only, full rewrite by the doctor every doctor run, no orchestrator-side enforcement (prompt rule only).

# File ownership (hard boundary with the sibling content task)

You own: agents/doctor.md, src/efficiency-analysis.ts, src/analysis-run.ts, src/tools.ts, src/orchestrator/config.ts, src/orchestrator/spawn.ts, tests/efficiency-analysis/*, tests/orchestrator/config.test.ts, tests/orchestrator/spawn.test.ts.
Do NOT touch: agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, agents/splitter.md, or any .kanban/AGENTS.*.md (the sibling owns them).

# Changes

1. agents/doctor.md — rewrite the final instruction paragraph (the "You have full rewrite authority over the role file: compact it each run by merging duplicate guidance..." sentence): full rewrite authority each run; at most {{maxNotesBullets}} top-level bullets; keep only durable, task-agnostic guidance (repo structure, build/test recipes, general shell traps, workflow tips); delete task-specific material (task-number citations, per-task recipes, measured per-task values, war stories) outright, never archive; keep valid markdown. Keep the no-roleFile behavior wording unchanged (report only, write nothing).
2. src/efficiency-analysis.ts — doctorPrompt renders {{maxNotesBullets}} into the values map (renderTemplate leaves unknown placeholders literal, so an unwired placeholder would ship as literal text); the cap arrives via the opts path (AnalyseOptions field), default 20 when unset.
3. src/orchestrator/config.ts — parse roles.doctor.maxNotesBullets like the existing per-role numbers (positive integer; invalid value logged and ignored). The default applies at the use site.
4. Both analyseLog call sites pass the knob: src/analysis-run.ts (loads cfg itself: cfg.roles.doctor?.maxNotesBullets) and src/tools.ts efficiency_analyse (around line 334, alongside cfg.roles.analyst?.concurrency).
5. src/orchestrator/spawn.ts ensureRoleNotes — new starter text stating the contract, e.g. "# <role>: project guidance for future agents of this role. The doctor rewrites this file after every run; keep at most <N> durable, task-agnostic bullets (repo structure, build/test tips). Never edit this file as the role agent." Wording flexible; the contract elements (doctor rewrites after every run, role agent never edits, durable task-agnostic bullets) must all be present.

# Tests

- Before rewording the shipped prompt, grep the suites for byte-pins: only tests/efficiency-analysis/doctor.test.ts pins agents/doctor.md bytes (two literals, with and without roleFile). Update both.
- tests/efficiency-analysis/prompts.test.ts: extend substitution coverage so {{maxNotesBullets}} is asserted replaced, not left literal.
- tests/orchestrator/config.test.ts: roles.doctor.maxNotesBullets default (20 at use) plus an override, in the file's existing knob-test style.
- tests/orchestrator/spawn.test.ts: update the starter pin (part AS) for the new starter text; the existing `# ${role}:` prefix assertion can stay.

# Constraints

- Prompt rule only: no orchestrator-side trim, no fail-and-retry.
- The doctor keeps reading the role file with its own tools; no file content injected into the prompt.
- Do not touch the splitter inline-injection byte cap (out of scope, noted hazard only).

# Acceptance criteria

- npm test passes (full suite).
- A test asserts the rendered doctor prompt carries the cap sentence with the configured number (default 20, plus an override via roles.doctor.maxNotesBullets).
- ensureRoleNotes writes the new starter text for a missing file (unit assertion).

# Notes

- Tests first (fix policy): all four touched suites failed on the new asserts before the change (doctor byte pins, prompts substitution, config knob, spawn starter); green after the change. Suites run: tests/efficiency-analysis/doctor.test.ts, tests/efficiency-analysis/prompts.test.ts, tests/orchestrator/config.test.ts, tests/orchestrator/spawn.test.ts.
- agents/doctor.md final paragraph replaced with three sentences: full rewrite each run, at most {{maxNotesBullets}} top-level bullets plus valid markdown, keep only durable task-agnostic guidance (repo structure, build/test recipes, general shell traps, workflow tips), delete task-specific material (task-number citations, per-task recipes, measured per-task values, war stories) outright, never archive. The no-roleFile wording is untouched. Both byte pins in tests/efficiency-analysis/doctor.test.ts updated to the new rendering with the default 20.
- src/efficiency-analysis.ts: AnalyseOptions.maxNotesBullets (default 20 applied in analyseLog next to the other defaults), rendered into doctorPrompt's values map.
- src/orchestrator/config.ts parses roles.doctor.maxNotesBullets like concurrency/mergeThreshold (positive integer, invalid warns and stays unset); both analyseLog call sites pass cfg.roles.doctor?.maxNotesBullets (src/analysis-run.ts, src/tools.ts efficiency_analysis).
- src/orchestrator/spawn.ts starter now states the contract (doctor rewrites after every run, durable task-agnostic bullets, role agent never edits). Deliberate: the starter carries no bullet count, because the cap governs the doctor's rewrite and already travels in the doctor prompt; a number in the starter could contradict a configured cap until the first rewrite.
- Coverage note: config.test.ts part AR runs the real analysis runner end to end (node src/analysis-run.ts with a stub agent, HOME isolated) and asserts the rendered doctor prompt carries "at most 20" with no config key and "at most 7" with roles.doctor.maxNotesBullets: 7. prompts.test.ts covers the option path (default 20, override 7). The tools.ts call site passes the identical expression as analysis-run.ts and has no dedicated end-to-end test (the real-spawn tool path cannot be stubbed in-process); covered by review only.
- Commit: 195b440 in this worktree.

## Review (195b440, re-review)
- All five Changes settle from the diff: doctor.md final paragraph carries full-rewrite-each-run + {{maxNotesBullets}} cap + durable-task-agnostic-only + delete-outright-never-archive with the no-roleFile wording untouched (agents/doctor.md:8); AnalyseOptions.maxNotesBullets, default 20 in analyseLog, rendered into the values map (src/efficiency-analysis.ts:46,378,397,554); roles.doctor.maxNotesBullets parsed like the other per-role numbers, invalid warns and stays unset (src/orchestrator/config.ts:137-144); both analyseLog call sites pass cfg.roles.doctor?.maxNotesBullets (src/analysis-run.ts:38, src/tools.ts:336); ensureRoleNotes starter states all three contract elements (src/orchestrator/spawn.ts:31).
- Constraints hold: prompt rule only (no trim or retry code in the diff), role file never injected into the prompt, splitter byte cap untouched.
- Stale-pin grep ("compact it each run", "append project-specific guidance") over tests/: zero matches, no lagging split-area copies.
- Suite union (efficiency-analysis claude/commands/doctor/merge/parse/pipeline/prompts, orchestrator analysis/config/spawn, mcp/extension/tools/plugin, fixed from the coverage map + diff --stat): 14/14 exit=0 on the current tree, 12 fast in parallel then config and spawn serial. Notes' green runs carry no positional sha, so the union re-run stands as the verdict.
- Acceptance criteria: the cap sentence renders with default 20 and override 7 end to end through the real runner (config.test.ts part AR), the option path asserts default 20 / override 7 with the placeholder never literal (doctor.test.ts testMaxNotesBulletsOverride, prompts.test.ts), the new starter text is unit-asserted (spawn.test.ts part AS, `# ${role}:` prefix kept). Full npm test not run: reviewer scope is the union, which covers every touched file per the coverage map.
- No fixes, no open questions.
