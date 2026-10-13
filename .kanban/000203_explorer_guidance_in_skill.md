---
name: "docs: Explorer guidance travels in SKILL.md; drop the project-level agent file"
priority: "medium"
state: "done"
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

- Done in commit 9ab441f. Deleted .pi/agents/explorer.md with git rm and removed the empty .pi/ dirs. Replaced the step 2 interview bullet in skills/se-llm-team/SKILL.md: the sentence naming the registered type is now "Delegate a fact-finding subagent (subagent_type subagent): it gathers info on the codebase and external resources (repo, code, docs, web) when planning and exploring a task. Brief it to gather facts for the Project manager, read code, docs and board files, search the web for accurate, up-to-date library usage when the question needs it, and report findings concisely with file paths, line numbers, key decisions and open questions. The subagent is read-only: it never edits files, never creates tasks, never spawns agents." The rest of the bullet is unchanged.
- All acceptance criteria pass: git ls-files .pi/ empty, explorer.md gone, no "subagent_type explorer" matches outside .worktrees, the new sentence matches "fact-finding subagent", npm test passes (kanban, orchestrator, webui, extension, index).
- Flaky note, not a regression: the first npm test run hit a webui.test.ts timing flake at line 1461 ("a finished run keeps the parsed last - first", 5001 !== 5000). The fixture writes two Date.now()-derived timestamps ~10 min apart in one writeFileSync; when the two Date.now() calls straddle a millisecond boundary the computed duration gains 1 ms. Verified at HEAD with git stash (passed) and re-ran twice with the change (passed). No fix made here: this task forbids test changes. Upgrade path: freeze the timestamps in the fixture (constant strings), or compare duration in a >= check.
- No open questions; no assumptions beyond the Specs.

## Live test report (2026-10-13)

Tested the real user flow in a scratch non-repo project (/tmp/t203-otherproject). No findings.

- Acceptance checks pass: `git ls-files .pi/` prints nothing; `test ! -e .pi/agents/explorer.md` prints ok; `rg "subagent_type explorer"` exits 1; `rg "fact-finding subagent" skills/se-llm-team/SKILL.md` matches. The merge commit deletes .pi/agents/explorer.md, replaces one SKILL.md line, and touches no other file. package.json is untouched.
- Skill delivery: `pi -p -nt --no-session --no-context-files "/skill:se-llm-team Quote verbatim the step 2 role-split bullet"` in the scratch dir returns the new bullet verbatim, with the inline briefing and `subagent_type subagent`.
- Agent registry in another project: a JSON session in the scratch dir reports the Agent tool's available types as `subagent` only. `explorer` is absent. The global agent dir holds only subagent.md.
- Real delegation: a PM-style session in the scratch dir followed the skill. The recorded `tool_execution_start` for the Agent call shows `subagent_type: "subagent"`, the child prompt carries the briefing (read-only, read code/docs/board, web search, concise report with paths and open questions), and the subagent returned findings. The flow works from a project that has no explorer agent file.

Assumptions: `npm test` is the developer/reviewer gate, so this live test did not run the suites. Read-only pi sessions outside the board were enough; no daemon, no isolated HOME and no scratch origin were needed. No behavior contradicted the task's stated assumptions.
