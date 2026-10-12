---
name: "docs: agents state their big assumptions affecting the feature"
priority: "medium"
state: "done"
worktree: ""
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

## Live test (2026-10-12)

The live test rendered each changed role prompt the way src/orchestrator.ts does it (all six placeholders substituted, no {{...}} left) and delivered it to a real pi agent with the exact daemon spawn shape: `pi --approve --mode json --provider RCP --model <per-role model> --thinking max -p "<prompt>"`, cwd = a task worktree. The fixtures are scratch git repos in /tmp/live145, one per role, each with a task file and a worktree. Three runs, one per role, all exit 0. The unit test suite was not run.

- Developer: the fixture Specs left the option behavior open (`demo.sh --greeting <text>`). The agent implemented the option, committed, appended the work, and wrote two one-line assumptions in the # Open questions section after # Notes: other options are rejected with exit 1, and the greeting is printed once with no decoration. The assumptions stayed listed although the agent was confident. Pass.
- Reviewer: the fixture diff silently made JSON the default output and moved the old output behind an undocumented `--plain` flag. The review called this out as a silent interface inversion and treated it as a finding ("The developer silently inverted the interface (default became JSON, old output moved behind an undocumented flag)"), then fixed the diff. Pass.
- Live-tester: the fixture Specs say `--tag` prints to stdout and exits 0, while the branch writes to stderr and exits 1. The report flagged the contradiction explicitly ("Observed behavior contradicts the task's stated assumption"), stated four test-design assumptions, set the state to to-merge, and created two follow-up tasks (the missing-value case) through the PM flow. Pass.

No product issue found. The diff touches only the three agent files. merger.md and src are untouched, the append-only Notes rule holds, and the placeholder render leaves no unresolved {{...}}.

# Open questions

No open questions.

Live-test design assumptions:
- The rendered prompt text is the interface under test. The daemon spawn command and the per-role model flags from ~/.pi/agent/se-llm-team.json for a simple task reproduce the real delivery.
- A scratch git repo in /tmp with the same task frontmatter and one worktree per task is a valid stand-in for a real board task.
- In the scratch worktrees .kanban is a real directory. In the real worktrees .kanban is a symlink to the main board, so I read the state and the reports from both copies.
- One rollout per role is a sample of prompt compliance, not a statistical guarantee.
