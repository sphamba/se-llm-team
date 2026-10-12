---
name: "feat: per-role project notes in .kanban loaded at agent spawn"
priority: "medium"
state: "done"
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

# Notes
- spawnAgent (src/orchestrator.ts) now calls ensureRoleNotes first: .kanban/AGENTS.<role>.md is created when missing with a one-line starter header naming the role, and every spawn adds --append-system-prompt <path> pointing at the role's file. The flag sits after -p; pi reads the value as file contents when the path exists, so create-if-missing always runs before the spawn.
- listAll (src/kanban.ts) filters AGENTS.*.md out of the task list: the files carry no frontmatter and would otherwise parse as backlog tasks, get promoted by promoteBacklog, and spawn a phantom developer run. They stay in taskFiles, so the meta/kanban mirror's whole-board snapshot commits (create/done) carry them, and reconcileBoard materializes them on clone or external loss.
- Each agents/<role>.md gained the spec's paragraph, placed at the end of the file so the first .kanban/*.md path in the rendered prompt stays the task file (the test stubs and log matching resolve the task file by first match).
- New orchestrator.test.ts part AS: a full stub pipeline asserts the role file is created when missing, the starter header names the role, every spawn of each role carries --append-system-prompt <root>/.kanban/AGENTS.<role>.md, listAll shows no AGENTS files, and showTip finds all four notes files on the meta/kanban mirror after the done commit.
- Check: full npm test passes, all five suites (kanban, orchestrator, webui, extension, index); existing spawn-flag and rendered-prompt asserts untouched.
- Review: the diff matches the Specs. Checked pi's source: the CLI exposes the repeatable --append-system-prompt flag, and its resource-loader reads the value as file contents when the path exists, so the create-before-spawn order holds. The agents/<role>.md paragraph sits at the end of all four files, so the first .kanban/*.md path in the rendered prompt stays the task file. The notes files ride the whole-board snapshot commits (create/done); part AS asserts showTip finds all four on meta/kanban. No silent assumptions beyond the ones below.
- Reviewer fix (0aee405): ROLE_NOTES_RE was ^AGENTS\..+\.md$, so a bare AGENTS.md in .kanban (the pi context-file name a user might try here) still parsed as a phantom backlog task and got promoted. Widened to ^AGENTS(\..+)?\.md$; part AS now writes a bare AGENTS.md and asserts it stays frontmatter-less and un-promoted. Full npm test green after the fix.
- Verified behavior (the former open-question assumptions, all confirmed in code, so no user questions remain):
  - The daemon spawns only the four pipeline roles; any AGENTS.<name>.md in .kanban is board noise, never a task (now includes the bare AGENTS.md name).
  - The starter is a one-line header plus open space below; ensureRoleNotes never rewrites an existing file, so agent-appended guidance below the header stays.
  - The notes files reach meta/kanban with the next create or done commit; a board idle after the first spawn keeps them local-only until then.
  - A deleted notes file is restored either by reconcileBoard from the mirror tip (when the file was already mirrored and the mirror head moves) or re-created with the fresh starter at the next spawn (when not mirrored yet). Either way the file comes back; old content returns only from the tip.
  - The flag passes one absolute path per role, <root>/.kanban/AGENTS.<role>.md; no per-worktree copy. Worktrees symlink .kanban to the shared board (syncBoard), so guidance written from a worktree session lands on the shared file.
- Re-review after the reviewer fix (0aee405): the widened ROLE_NOTES_RE covers both AGENTS.<role>.md and a bare AGENTS.md; the new part AS assert confirms a bare AGENTS.md stays frontmatter-less and un-promoted. Re-verified in code: ensureRoleNotes imports (existsSync/writeFileSync) present, taskFiles keeps the notes files in the mirror snapshots, taskNum ignores them in number scans, renderPrompt resolves {{TASK_FILE}} by direct placeholder so the end-of-file paragraph placement is safe. Full npm test green, all five suites, existing asserts untouched. No new findings, no user questions.
- Merge: step 1 (main into feat/160-kanban-agents-role-notes in the worktree) was already up to date, no conflicts, so the test suites were skipped per the merge protocol. Step 2 (feat/160-kanban-agents-role-notes into main on the project root) was a clean fast-forward (b5e551c..0aee405), 7 files, +85/-3. No conflicts resolved, no fixes needed.
- Live test (project root at merged 0aee405, daemon restarted as a user would after the merge, isolated scratch clone for the probe runs, real pi CLI for the context check):
  - Role file creation: a daemon run on a scratch clone created .kanban/AGENTS.developer.md before the developer spawn, with the one-line starter header naming the role. The same run created AGENTS.merger.md and AGENTS.reviewer.md for the merger and reviewer spawns. The live-tester role was not spawned live, it uses the same shared spawnAgent path.
  - Spawn flag: every observed spawn argv carried --append-system-prompt <root>/.kanban/AGENTS.<role>.md after -p, and the role file existed at spawn time (the stubbed agent read the starter content back).
  - Real loading: pi --append-system-prompt <file> -p "<question>" answered a marker appended to the notes file, so the file contents reach the agent context.
  - Filter: AGENTS.md, AGENTS.ghost.md and the role notes were never promoted and never spawned (autoScheduleMinutes 0.05, so promotion ran every sweep). The files stayed frontmatter-less.
  - Mirror: the next create commit and the next done commit both carried every notes file on refs/heads/meta/kanban, and the push reached the scratch origin.
  - Real board after the daemon restart: the running daemon created .kanban/AGENTS.reviewer.md before it spawned the reviewers of 000164 and 000166, and the raw reviewer logs contain the reviewer starter header. .kanban/AGENTS.live-tester.md was created by hand (the pre-merge daemon could not create it), and no phantom task or spawn appeared for any AGENTS file.
  - Usage test assumptions: (1) a stubbed agent binary is a valid stand-in for the spawn half, and the real pi CLI call covers the file-loading half; (2) live coverage of developer, merger and reviewer plus the shared spawnAgent code covers the live-tester role; (3) the isolated clone runs the merged code but a scratch board and a scratch origin, so the real board and mirror stay untouched.
  - Out of scope, pre-existing (not from this diff): orchestrator_start redirects the daemon stdout into the same file that log() appends to, so every real-board daemon log line appears twice; and a fresh clone bootstraps the mirror create-time snapshot of an in-flight task, so 000160 came back as backlog and was re-promoted in the scratch clone.
  - Result: no findings. All Specs behaviors matched the observed behavior.

# Open questions
