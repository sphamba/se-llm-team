---
name: "fix: doctor keeps AGENTS role notes minimal and generic"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "doctor-minimal-role-notes"
---

# Summary
The doctor's prompt and implementation let .kanban/AGENTS.<role>.md grow unboundedly (live-tester is 98 KB). Fix: a written rule of max 20 bullets (configurable) rendered into the doctor prompt, full rewrite each doctor run, task-agnostic content only, dropped specifics deleted, the doctor as sole ongoing writer (role prompts forbid agents from editing the file), a new minimal starter, and a one-time distill reset of this repo's five role notes files.

# Specs
# Need

The doctor (second pass of the post-run analysis) revises .kanban/AGENTS.<role>.md after every successful agent run, but nothing bounds the file's size or genericity: its prompt says only "compact it each run by merging duplicate guidance", the doctor must discover the file's size itself, role agents append to it during runs (all five shipped role prompts instruct it), and no cap exists anywhere. Result in this repo: AGENTS.live-tester.md 98,311 bytes / 239 lines, AGENTS.developer.md 56,623 bytes / 137 lines, AGENTS.reviewer.md 20,921, AGENTS.splitter.md 10,856, AGENTS.merger.md 2,163 — mostly append-only task-numbered war stories, measured one-task values and self-admitted stale notes. Every future spawn of these roles pays for this in tokens and can be misled by other tasks' specifics.

# Decisions (grill-me interview 2026-10-19, all settled with the user)

- Size bar: a written rule of at most 20 top-level bullets per role notes file. The number is configurable, default 20 (suggested config key roles.doctor.maxNotesBullets; exact placement idiomatic, developer's call).
- Content bar: task-agnostic only. Allowed: durable repo knowledge (directory structure, build/test recipes, general shell traps, workflow tips). Dropped: anything task-specific (task-number citations #NNN, per-task recipes, measured per-task values, incident logs / war stories).
- Dropped content: deleted outright, never archived (agent logs and .analysis.md reports remain the record).
- Update model: the doctor fully rewrites the file every doctor run under both bars. No append discipline.
- Enforcement: prompt rule only. The cap number is rendered into the doctor prompt from config; no orchestrator-side trim, no fail-and-retry.
- Writers: the doctor is the sole ongoing writer of .kanban/AGENTS.<role>.md. Role agents must NOT modify their notes file. ensureRoleNotes keeps its one-time starter write when the file is missing.
- One-time reset: this task distills this repo's five .kanban/AGENTS.*.md files to the new form.
- Starter: the ensureRoleNotes starter text changes to state the new contract.
- Splitter inline-injection E2BIG hardening (the uncapped pi --append-system-prompt path for role notes): OUT OF SCOPE, noted hazard only.

# Changes

1. agents/doctor.md — rewrite the role-file instruction paragraph: full rewrite authority each run; at most {{maxNotesBullets}} top-level bullets; keep only durable, task-agnostic guidance for the role (repo structure, build/test recipes, general traps); delete task-specific material outright, never archive; keep valid markdown. The no-roleFile behavior is unchanged (report only, write nothing).
2. src/efficiency-analysis.ts (and the opts path feeding doctorPrompt) — read the configurable cap (default 20) and substitute it into the doctor prompt. renderTemplate leaves unknown placeholders literal, so wire the new placeholder properly. Update the shipped-prompt byte literal in tests/efficiency-analysis/doctor.test.ts, extend prompts.test.ts substitution coverage, and add a test for the config knob (default 20 and an override).
3. agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, agents/splitter.md — replace every sentence instructing the agent to edit or append the notes file with an explicit prohibition: the notes file is read-only for the role agent, the doctor maintains it. The splitter wording covers its inline-injection path (no AGENTS.md symlink in cwd).
4. src/orchestrator/spawn.ts ensureRoleNotes — new starter text stating the contract, e.g. "# <role>: project guidance for future agents of this role. The doctor rewrites this file after every run; keep at most <N> durable, task-agnostic bullets (repo structure, build/test tips). Never edit this file as the role agent." Update any test that pins the starter.
5. One-time reset in this checkout — distill each of .kanban/AGENTS.developer.md, AGENTS.live-tester.md, AGENTS.merger.md, AGENTS.reviewer.md, AGENTS.splitter.md to: at most 20 durable, task-agnostic bullets (repo map, build/test recipes, general traps); drop task numbers, per-task recipes, measured values, stale sections and the live-tester's in-file append-discipline header. Useful durable guidance survives; specifics die.

# Constraints

- Concurrent analyses may rewrite the file concurrently; last write wins, no locking (accepted: a lost rewrite is redone next run).
- The doctor keeps reading the role file with its own tools; no file content injected into the prompt.
- Grep the suites for byte-pins of any shipped prompt before rewording it (doctor.test.ts pins agents/doctor.md bytes).
- Do not touch the splitter inline-injection byte cap.

# Acceptance criteria (checkable)

- npm test passes (full suite).
- tests/efficiency-analysis: updated doctor prompt pins pass; a test asserts the rendered doctor prompt carries the cap sentence with the configured number (default 20, plus an override via roles.doctor.maxNotesBullets).
- grep over agents/*.md shows no sentence instructing role agents to edit/append their notes file; each of the five carries the prohibition.
- In this checkout, each of the five .kanban/AGENTS.*.md files: bullet lines (grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ') at most 20, zero '#[0-9]' task citations, size at most 8192 bytes.
- ensureRoleNotes writes the new starter text for a missing file (unit assertion).

# Notes
