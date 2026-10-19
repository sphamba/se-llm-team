---
name: "fix: doctor keeps AGENTS role notes minimal and generic"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "doctor-minimal-role-notes"
blockedBy: "#281"
---

# Summary
Verification-only parent for #280 (code: doctor prompt contract, roles.doctor.maxNotesBullets wiring, starter) and #281 (content: role prompt prohibitions, one-time distill of the five .kanban/AGENTS.*.md files). Verify the whole role-notes contract (max 20 bullets default 20, task-agnostic, doctor sole writer) once both pieces have landed.

# Specs
# Verification

Verification-only parent: #280 lands the code half (agents/doctor.md contract rewrite, roles.doctor.maxNotesBullets wiring with default 20, ensureRoleNotes starter), #281 lands the content half (five role prompt prohibitions, one-time distill of the five .kanban/AGENTS.*.md files). Check the end-to-end contract once both land:

- npm test passes (full suite).
- A test asserts the rendered doctor prompt carries the cap sentence with the configured number (default 20, plus an override via roles.doctor.maxNotesBullets).
- ensureRoleNotes writes the new starter text for a missing file (unit assertion).
- grep over agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, agents/splitter.md shows no sentence instructing the role agent to edit or append its notes file; each of the five carries the read-only/doctor-maintains prohibition.
- Each of the five .kanban/AGENTS.*.md files: bullet lines (grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ') at most 20, zero '#[0-9]' task citations, size at most 8192 bytes.
- The splitter inline-injection byte cap is untouched.

# Notes
- Blocked: #280 (code) and #281 (content) are both in state to-do on the board, and main == HEAD (5bd5079) with no commits above the merge base, so neither half has landed. No code changes made: this is the verification-only parent.
- Baseline scoped runs at this base, all exit 0: tests/efficiency-analysis/doctor.test.ts, tests/efficiency-analysis/prompts.test.ts, tests/orchestrator/spawn.test.ts.
- Contract absent at this base, evidence:
  - grep maxNotesBullets over src, tests and agents: no hits. agents/doctor.md carries no notes-cap sentence.
  - src/orchestrator/spawn.ts:29-35 ensureRoleNotes still writes the old "append project-specific guidance" starter.
  - Role prompts still instruct note edits: agents/developer.md:24 and agents/splitter.md:13.
  - .kanban/AGENTS.*.md against the target (<= 8192 bytes, <= 20 bullet lines, 0 #[0-9] citations), measured through the worktree symlink as bytes/bullets/cites: developer 56623/104/52, live-tester 98311/165/452, reviewer 20921/67/0, splitter 11473/29/7, merger 2163/5/0.
- Re-run this verification after #280 and #281 merge.

# Open questions
- Assumption: the five role-notes targets are the main-checkout .kanban/AGENTS.{developer,reviewer,live-tester,merger,splitter}.md files, read through the worktree symlink for the size and bullet counts above.
