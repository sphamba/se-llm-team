---
name: "fix: daemon renders agent prompts from its own checkout, not the task worktree"
priority: "low"
state: "done"
worktree: ""
---

# Summary
The daemon loads role prompts from its own checkout (HERE/../agents in src/orchestrator.ts), not from the task worktree. A prompt fix in a worktree branch applies only after that branch merges, so agents spawned before the merge get the old prompt. Either read the prompt from the task worktree when it exists, or document that prompt fixes apply only after the merge.

# Specs
# Decision (user): direction 2, document only. No code changes.

# Need

Document that prompt fixes on a task worktree branch take effect only after that branch merges.

# Context (verified finding)

src/orchestrator.ts line 107 loads the role prompt with readFileSync(join(HERE, "..", "agents", `${role}.md`)). HERE is the daemon's own checkout, so the daemon always renders prompts from the main repo, never from the task worktree. A prompt fix committed on a task worktree branch is not visible to the daemon until that branch merges. Verified live during task 000004's live test: agents spawned between fix and merge got the old prompt; after the merge, respawns got the new prompt and the pipeline self-heals.

# Required behavior

1. Add one or two sentences to the docs that describe the agent prompt workflow (README.md pipeline section; SPECS.md if it mentions prompts): the daemon renders role prompts from its own checkout at each spawn; prompt fixes made on a task worktree branch apply only after that branch merges, so do not rely on prompt changes taking effect before the merge.
2. No code changes. Do not change src/orchestrator.ts.

# Constraints

- Minimal diff, docs only.

# Acceptance criteria

- README.md (and SPECS.md where relevant) states the behavior.
- `node src/kanban.test.ts && node src/orchestrator.test.ts` still pass.

# Notes
- [2026-10-10 17:24] Merge conflict for branch fix/daemon-renders-agent-prompts-from-its-own-checkout-not-the-task-worktree, merger spawned (attempt 1).
- README.md Agents section: added two sentences. The orchestrator reads the role prompt from `agents/` in its own checkout at each spawn. A prompt fix on a task worktree branch applies only after that branch merges, so do not rely on a prompt change before the merge. SPECS.md has no prompt mention, so it needed no change. No code changes. Tests pass: node src/kanban.test.ts && node src/orchestrator.test.ts. Commit ef1ed22.
- Review: pass. Diff main...HEAD touches README.md only (1 insertion, 1 deletion), docs-only as required. The added sentences state the required behavior: prompt render from the daemon's own checkout at each spawn, and prompt fixes on a worktree branch apply only after merge. Verified SPECS.md has no prompt mention, so no SPECS.md change was needed. Verified src/orchestrator.ts is unchanged. Tests pass: node src/kanban.test.ts && node src/orchestrator.test.ts. No fixes made; state set to to-live-test.
- Live test: pass. Worktree clean at commit ef1ed22, diff main...HEAD touches README.md only (1 insertion, 1 deletion), no code changes. The new sentences in the README Agents section state the required behavior and match the code: src/orchestrator.ts line 107 loads the role prompt with readFileSync(join(HERE, "..", "agents", `${role}.md`)), so the daemon renders from its own checkout at each spawn, and a worktree-branch prompt fix lands only after merge. SPECS.md confirmed to have no prompt mention, so no change needed there. Checks pass from the worktree: node src/kanban.test.ts (all assertions passed) and node src/orchestrator.test.ts (pipeline + liveness smoke passed). The live spawn of this live-tester by the running daemon exercised the documented prompt render path. No issues found.
- [2026-10-10 19:27] Merge resolution (attempt 1): the conflicted merge found in the main checkout belonged to branch fix/orchestrator-smoke-test-leaks-daemon-processes (src/orchestrator.test.ts, both modified); its merger resolved it and committed it as 717c369 while this merger inspected, so this branch (docs-only, README.md) was still unmerged. Merged fix/daemon-renders-agent-prompts-from-its-own-checkout-not-the-task-worktree into main cleanly (ort strategy, no conflict): README.md 1 insertion, 1 deletion, merge commit 4402ac7 on top of 40a9ff2 (the done commit for 000003). Resolution: main's Kanban board and done-with-worktree wording kept, branch's two prompt sentences kept in the Agents section, both intents preserved, nothing dropped. Tests pass from the main checkout: node src/kanban.test.ts (all assertions passed), node src/orchestrator.test.ts (pipeline + liveness smoke passed). No code changes, src/orchestrator.ts untouched. Task file left uncommitted for the orchestrator's done commit.
