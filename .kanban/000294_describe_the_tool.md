---
name: "docs: describe the tool and agent chain in the README"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
blockedBy: "#293"
---

# Summary
Give the README a 1-2 sentence description (PM skill, non-LLM deterministic orchestrator, kanban pipeline of headless agents), a bullet list of the six agent types in timeline order, and a Mermaid flowchart of the chain with subagents under developer and reviewer and one doctor node per notes-bearing role, all before Setup.

# Specs
# Context

Decided in the grill-me interview (2026-10-20). The README (104 lines) currently has only the one-sentence line 3 before ## Setup (line 5); it never describes the agents, and no Mermaid block exists repo-wide. Blocked by #293 so the diagram's reviewer-subagents node is truthful from the first commit.

# Facts to honor (verified this session)

- Roles: splitter, developer, reviewer, merger, live-tester (pipeline agents) plus doctor (not a pipeline stage: pass 2 of the per-run analysis, rewrites .kanban/AGENTS.<role>.md).
- Subagents: developer.md:22 and (after #293) reviewer.md tell those roles to use subagents for research or parallel sub-work. No other role does.
- Doctors exist per role for developer, reviewer, merger, live-tester. The splitter has no notes file and no doctor pass.
- The orchestrator is a non-LLM daemon (docs/architecture.md:11); the PM is the user's coding-agent session driven by the skill. Neither is an agent type, so they appear in the sentences, not as bullets.
- Flow: PM + skill -> .kanban board -> orchestrator daemon -> splitter (moderate/complex tasks first) -> developer (worktree) -> reviewer (decides to-review/to-merge/to-do itself) -> orchestrator merges (merger agent only on conflicts) -> live-tester -> done, then the doctor pass.

# Changes (all in README.md, between line 3 and ## Setup)

1. Rewrite line 3 into 1-2 short sentences: what the tool is — one skill turns the session into the Project manager; a non-LLM deterministic orchestrator daemon runs a kanban pipeline of headless coding agents. No more than two sentences.
2. A bullet list, each agent type in timeline order with a one-line description:
   - Splitter: decomposes moderate and complex tasks into parallel subtasks before development starts.
   - Developer: implements the Specs in an isolated worktree, may delegate research or parallel sub-work to subagents.
   - Reviewer: reviews the diff against the Specs, fixes minor mistakes itself, can bounce the task back to the developer; may use subagents (after #293).
   - Merger: resolves rebase conflicts only; the orchestrator merges clean branches itself.
   - Live-tester: runs the merged commit like a user and reports findings; never changes task states.
   - Doctor: after every run, distills what it learned into that role's notes file so future agents of the same role start faster (one per role for developer, reviewer, merger, live-tester).
3. A Mermaid flowchart TD, plain agent chain (no state labels, no subgraphs): PM -> board -> orchestrator -> splitter -> developer -> reviewer -> merger -> live-tester; subagent nodes hanging under developer and reviewer; four doctor nodes, each with an edge to "role notes" (or to its role). Keep node labels to one or two words plus a short role name; the diagram must render on GitHub (valid ```mermaid fence, flowchart TD syntax).
4. Do not touch the rest of the README (Setup, Using it, MCP server, Configuration, Documentation sections stay byte-identical); the docs/agents-and-tools.md link at the bottom stays.

# Acceptance

- Scoped suites covering README packaging (tests/plugin.test.ts) exit 0.
- The Mermaid block parses as valid flowchart TD (balanced fence, no HTML breaking GitHub rendering).
- Every agent fact in the bullets and diagram matches the list above (no splitter doctor, no subagents for splitter/merger/live-tester, doctor not a pipeline stage).

# Constraints

- Only README.md changes. No docs/ rewrites, no skill changes, no code.

# Notes
