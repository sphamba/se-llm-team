---
name: "docs: agents state their big assumptions affecting the feature"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: "#144"
issuer: "user"
complexity: "simple"
shortName: "agents-state-big-assumptions"
---

# Summary
Agents are instructed to state their big assumptions that affect the feature, so the PM and user can verify every choice aligns with the user/client vision before it hardens into code.

# Specs
Current facts: agents/developer.md, agents/reviewer.md and agents/live-tester.md (read from src/orchestrator.ts renderPrompt :194-202 via HERE/../agents/<role>.md) share an open-questions paragraph after the Task/Task-file header; developer step 4 appends to the # Notes section append-only and the open-questions paragraph says to list open (user/client clarification) questions in a # Open questions section placed after # Notes; SKILL.md:27-33 already demands "nothing is silently assumed" in the PM's interview but no agent prompt asks agents to surface their assumptions.

Changes, agent prompts only (no src changes):
- agents/developer.md: the open-questions paragraph gains an instruction that alongside open questions the developer states the big assumptions made about the feature (scope, behavior, constraints, integrations) in that same section, each as one line, so the PM and user can confirm or correct them before the choice hardens; assumptions stay listed even when the developer is confident.
- agents/reviewer.md: the same paragraph gains that the reviewer calls out any big assumption the developer made silently (visible in the diff but not stated in the task) and treats unvoiced assumptions affecting the feature's direction as review findings.
- agents/live-tester.md: the same paragraph gains that the live-tester states the assumptions it made while designing usage tests and flags any observed behavior that contradicts the task's stated assumptions.
- The append-only # Notes and # Open questions section rules stay intact; the placeholder render is untouched; SKILL.md needs no change because the PM flow already folds answers into Specs.

Tests: none beyond a sanity check that renderPrompt still resolves all four roles (the existing orchestrator tests cover prompt rendering); verify each edited file renders with the {{ROOT}}/{{TASK_FILE}} placeholders intact.
