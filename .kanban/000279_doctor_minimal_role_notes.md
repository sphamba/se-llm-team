---
name: "fix: doctor keeps AGENTS role notes minimal and generic"
priority: "high"
state: "live-testing"
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
- Verification run 2026-10-19T20:42Z, blocked on #288: worktree fast-forwarded to main b4aa9f6, so the evidence below is main's landed state. Landed: #280 (a1681b3) and #281 subtasks #285/#286/#287 (98be333, 4145b49, b4aa9f6). Board: #280 done, #281 live-testing. #288 still doing: branch fix/288-drop-splitter-role-notes has commit 2249c88 (merge-base b4aa9f6, 6 files, not an ancestor of main); main lacks the guard (ensureRoleNotes still called for every role: spawn.ts:211, analysis-run.ts:27) and agents/splitter.md:15 still names .kanban/AGENTS.splitter.md.
- Green at b4aa9f6, scoped suites run sequentially, all exit 0: tests/orchestrator/config.test.ts, tests/efficiency-analysis/doctor.test.ts, tests/efficiency-analysis/prompts.test.ts, tests/orchestrator/spawn.test.ts, tests/orchestrator/analysis.test.ts, tests/tools.test.ts.
- Cap sentence: agents/doctor.md:8 renders "keep at most {{maxNotesBullets}} top-level bullets"; tests/orchestrator/config.test.ts part AR (lines 258-305) asserts default 20 and override 7 reach the rendered prompt, and config.test.ts:200-226 validates a positive integer and warns on 0/2.5. Starter unit assertion at tests/orchestrator/spawn.test.ts:279-281 (rewrite-each-run, durable task-agnostic bullets, never edit as role agent).
- Role prompts: `grep -n "Edit it for project-specific\|append what future agents"` over the five agents/*.md files = no matches. developer:26, reviewer:23, live-tester:16, merger:19 carry the read-only/doctor-maintains prohibition. splitter:15 is pre-#288 (still names the notes file).
- Notes files measured once at 20:42Z (bullets/cites/bytes/sha256 first 12 hex): developer 20/0/8861/745c6dfdc5f6, reviewer 19/0/8189/ab7c815417c6, live-tester 20/0/8182/365074fc234c, merger 0/0/2262/50595bf2c28a; all within the <=20-bullet and 0-citation bars. AGENTS.splitter.md absent. No notes size/byte rule in agents/doctor.md or the starter, so the 8-10 KB sizes are not a fail (settled 2026-10-19 decision).
- Remaining for the post-#288 pass: full `npm test`, a splitter spawn does not recreate .kanban/AGENTS.splitter.md (needs the `role !== "splitter"` guards in 2249c88), and the splitter paragraph rewritten to name no notes file and forbid writing any AGENTS file. No code changes in this run; no commit (no-diff verification).
- Re-verification 2026-10-19T20:49Z, still blocked on #288: 2249c88 not an ancestor of main (main == b4aa9f6 == HEAD, `git log b4aa9f6..main` empty), #288 now in state reviewing on the board. Main still lacks the recreation guards (ensureRoleNotes called for every role: src/orchestrator/spawn.ts:211, src/analysis-run.ts:27) and agents/splitter.md:15 still names .kanban/AGENTS.splitter.md. b4aa9f6-state claims re-checked and hold: the four notes files re-measure byte-identical to 20:42Z (bullets/cites/bytes: developer 20/0/8861, reviewer 19/0/8189, live-tester 20/0/8182, merger 0/0/2262), AGENTS.splitter.md absent, and the green scoped runs at b4aa9f6 stay settled (zero commits after that sha). Remaining for the post-#288 pass unchanged: full `npm test`, the `role !== "splitter"` guards, the splitter paragraph naming no notes file and forbidding any AGENTS write, and a splitter spawn not recreating .kanban/AGENTS.splitter.md. No code changes; parked in backlog until #288 lands.
- Re-verification 2026-10-19T20:54Z, still blocked on #288: state reviewing, its reviewer.0 run in flight (log growing at 20:53Z). 2249c88 is still not an ancestor of main (main == HEAD == b4aa9f6).
- Static check of the unmerged 2249c88 against the remaining gate items, so the post-merge pass is mechanical: both call sites guard the splitter (spawn.ts `if (role !== "splitter") ensureRoleNotes(root, role);`, analysis-run.ts the same); the splitter paragraph (line 15) says "you have no per-role notes file" and "Leave every AGENTS.md file untouched"; the three new pins are spawn.test.ts part AZ, log.test.ts part AD and analysis.test.ts part AT6.
- Notes files measured once at 20:54Z through the worktree symlink (bullets/cites/bytes/sha256 first 12 hex): developer 20/0/10160/e1693879a7ab, reviewer 20/0/9908/ec1cb6d3363c, live-tester 20/0/9234/569b6321ab04, merger 0/0/2262/50595bf2c28a. All within the <=20-bullet and 0-citation bars. AGENTS.splitter.md absent. The drift against the 20:42Z bytes is expected: the doctors rewrite these files after each run, and the settled bar is bullets, not bytes.
- Scoped suites stay settled at b4aa9f6 (no commits after that sha); no re-run.
- No code changes this run; no commit (no-diff verification). #279 keeps an empty blockedBy while the Specs gate is #288, so the parent re-promotes at each poll and parks again after each pass.
- Verification pass 2026-10-19T21:04Z, gate met: #288 (2249c88) is an ancestor of main; worktree fast-forwarded b4aa9f6 → 2249c88 (6 files, +112/-10), so the evidence below is main's landed state.
- Splitter guards hold: src/orchestrator/spawn.ts:214 and src/analysis-run.ts:29 both read `if (role !== "splitter") ensureRoleNotes(root, role);`.
- Splitter paragraph holds: agents/splitter.md:15 says "you have no per-role notes file and none will ever appear. Leave every AGENTS.md file untouched"; it names no notes file.
- `grep -n "Edit it for project-specific\|append what future agents" agents/*.md` over all seven prompts: no matches (no sentence instructs a role agent to edit or append a notes file).
- New pins pass: spawn.test.ts "splitter no-notes spawn smoke", log.test.ts "splitter log exclusion smoke", analysis.test.ts "splitter analysis creates no role notes".
- Notes files measured once this pass through the worktree symlink: bullets developer 20, reviewer 20, live-tester 20, merger 0; cites 0 each (bar: <=20 bullets, 0 #[0-9] citations). .kanban/AGENTS.splitter.md absent.
- Suites: 21 scoped suites all exit 0 — 13 tests/orchestrator/ (analysis/hub/log parallel; config, daemon, merge, poll, promote, singleton, spawn, split, sweep, worktree serial), 7 tests/efficiency-analysis/, tests/context-symlinks. The Specs' full `npm test` was not run (repo-wide suite is banned; the scoped set covers the 2249c88 diff). No code changes this run; no commit.
- Open question removed: #288 landed, so the blockedBy re-promote loop it asked about ends here; the Specs gate is satisfied and this pass is green.

