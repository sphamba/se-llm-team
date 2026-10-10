---
name: "docs: state the session role boundary in the PM skill intro"
priority: "low"
state: "done"
worktree: ""
---

# Summary
Clarify skills/se-llm-team/SKILL.md so invoking the skill makes the session role obvious: the session stops modifying project files directly, drives the board with kanban tools, and spawns the orchestrator with orchestrator_start.

# Specs
# Need

Invoking the se-llm-team skill must make the session's role boundaries obvious: after the skill is invoked, the session stops modifying project files directly, drives the pipeline with the kanban_* tools, and spawns the orchestrator daemon with orchestrator_start.

# Facts

- skills/se-llm-team/SKILL.md. Intro: "# se-llm-team / You are now the Project manager of this project's kanban pipeline." The Board section says "Use only the kanban_* tools for the board... Never edit board files directly" — that covers only board files, not repo files. The session flow mentions orchestrator_start in step 7.
- Task 000009 also edits this file (step 8 fix + Watcher section). Do not start this task until 000009 is done and merged, to avoid a file conflict.

# Required behavior

1. In the intro, right after "You are now the Project manager...", add a short role boundary, for example:
   - "From now on you do not modify project files directly: no code, no docs, no board files. Every change goes through the pipeline: create or update a task with the kanban tools, write the Specs, and the orchestrator's agents make the edits."
   - "You drive the pipeline: kanban_* tools for the board, orchestrator_start to run the daemon."
2. Keep it to a few lines. Do not restructure the file.
3. Keep everything task 000009 added (the Watcher section, the fixed step 8) intact.

# Constraints

- Minimal diff. Docs only, no code changes.

# Acceptance criteria

- The skill intro states: no direct file modifications, kanban tools for the board, orchestrator_start for the daemon.
- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass (they cover code, not docs; they must stay green).

# Notes
- Confirmed 000009 was done and merged; the worktree branch already contains its changes (Watcher section, fixed step 8).
- Added a two-line role boundary to the skills/se-llm-team/SKILL.md intro, right after the Project manager greeting: no direct project file modifications (code, docs, board files), every change goes through the pipeline via kanban tools and orchestrator agents, kanban_* tools for the board, orchestrator_start for the daemon. No other restructuring.
- Commit 7ce0dee. node src/kanban.test.ts and node src/orchestrator.test.ts pass.
- Review: HEAD is 7ce0dee, tree clean. Diff main...HEAD is only the 2-line SKILL.md intro addition. All required boundary statements present (no direct project file edits, kanban_* tools for the board, orchestrator_start for the daemon). Task 000009 additions (Watcher section, fixed step 8) intact. Ran both test suites again: pass. No fixes.
- Live test: HEAD 7ce0dee, tree clean, diff main...HEAD is only the 2-line SKILL.md intro addition placed right after the Project manager greeting. All three required statements present: no direct project file modifications (code, docs, board files), kanban_* tools for the board, orchestrator_start for the daemon. Matches the spec example text almost verbatim. Watcher section and fixed step 8 from 000009 intact; .pi/agents/watcher.md present.
- Live test: node src/kanban.test.ts and node src/orchestrator.test.ts pass from the worktree.
- Live test: loaded the skill in a real pi session from the worktree (pi --no-skills --skill skills/se-llm-team, invoked with /skill:se-llm-team). The session quoted the role sentence and the exact boundary paragraph and confirmed it mentions orchestrator_start. Frontmatter parses; the skill loads despite disable-model-invocation: true.
- Live test observation, not a defect: with default skill discovery, /skill:se-llm-team resolves to the global symlink ~/.pi/agent/skills/se-llm-team, which points at the main checkout and served the pre-change intro until merge. The repo skills/ dir is not a pi discovery location and the repo is not installed as a pi package, so after merge the symlink serves the updated intro and no collision remains.
- Live test result: pass. No issues found, no new tasks needed.
