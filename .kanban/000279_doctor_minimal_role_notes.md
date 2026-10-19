---
name: "fix: doctor keeps AGENTS role notes minimal and generic"
priority: "high"
state: "doing"
worktree: "fix/279-doctor-minimal-role-notes"
issuer: "user"
complexity: "simple"
shortName: "doctor-minimal-role-notes"
blockedBy: ""
---

# Summary
Verification-only parent for #280 (code: doctor prompt contract, roles.doctor.maxNotesBullets wiring, starter) and #281 (content: role prompt prohibitions, one-time distill of the five .kanban/AGENTS.*.md files). Verify the whole role-notes contract (max 20 bullets default 20, task-agnostic, doctor sole writer) once both pieces have landed.

# Specs
# Verification (re-baselined 2026-10-19)

Verification-only parent. Landed: #280 (code half: doctor contract, maxNotesBullets wiring, starter), #281 (content half: #285 developer, #286 live-tester, #287 reviewer/merger/splitter). In flight: #288 (splitter: deletes .kanban/AGENTS.splitter.md, guards recreation, rewrites the agents/splitter.md closing paragraph). Check the end-to-end contract once #288 lands:

- npm test passes (full suite).
- A test asserts the rendered doctor prompt carries the cap sentence with the configured number (default 20, plus an override via roles.doctor.maxNotesBullets).
- ensureRoleNotes writes the new starter text for a missing file (unit assertion).
- grep over the five agents/*.md prompts shows no sentence instructing the role agent to edit or append a notes file; the four worktree roles carry the read-only/doctor-maintains prohibition; the splitter paragraph (per #288) names no notes file and forbids writing any AGENTS file.
- The four .kanban/AGENTS.{developer,reviewer,live-tester,merger}.md files: bullet lines (grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ') at most 20 and zero '#[0-9]' task citations. .kanban/AGENTS.splitter.md does not exist (deleted by #288) and is not recreated by a splitter spawn.
- Byte-cap decision (recorded 2026-10-19): the 8192-byte figure was a one-time-distill acceptance gate, not an ongoing invariant. The settled size bar is the bullet cap the doctor maintains (user decision, #279 interview). Do not add a byte rule to the doctor prompt or the starter; do not fail verification over 8-10 KB notes files that meet the bullet and citation bars.
- The splitter inline-injection byte-cap hazard is moot for pi once #288 lands (no inline injection): do not re-check it.

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

