---
name: "docs: role prompts name an explicit pi command for subagents; just say use subagents"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
agents/developer.md and agents/live-tester.md tell agents to run explicit headless pi processes (pi --approve -p "...") for sub-work. Replace that with "use subagents", without specifying how.

# Specs
The role prompts hard-code how to run subagents. Remove the mechanism, keep the substance.

Changes:
- agents/developer.md line 12: replace "For research or parallel sub-work, run extra headless pi processes: `pi --approve -p "<sub-task>"`." with an instruction to use subagents, without any command (for example: "For research or parallel sub-work, use subagents.").
- agents/live-tester.md lines 15-17: the instruction currently says "Run from {{ROOT}}:" followed by a full pi command that embeds the report prompt. Drop the explicit pi invocation and the "Run from {{ROOT}}:" line. Keep the message substance: the agent reports its findings to a Project manager subagent, which reads the board with kanban_list and creates one kanban task per finding with kanban_create, never duplicating an existing not-done task.

Acceptance:
- No "pi --approve" or "headless pi" remains in agents/*.md.
- The subagent message substance (kanban_list, one task per finding, no duplicates) stays.

Constraints:
- Only agents/developer.md and agents/live-tester.md change. No other prompt, skill, or code file.

# Notes
