---
name: "feat: worktree SPECS.md and AGENTS.md symlinks simplify agent prompts"
priority: "medium"
state: "to-merge"
worktree: "feat/188-worktree-symlink-context"
issuer: "user"
complexity: "moderate"
shortName: "worktree-symlink-context"
blockedBy: ""
---

# Summary

Following #187, symlink the task file as SPECS.md and the role notes as AGENTS.md at the worktree root, created before each agent spawn and removed after each agent termination. Pi auto-loads AGENTS.md from cwd, so the prompts lose their absolute paths and the --append-system-prompt flag.

# Specs
## Symlinks (orchestrator, per spawn and per termination)
- Before spawning any role, in the task's worktree root create or refresh two symlinks (idempotent, re-point every time):
  - SPECS.md -> .kanban/<taskFile>. The .kanban board is already symlinked into the worktree, so edits through this link land on the task file in the main checkout; the task-file exception rule keeps working.
  - AGENTS.md -> .kanban/AGENTS.<role>.md, re-pointed per role, so the correct role guidance loads. AGENTS.md is a recognized pi context file, so it loads from cwd at session start with no spawn flag.
- After each agent termination remove both symlinks: hook the same places where the orchestrator already clears the agent pid (dead-pid bounce, task leaving the working state, doneCleanup). The worktree removal at done covers the last case.
- ensureRoleNotes keeps creating .kanban/AGENTS.<role>.md; the files are the symlink targets.
- Add AGENTS.md and SPECS.md to the repo .gitignore, so agents never commit the symlinks (worktrees share the checked-out .gitignore).

## Optional file on the kanban tools (index.ts, src/kanban.ts)
- kanban_get, kanban_update and kanban_set_state make the file parameter optional. When omitted, the task resolves from the cwd: readlink of SPECS.md in ctx.cwd gives the .kanban/<taskFile> target; its basename feeds the existing getTask. Helper resolveTaskFromCwd(root) in src/kanban.ts.
- No SPECS.md symlink (a PM session in the main checkout, or the symlinks removed after termination): the tool reports "no task; pass the file name or run from a worktree with SPECS.md". No fallback to frontmatter guessing.
- kanban_delete and kanban_set_worktree keep the required file (PM tools; kanban_delete is destructive).
- Tool descriptions gain "file is optional; resolved from the cwd SPECS.md symlink when omitted".

## Prompt plumbing (renderPrompt, spawnAgent, agents/*.md)
- Drop the --append-system-prompt flag from spawnAgent; the AGENTS.md symlink replaces it.
- No path placeholder survives: {{TASK_FILE}}, {{NAME}} and {{PRIORITY}} are all dropped. The header line becomes "Task file: SPECS.md in your cwd (the task file in the main checkout)"; the task-file-exception and open-questions paragraphs reference SPECS.md. Per #187 only the reviewer keeps state moves: its kanban_get and kanban_set_state calls take no file argument (resolved from the cwd SPECS.md). Notes and open-question edits are file edits on SPECS.md.
- renderPrompt loses the {{ROOT}} (except the reviewer, see below), {{TASK_FILE}}, {{WORKTREE}}, {{WORKTREE_NAME}}, {{NAME}} and {{PRIORITY}} replaceAll lines.
- {{WORKTREE}} -> cwd prose ("work only here / in the worktree you run in").
- {{WORKTREE_NAME}} in agents/merger.md -> the merger resolves its branch with git branch --show-current in its cwd; the {{ROOT}}/.worktrees path templates disappear (after #187 the merger touches only its worktree).
- Reviewer diff base (agents/reviewer.md step 2): the reviewer diffs against the branch the project root checkout has checked out (git -C {{ROOT}} branch --show-current), never a hardcoded main (git diff <base>...HEAD). This is the one remaining {{ROOT}} use in reviewer.md.
- {{ROOT}} -> remove where the symlinks and #187 cwd make it redundant: the guidance line becomes "Project-specific guidance for your role is loaded into your context as AGENTS.md" (the real file lives at .kanban/AGENTS.<role>.md; editing AGENTS.md edits it), the merger's git -C root commands are gone, the live-tester runs from its cwd. Keep {{ROOT}} only where a use remains (the reviewer's base-branch resolution).

## Tests
- tests/kanban.test.ts: resolveTaskFromCwd resolves a task through a SPECS.md symlink, and returns undefined without one.
- tests/orchestrator.test.ts, test D (worktree board symlink) gains asserts: SPECS.md and AGENTS.md exist before spawn, AGENTS.md points at the role's notes file, they are re-pointed for the next role, and they are removed after the agent terminates.
- Tool-level asserts (index/extension suites): kanban_set_state with no file moves the task behind cwd SPECS.md; without SPECS.md it errors.
- Spawn-args and renderPrompt asserts: no --append-system-prompt flag; the prompt carries no absolute task-file or worktree path and no {{NAME}}/{{PRIORITY}}.
- The reviewer prompt assert: step 2 carries the base-branch resolution (git -C {{ROOT}} branch --show-current) and no hardcoded git diff main.
- Fold the #187 test rework (A/G/K/K2/AL, ff-sync test) together with these where they touch the same helpers.

## Docs
- README.md: the agent cwd table and spawn description mention the SPECS.md and AGENTS.md symlinks replacing --append-system-prompt, and the optional file on the agent-facing kanban tools.
- skills/se-llm-team/SKILL.md: the per-role notes description moves from --append-system-prompt to the AGENTS.md symlink.

# Notes
- The SPECS.md name deliberately reuses the historical name at the worktree root only. It is the task file, not the deleted project documentation.
- Implemented all spec items: ensureContextSymlinks/clearContextSymlinks in src/orchestrator/spawn.ts (idempotent re-point, removes lstat-confirmed symlinks only, logs through log(root, ...)), hooked in src/orchestrator/liveness.ts at bounceDead and at the poll dead-pid path; renderPrompt(root, role) substitutes {{ROOT}} only for the reviewer (base-branch resolution); spawnAgent dropped --append-system-prompt; resolveTaskFromCwd(root) in src/kanban.ts plus the optional file parameter on kanban_get, kanban_update and kanban_set_state in index.ts (NO_TASK message exactly per spec); all four role prompts reworked around "Task file: SPECS.md in your cwd"; repo .gitignore gains AGENTS.md and SPECS.md; README Agents and Tools sections updated.
- Two test fixes came out of the full-suite run: (1) the shared fixture() in tests/orchestrator.test.ts now commits a .gitignore containing AGENTS.md and SPECS.md. Without it, the stubs' blanket git add -A committed the context symlinks into each branch, and merges then conflicted on the differing symlink targets, which parked lane one behind the merger retry idle cooldown and hung part R ("lane one completed"). (2) Part X's merger xFlags call now attributes the spawn by task name (taskX2.name) like the wait above it, because the stub reads the task from the cwd SPECS.md and the prompt carries no file path.
- npm test green (exit 0: kanban, orchestrator, webui, extension, index suites). Ad hoc strict tsc on the changed src files: no new errors vs HEAD.
- SKILL.md docs item skipped: SKILL.md has no per-role notes description mentioning --append-system-prompt or AGENTS.md, so there is no existing text to move.
- Second pass (verification and completion): reviewed the whole uncommitted diff against the Specs, all items were in place. Added the missing reviewer prompt assert (renderPrompt(rootAL, "reviewer"): step 2 carries git -C <root> branch --show-current, no hardcoded git diff main, no absolute task-file or worktree path, no placeholder), which also uses the previously unused renderPrompt import.
- Full-suite run exposed a pre-existing part Q flake ("in-flight write mirrored after the reconcile", also fails at HEAD, confirmed by stash-and-run): the in-flight task is a worktree-less backlog task with no openQuestions, so promoteBacklog rewrote it (state -> to-do) between the PM write and its create commit, and the byte-for-byte assert raced the promotion. Fix: the in-flight write now carries an open question, which holds it in backlog and matches the test's intent. Two consecutive orchestrator runs green after the fix.
- Committed as 86ac682 on feat/188-worktree-symlink-context. npm test green (exit 0: kanban, orchestrator, webui, extension, index suites).
- Review pass (to-merge): every spec item checked against the code and no fixes needed. Symlinks: ensureContextSymlinks re-points in the worktree root at every spawn; clearContextSymlinks is hooked at bounceDead and at the poll dead-pid path; the done worktree removal covers doneCleanup. Tools: resolveTaskFromCwd + optional file on kanban_get, kanban_update and kanban_set_state with the exact NO_TASK message; kanban_delete and kanban_set_worktree keep the required file. Prompts: no --append-system-prompt, no placeholders anywhere, the reviewer keeps the one {{ROOT}} for git -C {{ROOT}} branch --show-current, the merger resolves its branch in its cwd. .gitignore, README, tests all match the Specs. All five suites green in a reviewer run (exit 0 each).
- Verified the live-agent clobber concern from the Notes assumptions: spawnAgent plus the state move run in the same synchronous sweep block, and the poll checks only the pid of the state's own role (the project-wide merger pid for merging, the task slug otherwise), so a symlink clear can never land between a spawn re-point and the next session's cwd read. The re-point-while-winding-down assumption holds.
- Two deliberate behaviors worth knowing, both consistent with the Specs: repointContextSymlink silently replaces a real (non-symlink) file at SPECS.md or AGENTS.md in the worktree root (only directories are refused); clearContextSymlinks computes the cwd as join(.worktrees, task.worktree), which matches ensureWorktree for every worktree the orchestrator creates.
- No developer/live-tester prompt assert for absolute paths: renderPrompt does no substitution for those roles, so the prompt cannot carry one by construction; the part AL asserts cover the two roles where substitution happens (merger, reviewer). Accepted as adequate.
- Merge of main (#189, bbd7510) resolved in src/orchestrator/liveness.ts only: main renamed getMergerLogSlug to readMergerSlug (spawn.ts) and our branch added clearContextSymlinks to the same import line. Resolved to one import with all four names (clearContextSymlinks, clearExitFile, readExitCode, readMergerSlug); the old getMergerLogSlug no longer exists. Git auto-merged the rest (main's readMergerSlug requeue block in poll, our two clearContextSymlinks calls). Committed as 98f601f; no conflict markers left, node --check passes on the resolved file.

# Open questions

None.

Assumptions:
- Worktree-less tasks always get a worktree ensured before the developer spawn (startTodo), so the context symlinks are never created in the main checkout; the clear-side worktree "" skip is defensive only.
- The symlinks are safe to re-point while a previous agent session is winding down (re-point happens at spawn, before the new session reads its cwd).
- Agents never commit the symlinks because the worktrees share the checked-out .gitignore, and the orchestrator test fixtures mirror that .gitignore.
