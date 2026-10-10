---
name: "docs: role agents get extension tools from the main checkout, so new tools are invisible until merge"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
Role agents run in worktrees but pi loads the se-llm-team extension from the global symlink ~/.pi/agent/extensions/se-llm-team, which resolves to the main checkout, so tools added on an unmerged branch are invisible to role agents until merge. Document this gap (or make the extension load path follow the worktree) so live-testers of new tools know to verify via fixtures and code inspection instead of invoking the tool.

# Specs
# Need

Make the extension-tool visibility gap explicit for role agents, so a live-tester asked to exercise a brand-new tool does not fail (or stall) because the tool is not registered in its session.

# Facts (evidence from the 000007 live test)

- The live-tester session for task 000007 was started at 17:54:29, before the 17:56:56 merge that brought the branch into main.
- That session had orchestrator_start, orchestrator_status, and orchestrator_stop, but NOT the new orchestrator_poke tool, so it could not invoke the tool it was testing; it verified via code inspection and fixtures instead.
- Root cause: pi loads the extension from the global symlink ~/.pi/agent/extensions/se-llm-team, which resolves to the main checkout, while role agents run in .worktrees/ copies.

# Required behavior

Pick one (docs option preferred for a minimal change):
1. Docs option: in the PM skill and/or the role agent prompts, state that role agents run in worktrees but the se-llm-team extension is loaded from the main checkout, so tools added on an unmerged branch are not available to agents until merge; live-testers of new tools must verify via fixtures and code inspection (and say so in their report) until the branch is merged.
2. Code option: make the extension load path resolve against the task worktree so agents see newly added tools immediately.

# Constraints

- If the docs option is chosen: minimal diff, docs only, no code changes. Coordinate with task 000012 (session role boundary in the PM skill intro) to avoid conflicting edits to skills/se-llm-team/SKILL.md.

# Acceptance criteria

- The gap is documented in the PM skill or the role prompts (or the load path follows the worktree, if the code option is taken).
- A live-tester prompt for a new tool instructs verifying via fixtures/code until the branch merges.

# Notes
Discovered by the live-tester of task 000007, which could not invoke orchestrator_poke and fell back to code inspection and fixtures.
