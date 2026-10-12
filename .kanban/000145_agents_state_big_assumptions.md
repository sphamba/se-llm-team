---
name: "docs: agents state their big assumptions affecting the feature"
priority: "medium"
state: "live-testing"
worktree: "docs/145-agents-state-big-assumptions"
blockedBy: ""
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

# Notes

Added the big-assumptions instruction to the shared open-questions paragraph in agents/developer.md, agents/reviewer.md and agents/live-tester.md (worktree docs/145-agents-state-big-assumptions, commit ae6ac71). Developer: states its big assumptions about the feature (scope, behavior, constraints, integrations) in the # Open questions section, one line each, kept listed even when confident. Reviewer: calls out any big assumption the developer made silently (visible in the diff but not stated in the task) and treats unvoiced assumptions that affect the feature's direction as review findings. Live-tester: states the assumptions it made while designing usage tests and flags observed behavior that contradicts the task's stated assumptions. No src changes, merger.md untouched, SKILL.md untouched, append-only Notes and Open questions rules intact.

Sanity check run: all four role files (developer, reviewer, live-tester, merger) render through the renderPrompt placeholder chain with no unresolved {{...}} left, {{TASK_FILE}} resolves, and each new assumption sentence is present in its file.

Review (commit ae6ac71): diff matches the Specs on all three agent prompts. developer.md states big assumptions about the feature (scope, behavior, constraints, integrations) as one-line entries in the # Open questions section, kept listed even when confident; reviewer.md calls out silent developer assumptions visible in the diff and treats unvoiced assumptions that affect the feature's direction as review findings; live-tester.md states its test-design assumptions and flags observed behavior that contradicts the task's stated assumptions. Append-only Notes and Open questions rules and the placeholder render are untouched; no src changes and SKILL.md untouched (diff touches only the 3 agent files). Reviewer re-ran the sanity check: renderPrompt placeholder chain over all four roles leaves no unresolved {{...}}, and each new assumption sentence is present. No fixes made.
