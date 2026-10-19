---
name: "fix: eliminate AGENTS.splitter.md; splitter runs on root AGENTS.md"
priority: "high"
state: "doing"
worktree: "fix/288-drop-splitter-role-notes"
issuer: "user"
complexity: "simple"
shortName: "drop-splitter-role-notes"
blockedBy: ""
---

# Summary
The splitter must have no per-role notes: delete .kanban/AGENTS.splitter.md, guard ensureRoleNotes in spawnAgent and the analysis runner so nothing recreates it, rewrite the agents/splitter.md closing paragraph to forbid writing any AGENTS file, and pin the already-true facts (no symlink at the root, splitter never analysed). The splitter then runs on the generic shipped prompt plus the project's root AGENTS.md (natively loaded for pi, concatenated file for claude).

# Specs
# Need

The repo owner decided the splitter role must have no per-role notes at all: no .kanban/AGENTS.splitter.md file, no symlink for splitter agents, and no instruction telling the splitter to modify any AGENTS.md file. Verified facts (2026-10-19):

- No symlink exists today: ensureContextSymlinks returns before the AGENTS.md repoint when cwd is the root (src/orchestrator/spawn.ts:50-60, comment :52-54). Only SPECS.md is linked at the root.
- The only live creator of AGENTS.splitter.md is spawnAgent -> ensureRoleNotes(root, "splitter") (spawn.ts:211 -> :25-36), running at every splitter spawn.
- Injection today: for pi, piPrompt = cwd === root ? readRoleNotes(root, role) : projectPrompt (spawn.ts:220-221) and the content rides as --append-system-prompt (backends.ts:41-42); for claude, claudeSystemPromptFile (spawn.ts:185-199) concatenates project root AGENTS.md + role notes into the --append-system-prompt-file. With the file gone, readRoleNotes returns null and both backends degrade to root-AGENTS.md-only with no code change expected (verify).
- agents/splitter.md:15 on main instructs the splitter to append to .kanban/AGENTS.splitter.md. The unmerged #287 commit 504a083 rewrites that paragraph to read-only-but-still-names-the-file; this task supersedes it for the splitter.
- Splitter runs are never analysed today: WORKING_STATES (src/orchestrator/liveness.ts:15-20) has no to-do entry and newestRunRole's regex (src/orchestrator/log.ts:22-37) matches only developer|reviewer|live-tester, so spawnRunAnalysis(root, slug, "splitter") is unreachable. But the analysis runner is role-agnostic: src/analysis-run.ts:27 calls ensureRoleNotes and :40 passes roleFile unconditionally, so a splitter analysis (if ever triggered) would recreate the file and hand it to the doctor with rewrite authority. The doctor's report-only "none" mode (agents/doctor.md) is currently dead code from the orchestrator path.
- The board mirror (refs/heads/meta/kanban) carries role notes; the daemon restores hand-deleted board files from the mirror, so the deletion must be verified to survive a sweep and the next board commit.

# Decisions (grill-me interview 2026-10-19, all settled with the user)

- No AGENTS.splitter.md: deleted outright and never recreated. No archive; the current 6.2 KB distilled content dies (consistent with the #279 "delete outright" policy; its durable mechanics are already covered by the shipped agents/splitter.md prompt).
- No symlink for splitter agents: already true; pin it so it stays true.
- The splitter agent must not be instructed to modify any AGENTS.md file.
- Splitter guidance channel: the generic shipped agents/splitter.md prompt plus the project's root AGENTS.md (pi loads it natively at cwd = root; claude receives it via the concatenated system-prompt file). No replacement file, no new mechanism. Project-specific splitting conventions, if ever needed, go into the project's root AGENTS.md.
- Analysis: splitter runs stay un-analysed (today's trigger-side gate). Make the exclusion explicit with a test pin, and remove the runner's ability to recreate the file.
- Hard-coded splitter guards, no config knob. Upgrade path if a second notes-less role ever appears: a config list of roles without notes.

# Changes

1. src/orchestrator/spawn.ts — guard the ensureRoleNotes call in spawnAgent so a splitter spawn never creates the file. Expect no other change: readRoleNotes then returns null for the missing file, so piPrompt is null (no --append-system-prompt at all; pi loads root AGENTS.md natively) and claudeSystemPromptFile degrades to the project part only (verify both, adjust only if not).
2. src/analysis-run.ts — guard the ensureRoleNotes call so an analysis for a splitter role (unreachable today) cannot create the file. Leave the roleFile passing for the real roles untouched.
3. agents/splitter.md — replace the final paragraph (post-#287 text names .kanban/AGENTS.splitter.md as read-only) with: the splitter has no role notes file; project guidance comes from the root AGENTS.md in cwd; never create or write any AGENTS.md file.
4. Delete .kanban/AGENTS.splitter.md from the board. Verify the meta/kanban mirror drops it: after the next board commit, git show refs/heads/meta/kanban:.kanban/AGENTS.splitter.md must fail, and the file must stay absent across a daemon sweep.
5. Tests: pin the splitter spawn on a fresh fixture (no .kanban/AGENTS.splitter.md created, pi argv carries no --append-system-prompt, no AGENTS.md symlink at the root); pin that newestRunRole never returns splitter for .splitter.N.log inputs; update expectations affected by the guards (spawn.test.ts part AS covers the four worktree roles and must keep passing).

# Constraints

- Sequencing: blocked by #280 (spawn.ts ensureRoleNotes starter region) and #287 (agents/splitter.md:15 paragraph). Rebase onto both before editing.
- The four worktree roles keep today's behavior unchanged (notes creation, symlink, inline project AGENTS.md prompt).
- The splitter inline-injection byte-cap hazard (root SPECS.md, splitter bullet) becomes moot for pi with the inline injection gone; restate that boundary in the task notes rather than editing SPECS.md.
- Do not touch src/webui splitter display roles or the general ROLE_NOTES_RE plumbing (the other four notes files stay board noise).

# Acceptance criteria (checkable)

- npm test passes (full suite).
- New unit: a splitter spawn on a fresh fixture creates no .kanban/AGENTS.splitter.md; its pi argv carries no --append-system-prompt; the root has no AGENTS.md symlink.
- grep over agents/splitter.md shows no sentence instructing the splitter to write or append to any AGENTS file.
- .kanban/AGENTS.splitter.md is absent and stays absent after a daemon sweep; git show refs/heads/meta/kanban:.kanban/AGENTS.splitter.md fails after the next mirror commit.
- A test pins newestRunRole against .splitter.N.log inputs (never splitter).
- npm test still covers the four worktree roles' notes behavior (part AS unchanged and passing).

# Notes
- Landed commit 2249c88 on fix/288-drop-splitter-role-notes (base b4aa9f6 = main; both blockers #280 and #287 were already merged there).
- src/orchestrator/spawn.ts:214 and src/analysis-run.ts:29 guard ensureRoleNotes with `role !== "splitter"`. The comments in ensureContextSymlinks and spawnAgent now state the splitter has no notes and runs on its shipped prompt plus the project's root AGENTS.md.
- agents/splitter.md last paragraph rewritten: no per-role notes file, guidance = shipped prompt + root AGENTS.md, "Leave every AGENTS.md file untouched". A grep for append/write/create/edit/rewrite next to AGENTS in that file returns nothing.
- Red-then-green probe before the fix: a splitter pi spawn carried --append-system-prompt and created .kanban/AGENTS.splitter.md; the claude system-prompt file held the splitter notes after the project part; `node src/analysis-run.ts <root> <missing>.log splitter` created the file. All of these flip green after the guards.
- Scoped suites run one at a time, each exit 0: tests/orchestrator/log.test.ts, tests/orchestrator/analysis.test.ts, tests/orchestrator/spawn.test.ts (part AS "per-role project notes smoke passed" is in the log, so the four worktree roles are unchanged).
- New pins: spawn.test.ts part AZ (no notes file, no --append-system-prompt, the root AGENTS.md is not a symlink while root SPECS.md still is, claude file = project part + "\n"); log.test.ts part AD (newestRunRole ignores .splitter.N.log and .splitter.N.log.gz); analysis.test.ts part AT6 (the runner creates no splitter notes file).
- Board: .kanban/AGENTS.splitter.md deleted from the shared board; the four worktree roles' notes files stay. Mirror tip c80ce8a still carries the file; commitKanban rebuilds the whole-board tree from taskFiles on every create/done commit, so the next daemon board commit drops it, and reconcileBoard cannot restore it afterwards (the tip no longer has it). Until that commit lands, a daemon restart (fresh lastMirrorHash) or a splitter spawn by the not-yet-merged main checkout can bring the file back: re-check `git show refs/heads/meta/kanban:.kanban/AGENTS.splitter.md` after the merge.
- Boundary restated from the Specs (root SPECS.md untouched as instructed): the splitter bullet's inline-injection byte-cap hazard is moot for pi, its spawn now carries no --append-system-prompt at cwd = root.
