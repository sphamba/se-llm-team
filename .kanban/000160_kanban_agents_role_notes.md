---
name: "feat: per-role project notes in .kanban loaded at agent spawn"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: ""
issuer: "user"
complexity: "moderate"
shortName: "kanban-agents-role-notes"
---

# Summary
Project-specific per-role agent instructions live in .kanban/ as AGENTS.<role>.md (developer, reviewer, merger, live-tester), are loaded into every spawned agent of that role at spawn via pi's repeatable --append-system-prompt flag, and agents are instructed to modify their role's file with project-specific things so future agents of the same kind start working faster (e.g. how to run the project, how to live-test).

# Specs
Design facts (verified): pi loads context files from the agent dir, the working dir and its ancestors, all applying simultaneously, with no env var to add an arbitrary extra context file; the closest flag is the repeatable --append-system-prompt <text|path> which appends an existing file to the system prompt and applies to all modes including headless --mode json. A symlink at root would leak into user sessions and every agent type; a worktree symlink is untracked git noise. Naming: AGENTS.<role>.md (proper .md extension, sorts together in .kanban/, no discovery risk since pi matches only exact names like AGENTS.md).

Changes (src/orchestrator.ts + src/orchestrator.test.ts + agents/developer.md + agents/reviewer.md + agents/merger.md + agents/live-tester.md):
- The daemon ensures .kanban/AGENTS.<role>.md exists before spawning any agent (create-if-missing with a one-line starter header naming the role and telling agents to append project-specific guidance here), and spawnAgent (:277) adds --append-system-prompt <path> pointing at the role's file for every role.
- The files live in .kanban/ so the existing meta/kanban mirror carries them; verify the reconcile commits the new files to meta/kanban.
- Each agents/<role>.md gains a short paragraph: project-specific guidance for your role lives at {{ROOT}}/.kanban/AGENTS.<role>.md and is loaded into your context at spawn; modify it to put project-specific things for future agents of your kind (e.g. how to run the project, how to live-test) so they start faster; keep it concise; never remove other agents' guidance.
- Placeholders {{ROOT}}/{{TASK_FILE}}/{{WORKTREE}}/{{NAME}}/{{PRIORITY}} stay intact.

Tests: the orchestrator suite covers the spawn flags (the role file is created when missing and passed via --append-system-prompt) and the rendered-prompt asserts stay green; run the orchestrator suite as the check.
