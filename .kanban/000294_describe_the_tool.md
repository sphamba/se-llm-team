---
name: "docs: describe the tool and agent chain in the README"
priority: "medium"
state: "doing"
worktree: "docs/294-describe-the-tool"
issuer: "user"
complexity: "moderate"
blockedBy: ""
---

# Summary
Rewrite README.md and the three docs/*.md concise and human-readable: short sentences, general precise ideas, no exhaustive edge cases. The README gains the decided intro (1-2 sentences, agent bullet list, Mermaid chain) before Setup. Docs delegate full detail to links: agents/<role>.md prompts, skills/se-llm-team/SKILL.md, and source files.

# Specs
# Goal

The user: "The readme and the doc are impossible to read as a human (lengthy sentences, too much details). Make them all concise and clear. No need to be completely exhaustive, just give general (precise) ideas and put links to the prompts and skills for full details."

# Files

README.md, docs/architecture.md, docs/agents-and-tools.md, docs/development.md.

# Writing rules (all four files)

- Short sentences, one idea per sentence. No parenthetical chains, no multi-clause sentences.
- Keep the general behavior precise; drop edge cases, fallbacks and migration notes (e.g. retry cooldown details, quiet-gate exceptions, hub-election stale-daemon migration paragraphs shrink to a sentence or a link).
- Full detail moves to links: agents/<role>.md for each role's prompt, skills/se-llm-team/SKILL.md for the PM workflow, docs/*.md from the README, source files (src/orchestrator/*) where behavior lives.
- Facts must stay accurate: verify every kept claim against the code before writing it.

# README

- Keep the already-decided structure from this task's original spec: line 3 becomes the 1-2 sentence description (PM skill, non-LLM deterministic orchestrator, kanban pipeline of headless agents), then a bullet list of the six agent types in timeline order (one line each), then a Mermaid `flowchart TD` of the chain (plain chain, board node, subagents under developer and reviewer, one doctor node per notes-bearing role, no state labels), then `## Setup`.
- Trim the config table: Meaning cells keep the gist only (drop fallback/edge-case sentences). Keep table shape and all option names.
- Trim the MCP, Using-it and Configuration prose to short sentences. Keep all commands and paths exact.

# docs/

- architecture.md: keep section headings (Board, Orchestrator, Web dashboard); each state of the pipeline gets a short line, not a paragraph. Keep the state list exact.
- agents-and-tools.md: fix the two stale facts while rewriting: the live-tester ends with a finish message (no PM subagent), and the reviewer sets its own states (to-merge / to-review / to-do bounce) while the orchestrator moves the task on successful finish. Link each role to its agents/<role>.md file.
- development.md: already short; just tighten sentences.
- Do not delete information a reader needs to run or operate the tool (commands, config keys, paths, state names).

# Acceptance

- pnpm test scoped suites green (README is only a fixture in tests, no content pins exist today).
- Every Mermaid block renders on GitHub (fenced ```mermaid, valid flowchart syntax).
- A skim test: each file readable start to finish with only short sentences.

# Notes

Splitter note: no split. The task runs as one developer pass.

Why:

- The write surface is four small files: README.md (104 lines) and docs/ (101 lines total). One agent holds all of it in context.
- The four files describe the same six roles and the same state pipeline. The README agent bullets, the README Mermaid chain, the architecture state lines and the agents-and-tools role table must agree. A split derives those facts twice. It also puts the two stale-fact fixes (live-tester finish message, reviewer state writes) in a different subtask from the Mermaid that shows the same behavior.
- Fact checking against agents/*.md and src/orchestrator/* is the main cost. Parallel subtasks repeat it.
- Two or three review, merge and live-test cycles for a prose change cost more than the wall clock saved.

Durable guidance for future Splitters: a docs rewrite does not parallelize by file when the files share the same facts. Split a docs task only when the pieces touch disjoint fact sets, for example install and setup prose in one piece and a new document that no other file links to in another.
