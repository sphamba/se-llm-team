---
name: "fix: developer prompt states the wrong dead-agent transition"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
agents/developer.md line 19 says a dead agent moves the task to to-review. The code is correct and moves it back to to-do (DEAD_TRANSITIONS, src/orchestrator.ts:304: doing → to-do). Fix the prompt line to match the code.

# Specs
Fix the wrong claim in the Developer prompt.

Changes:
- agents/developer.md line 19 currently reads: "A dead agent without a state update moves the task to to-review anyway, so always update the notes."
- The code already does the right thing: DEAD_TRANSITIONS (src/orchestrator.ts:304) maps doing → to-do, so a dead Developer's task moves back to to-do.
- Change the line to: "A dead agent without a state update moves the task back to to-do anyway, so always update the notes."

Acceptance:
- The prompt line matches the code behavior.
- agents/ was checked: this is the only file with the claim; no other prompt mentions it.

Constraints:
- Only agents/developer.md changes.

# Notes
