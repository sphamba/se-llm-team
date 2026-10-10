---
name: "fix: role agents edit the worktree copy of the task file, so the pipeline stalls"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Role agents append Notes and set state in the worktree copy of the task file instead of the main one. The daemon watches only the main .kanban/, so tasks stall in doing/reviewing and the poll burns respawns. Make the prompts explicit that task file edits always target the main checkout file.

# Specs
# Need

The pipeline stalls when a role agent updates the wrong copy of the task file.

# Verified evidence (task 000001)

- The Reviewer finished: its log (.kanban/.logs/000001....reviewer.log) says it appended review findings to the task Notes and set the state to to-live-test.
- But it edited the worktree copy: .worktrees/fix/commit-kanban-tasks-only-on-create-and-done/.kanban/000001_fix_commit_kanban_tasks_only_on_create_and_done.md says state "to-live-test".
- The main .kanban/000001_fix_commit_kanban_tasks_only_on_create_and_done.md still says "reviewing". The daemon watches only the main .kanban/, so it never saw to-live-test. The task stalls and the liveness poll re-spawns a reviewer (capped at 5).
- The Developer of the same task edited the MAIN file correctly (developer note present in the main file Notes). So agents resolve the same prompt differently.

# Root cause

All prompts in agents/*.md contain both:
- "Task file: {{TASK_FILE}}" (absolute path into the main checkout), and
- "Work only inside {{WORKTREE}}. Never touch the main checkout or other worktrees."
Nothing says that the task file edits are the exception. Agents pick either copy.

# Required behavior

1. In agents/developer.md, agents/reviewer.md and agents/live-tester.md, add one explicit line: Notes appends and state changes must always edit the file at {{TASK_FILE}} in the main checkout, even though all other work happens inside {{WORKTREE}}. "Never touch the main checkout" applies to code, not the task file.
2. Check agents/merger.md for the same ambiguity and fix it the same way if present.
3. No daemon changes. No code changes.

# Constraints

- Minimal diff, prompt files only.
- The running daemon reads prompt files at each spawn, so the fix takes effect on the next spawn without a restart.

# Acceptance criteria

- Each prompt states that {{TASK_FILE}} in the main checkout is the only file to edit for Notes and state.
- `node src/kanban.test.ts && node src/orchestrator.test.ts` still pass (no code change expected).

# Notes
