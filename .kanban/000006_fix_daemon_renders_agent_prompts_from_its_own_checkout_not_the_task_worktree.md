---
name: "fix: daemon renders agent prompts from its own checkout, not the task worktree"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
The daemon loads role prompts from its own checkout (HERE/../agents in src/orchestrator.ts), not from the task worktree. A prompt fix in a worktree branch applies only after that branch merges, so agents spawned before the merge get the old prompt. Either read the prompt from the task worktree when it exists, or document that prompt fixes apply only after the merge.

# Specs
Live test of task 000004 (fix: role agents edit the worktree copy of the task file, so the pipeline stalls) found one low-severity issue.

Finding: src/orchestrator.ts line 107 loads the role prompt with readFileSync(join(HERE, "..", "agents", `${role}.md`)). HERE is the daemon's own checkout, so the daemon always renders prompts from the main repo, never from the task worktree. A prompt fix committed on a task worktree branch is not visible to the daemon until that branch merges.

Evidence, verified live:
- Task 000004 updated all 3 prompt files (developer, reviewer, live-tester) with an exception line, and tests pass. The daemon spawned each role once for that task, with no respawns, so the fix works.
- The developer of task 000005, spawned after the 000004 fix commit but before the merge, received a prompt without the exception line.
- The reviewer of task 000002 also received a prompt without the exception line.

Impact, bounded: after the merge, respawns get the new prompt, so the pipeline self-heals. But in-flight tasks may stall briefly and burn respawn attempts with the old prompt.

Possible directions (choose one):
1. Make the daemon read the prompt file from the task worktree when the worktree exists, and fall back to its own checkout when it does not.
2. Document that prompt fixes apply only after the merge, so no work is done on prompt files that must be effective before a merge.

# Notes
