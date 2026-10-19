---
name: "fix: developer prompt prohibition and notes distill"
priority: "high"
state: "to-do"
worktree: ""
issuer: "#279"
complexity: "moderate"
shortName: "doctor-minimal-role-notes-developer"
---

# Summary
Developer-role slice of #281 (content half of #279): replace in agents/developer.md the instruction to edit .kanban/AGENTS.developer.md with an explicit prohibition (the doctor maintains it), and one-time distill that notes file to the new contract (at most 20 durable task-agnostic bullets, task specifics deleted). Reviewer, live-tester, merger and splitter slices are sibling subtasks; the doctor/code half is #280.

# Specs
# Need

Role agents currently append to .kanban/AGENTS.developer.md during runs (the shipped developer prompt instructs it) and the file carries task-specific war stories. Stop the appending in the prompt and one-time distill the file to the new contract: at most 20 top-level bullets, durable task-agnostic guidance only, the doctor as sole ongoing writer.

# File ownership (hard boundary with siblings)

You own: agents/developer.md (prohibition sentence) and .kanban/AGENTS.developer.md (one-time distill).
Do NOT touch: agents/doctor.md, anything under src/ or tests/ (task #280 owns them), or the other four role prompts and notes files (sibling subtasks own reviewer, live-tester, merger, splitter). No test changes: this task's acceptance is grep-based.

# Changes

1. agents/developer.md: replace the guidance sentence at line 26 ("Your project-specific guidance loads into your context as AGENTS.md (the real file lives at .kanban/AGENTS.developer.md; editing AGENTS.md edits it). Edit it for project-specific things future agents of your kind need, e.g. how to run the project; you may rewrite or compact existing sections.") with an explicit prohibition: the notes file is read-only for the role agent, the doctor rewrites it after every run. Keep the edit to that one guidance paragraph; touch nothing else in the file.
2. One-time distill of .kanban/AGENTS.developer.md in this checkout: today 56.6 KB, 104 top-level bullets, 28 task-number citations. Keep at most 20 durable, task-agnostic bullets across the surviving sections (Task start, Scope and process discipline, Running and testing, Test-harness waits, Temp fixture scripts, Stale-test triage, Test recipes, Environment and safety, Live webui checks). Drop outright, never archive: task-number citations (#NNN), per-task recipes, measured per-task values, incident logs and war stories, stale sections, and the opening header's append-discipline sentence ("editing this file is the recorded way to keep lessons", old-contract material). Useful durable guidance survives; specifics die.

# Notes-file edit mechanics

The .kanban/AGENTS.*.md files are shared board files (untracked, mirrored by the daemon; worktrees share the board). Edit .kanban/AGENTS.developer.md in place. Your deliverable commit carries only the agents/developer.md prohibition edit. Do not git-add or commit anything under .kanban/.

# Constraints

- agents/doctor.md is out of scope: the doctor is the sanctioned writer of the notes files.
- Do not touch the splitter inline-injection byte cap (out of scope, noted hazard only).

# Acceptance criteria (grep-checkable from the repo root)

- grep -n "Edit it for project-specific\|append what future agents" agents/developer.md returns no matches; agents/developer.md carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent).
- .kanban/AGENTS.developer.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.

# Notes
