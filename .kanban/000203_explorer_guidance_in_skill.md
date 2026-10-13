---
name: "docs: Explorer guidance travels in SKILL.md; drop the project-level agent file"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "explorer-guidance-in-skill"
---

# Summary
Delete .pi/agents/explorer.md (a project-level pi agent that only loads in this repo) and fold its briefing into skills/se-llm-team/SKILL.md, so the fact-finding delegation works from a PM session in any project. No manifest change.

# Specs
## Need

The Explorer agent type is defined as a project-level pi agent (.pi/agents/explorer.md). It loads only when a pi session runs in this repo directory. A PM session in another project (the normal use of the se-llm-team skill) has no "explorer" type, so the skill's fact-finding delegation cannot work there. Remove the project-level definition and carry the description in skills/se-llm-team/SKILL.md, so the guidance travels with the skill to any project.

Facts (verified): .pi/agents/explorer.md is the only file under .pi/ and is tracked in git. Its content is: frontmatter (name: explorer, description: "Explorer that gathers info on the codebase and external resources (repo, code, docs, web) for a task or question; read-only.") plus a body ("You are the Explorer of the se-llm-team pipeline. Job: gather facts for the Project manager when planning or exploring a task. Read code, docs, and board files; search the web for accurate, up-to-date library usage when the question needs it. Report findings concisely: file paths with line numbers, key decisions, open questions. Never edit files, never create tasks, never spawn agents."). The only reference to the type outside that file is skills/se-llm-team/SKILL.md line ~28: "Delegate fact-finding to an Explorer subagent (subagent_type explorer): it gathers info on the codebase and external resources when planning and exploring a task."

## Changes

1. Delete .pi/agents/explorer.md (git rm). It is the only tracked file under .pi/, so `git ls-files .pi/` prints nothing afterwards. Remove the empty .pi/ dirs from disk when git leaves them.
2. skills/se-llm-team/SKILL.md, the role-split bullet in the step 2 interview: replace the sentence that names the registered type with a subagent_type-independent instruction that carries the briefing inline. Keep the sentence "Never ask the user what you can look up yourself." and the rest of the bullet unchanged. The new fact-finding sentence names a generic subagent type (e.g. subagent_type subagent) and folds in the explorer.md content, staying concise (2-3 sentences):
   - The subagent gathers info on the codebase and external resources (repo, code, docs, web) when planning and exploring a task.
   - Its briefing: gather facts for the Project manager; read code, docs and board files; search the web for accurate, up-to-date library usage when the question needs it; report findings concisely with file paths, line numbers, key decisions and open questions.
   - It is read-only: never edit files, never create tasks, never spawn agents.
3. No other line of SKILL.md changes. The "A question downstream of a running exploration waits for it to report" sentence keeps working as is.

## Constraints and edge cases

- package.json stays untouched: no pi.subagents key, no new agents/ directory (the package-declared subagent option was declined).
- No new agent-definition files anywhere; the skill text is the only carrier of the briefing.
- Stale SKILL.md copies under .worktrees/ are branch checkouts; leave them.
- No code or test changes: no test exercises the explorer agent or agent-definition loading.

## Acceptance criteria

- `git ls-files .pi/` prints nothing.
- `test ! -e .pi/agents/explorer.md && echo ok` prints ok.
- `rg -n "subagent_type explorer" . --glob '!.worktrees' --glob '!node_modules' --glob '!.git'` exits 1 (no matches in tracked files).
- `rg -n "fact-finding subagent" skills/se-llm-team/SKILL.md` matches the new sentence, which names a generic subagent type and carries the briefing inline.
- `npm test` passes (five suites).

# Notes
