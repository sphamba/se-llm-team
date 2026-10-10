---
name: "fix: developer prompt states the wrong dead-agent transition"
priority: "medium"
state: "done"
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
- Verified the code: DEAD_TRANSITIONS in src/orchestrator.ts maps doing -> to-do, so a dead agent's task moves back to to-do.
- Checked agents/: only agents/developer.md line 19 had the wrong claim; no other prompt mentions it.
- Fixed the line in agents/developer.md to: "A dead agent without a state update moves the task back to to-do anyway, so always update the notes."
- Committed in worktree fix/developer-prompt-states-the-wrong-dead-agent-transition as c5a95b3.
- Review passed. Commit c5a95b3 changes only agents/developer.md line 19 to: "A dead agent without a state update moves the task back to to-do anyway, so always update the notes."
- Verified against code: DEAD_TRANSITIONS (src/orchestrator.ts:304) maps doing -> to-do, so the prompt line now matches the behavior.
- Verified agents/ has no other prompt with the dead-agent transition claim. No fixes made.
- Live test (sandbox project, orchestrator run from worktree commit c5a95b3): created a task in state doing with a stale pidfile for a dead pid, ran `node src/orchestrator.ts --root <sandbox> --poll-minutes 0.02 --rescan-seconds 3`. Log showed `agent pid=<dead> dead without state update, doing -> to-do` and the task moved back to to-do, matching the fixed prompt line. Respawn cap also worked: after 5 dead spawns it logged `agent died 5+ times, giving up` and left the task at doing (pre-existing give-up path, by design).
- Live test (prompt rendering): set the sandbox agent to a script that dumps its args; captured the rendered Developer prompt. It ends with "A dead agent without a state update moves the task back to to-do anyway, so always update the notes." and all placeholders (NAME, TASK_FILE, WORKTREE) were substituted correctly.
- Live test result: pass. No issues found.
