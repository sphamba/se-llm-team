---
name: "feat: worktree SPECS.md and AGENTS.md symlinks simplify agent prompts"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "worktree-symlink-context"
blockedBy: "#187"
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

## Prompt plumbing (renderPrompt, spawnAgent, agents/*.md)
- Drop the --append-system-prompt flag from spawnAgent; the AGENTS.md symlink replaces it.
- {{TASK_FILE}} -> "SPECS.md": the "Task file:" header line and the task-file-exception and open-questions paragraphs reference SPECS.md (the task file in the main checkout, reached through the symlink).
- {{WORKTREE}} -> cwd prose ("work only here / in the worktree you run in"); the absolute path is no longer needed.
- {{WORKTREE_NAME}} in agents/merger.md -> the merger resolves its branch with git branch --show-current in its cwd; the {{ROOT}}/.worktrees path templates disappear (after #187 the merger touches only its worktree).
- {{ROOT}} -> remove where the symlinks and #187 cwd make it redundant: the guidance line becomes "Project-specific guidance for your role is loaded into your context as AGENTS.md" (the real file lives at .kanban/AGENTS.<role>.md; editing AGENTS.md edits it), the merger's git -C root commands are gone, the live-tester runs from its cwd. Keep any placeholder only where a use remains.
- Keep {{NAME}} and {{PRIORITY}}.

## Tests (tests/orchestrator.test.ts)
- Test D (worktree board symlink) gains asserts: SPECS.md and AGENTS.md exist before spawn, AGENTS.md points at the role's notes file, they are re-pointed for the next role, and they are removed after the agent terminates.
- Spawn-args asserts: no --append-system-prompt flag; the prompt carries no absolute task-file or worktree path.
- Fold the #187 test rework (A/G/K/K2/AL, ff-sync test) together with these where they touch the same helpers.

## Docs
- README.md: the agent cwd table and spawn description mention the SPECS.md and AGENTS.md symlinks replacing --append-system-prompt.
- skills/se-llm-team/SKILL.md: the per-role notes description moves from --append-system-prompt to the AGENTS.md symlink.

# Notes
- The SPECS.md name deliberately reuses the historical name at the worktree root only. It is the task file, not the deleted project documentation.
