---
name: "fix: doctor notes contract in prompt, config and starter"
priority: "high"
state: "backlog"
worktree: ""
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
