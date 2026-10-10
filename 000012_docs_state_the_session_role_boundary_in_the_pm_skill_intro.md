---
name: "docs: state the session role boundary in the PM skill intro"
priority: "low"
state: "backlog"
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
