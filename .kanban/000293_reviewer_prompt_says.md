---
name: "feat: reviewer prompt says use subagents"
priority: "high"
state: "live-testing"
worktree: "feat/293-reviewer-prompt-says"
issuer: "user"
complexity: "trivial"
---

# Summary
Add the developer's generic subagent line to the reviewer prompt so the reviewer can delegate research or parallel sub-work, and pin the sentence in the rendered-prompt test. New capability decided in the grill-me interview: nothing to restore ever existed for the reviewer.

# Specs
# Context

The user believes the reviewer losing subagent usage is a regression. Facts established this session: agents/reviewer.md NEVER mentioned subagents in its full git history (task #23, commit 9545a07, explicitly scoped "use subagents" wording to agents/developer.md and agents/live-tester.md only); the current .kanban/AGENTS.reviewer.md has no subagent bullet; a sample of the 40 most recent reviewer run logs shows zero subagent spawns. So this is a NEW capability, not a restore — decided as such in the grill-me interview (2026-10-20). agents/developer.md:22 already carries the wording to mirror: "For research or parallel sub-work, use subagents."

This task is filed BEFORE the README task (000... docs: describe the tool and agent chain) because that task's Mermaid diagram draws subagents under both Developer and Reviewer, which is only truthful after this change lands.

# Changes

- agents/reviewer.md: add one sentence mirroring the developer's wording: "For research or parallel sub-work, use subagents." Place it with the review steps (after the step that reviews the changes via git log/diff, before the fix/state steps). Do not touch the state steps, the test-policy sentence ("Never run the full test suite..."), or any other line.
- tests/orchestrator/merge.test.ts part AL (rendered-prompt pins over all five prompts, around lines 433 and 448-463): extend the reviewer pin so the rendered reviewer prompt must contain the new sentence.

# Acceptance

- Scoped suites green per repo policy: tests/orchestrator/merge.test.ts, promote.test.ts, spawn.test.ts (the suites covering agents/*.md and the pins), each exit 0.
- The rendered reviewer prompt contains the exact sentence; no other prompt changes.

# Constraints

- Only agents/reviewer.md and the reviewer pin in tests/orchestrator/merge.test.ts change. No notes file, no skill, no code.

# Notes
- Added step 3 to agents/reviewer.md: "For research or parallel sub-work, use subagents." (developer wording verbatim). Renumbered the following steps 4-8. Moved no other line; the state steps and the test-policy sentence are unchanged.
- Extended the rendered reviewer prompt pin in tests/orchestrator/merge.test.ts part AL with the exact sentence.
- complexity: trivial, so no test-first run was done; the required pin was part of the Specs and is added.
- Scoped suites green, each exit 0: tests/orchestrator/merge.test.ts, promote.test.ts, spawn.test.ts. Full suite not run per repo policy.
