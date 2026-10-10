---
name: "docs: role prompts name an explicit pi command for subagents; just say use subagents"
priority: "medium"
state: "done"
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
- Replaced the headless pi instruction in agents/developer.md line 12 with "For research or parallel sub-work, use subagents."
- In agents/live-tester.md, dropped the "Run from {{ROOT}}:" line and the pi command. Kept the substance: report findings to a Project manager subagent, which reads the board with kanban_list and creates one kanban task per finding with kanban_create, never duplicating an existing not-done task. Kept the {{NAME}} and <YOUR FINDINGS> placeholders (the orchestrator still substitutes {{NAME}}).
- Verified: no "pi --approve" or "headless pi" remains in agents/*.md; only the two agent files changed. Committed as 16a27da.
- Review (16a27da): both changes match the specs. developer.md now says "use subagents" with no command. live-tester.md drops the pi invocation and the "Run from {{ROOT}}:" line, and keeps the substance: Project manager subagent, kanban_list, one kanban task per finding with kanban_create, never duplicating an existing not-done task. Confirmed {{NAME}} is still substituted by the orchestrator (src/orchestrator.ts). No fixes. State set to to-live-test.
- Live test (16a27da): PASS. (1) Grep over agents/*.md in the worktree finds no "pi --approve" or "headless pi". (2) Diff vs main touches only agents/developer.md (1 line) and agents/live-tester.md (4 lines removed, 1 line added), per the constraint. (3) Exercised the real render path: replicated the renderPrompt substitution chain from src/orchestrator.ts ({{ROOT}}, {{TASK_FILE}}, {{WORKTREE}}, {{WORKTREE_NAME}}, {{NAME}}, {{PRIORITY}}, in order) against both new templates with a sample task. No {{...}} placeholders left unrendered; step 5 {{NAME}} substituted; no pi command and no "Run from" line in the rendered prompts. (4) Repo-wide .md sweep (outside .kanban) finds no other prompt or doc that contradicts the new wording. (5) src/orchestrator.ts still spawns headless pi in code, which is the orchestrator's own spawn mechanism and out of scope per the constraint. No issues found, so no Project manager report per the new step 5.
