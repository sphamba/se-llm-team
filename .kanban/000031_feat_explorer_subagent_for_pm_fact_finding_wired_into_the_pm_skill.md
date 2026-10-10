---
name: "feat: Explorer subagent for PM fact-finding, wired into the PM skill"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
Add an Explorer agent description (.pi/agents/explorer.md, same pattern as watcher.md) and patch the PM skill to delegate fact-finding to an Explorer subagent when planning and exploring a task.

# Specs
Two files, one feature.

1. New file .pi/agents/explorer.md (project custom agent, same pattern as .pi/agents/watcher.md):
- Frontmatter: name: explorer; description: "Explorer that gathers info on the codebase and external resources (repo, code, docs, web) for a task or question; read-only."
- Body: You are the Explorer of the se-llm-team pipeline. Job: gather facts for the Project manager when planning or exploring a task. Read code, docs, and board files; search the web for accurate, up-to-date library usage when the question needs it. Report findings concisely: file paths with line numbers, key decisions, open questions. Never edit files, never create tasks, never spawn agents.

2. Patch skills/se-llm-team/SKILL.md, step 2 of the session flow:
- Current: "Ask the user what to build, or which feedback to turn into tasks. Ask clarification questions until you and the user agree. Find facts yourself (repo, code, docs). Leave decisions to the user."
- Change "Find facts yourself (repo, code, docs)." to: "Delegate fact-finding to an Explorer subagent (subagent_type explorer): it gathers info on the codebase and external resources when planning and exploring a task."
- Keep the rest of step 2 unchanged.

Acceptance:
- .pi/agents/explorer.md exists with frontmatter and body in the watcher.md pattern.
- SKILL.md step 2 instructs delegation to the Explorer subagent; no other skill text changes.
- No code changes.

Constraints:
- Only .pi/agents/explorer.md (new) and skills/se-llm-team/SKILL.md change.

# Notes

Developer: implemented per Specs in worktree, commit f9a8fec.
- Added .pi/agents/explorer.md (new): frontmatter name explorer + read-only fact-finder description, body in the watcher.md pattern (gathers code/docs/board/web facts, reports paths with line numbers, never edits/creates/spawns).
- Patched skills/se-llm-team/SKILL.md step 2 only: "Find facts yourself (repo, code, docs)." replaced with the Explorer-delegation sentence. No other skill text changed.
- No code changes. Verified diff: 2 files, 7 insertions, 1 deletion.

Reviewer: approved, no fixes. Commit f9a8fec reviewed against Specs.
- .pi/agents/explorer.md: frontmatter (name explorer + description) and body match the Spec word-for-word; same frontmatter-plus-paragraph pattern as .pi/agents/watcher.md.
- skills/se-llm-team/SKILL.md step 2: only "Find facts yourself (repo, code, docs)." replaced with the Explorer-delegation sentence; rest of step 2 ("Leave decisions to the user.") intact. No other skill text changed.
- git diff main...HEAD covers exactly the two Spec'd files (7 insertions, 1 deletion), no code changes, worktree clean.
- No fixes made, moving to to-live-test.

Live-tester: PASS. No issues found. Tested in worktree at commit f9a8fec.
- Acceptance checks: .pi/agents/explorer.md exists with frontmatter (name: explorer, read-only description) and body in the watcher.md pattern, word-for-word per Specs. SKILL.md step 2 carries the Explorer-delegation sentence with "Leave decisions to the user." intact; git diff main...HEAD covers exactly the two Spec'd files, no code changes, worktree clean.
- Live flow: spawned an Agent with subagent_type "explorer" from the worktree (the way the PM delegates fact-finding per step 2). The harness picked the agent up and its listed description matched the new frontmatter. The Explorer answered a read-only fact-finding question (orchestrator merge flow) in ~21 s with a concise report: file path with line numbers (src/orchestrator.ts mergeDone), key function names, and conflict-handling steps. Findings spot-checked against the code: accurate.
- Read-only behavior: worktree git status stayed clean after the Explorer ran; it edited nothing.
- Project check suite: node src/kanban.test.ts, all assertions passed.
- Note, expected behavior (documented in README "Extension load path"): ~/.pi/agent/skills/se-llm-team resolves to the main checkout, so the skill text change goes live for real PM sessions only after this branch merges. The explorer agent itself is live already for sessions run from the worktree, and will be live for the main checkout after merge.
- State set to done for merge.
