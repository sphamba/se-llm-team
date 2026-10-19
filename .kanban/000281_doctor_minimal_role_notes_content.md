---
name: "fix: role prompt prohibitions and one-time notes distill"
priority: "high"
state: "to-do"
worktree: ""
issuer: "#279"
complexity: "moderate"
shortName: "doctor-minimal-role-notes-content"
---

# Summary
Content half of #279: replace in the five role prompts (developer, reviewer, live-tester, merger, splitter) every instruction to edit or append .kanban/AGENTS.<role>.md with an explicit prohibition (the doctor maintains it), and one-time distill this repo's five .kanban/AGENTS.*.md files to the new contract (at most 20 durable task-agnostic bullets, task specifics deleted). Code half (doctor prompt, cap wiring, starter) is the sibling task.

# Specs
# Need

Role agents currently append to .kanban/AGENTS.<role>.md during runs (all five shipped role prompts instruct it) and the files carry task-specific war stories. Stop the appending in the prompts and one-time distill the files to the new contract: at most 20 top-level bullets per file, durable task-agnostic guidance only, the doctor as sole ongoing writer.

# File ownership (hard boundary with the sibling code task)

You own: agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, agents/splitter.md (prohibition sentences) and .kanban/AGENTS.developer.md, .kanban/AGENTS.live-tester.md, .kanban/AGENTS.merger.md, .kanban/AGENTS.reviewer.md, .kanban/AGENTS.splitter.md (one-time distill).
Do NOT touch: agents/doctor.md, anything under src/ or tests/ (the sibling owns them). No test changes: this task's acceptance is grep-based.

# Changes

1. Five role prompts (developer, reviewer, live-tester, merger, splitter): replace the sentence instructing the agent to edit or append the notes file (developer/reviewer/live-tester/merger each have "Your project-specific guidance loads into your context as AGENTS.md ... Edit it for project-specific things ... you may rewrite or compact existing sections"; the splitter has "append what future agents of your kind need there") with an explicit prohibition: the notes file is read-only for the role agent, the doctor rewrites it after every run. The splitter wording must cover its inline-injection path (no AGENTS.md symlink in cwd; the notes ride the appended system prompt; still read-only). Keep each edit to that one guidance paragraph; touch nothing else in the files.
2. One-time distill of the five .kanban/AGENTS.*.md files in this checkout: at most 20 durable, task-agnostic bullets each (repo map, build/test recipes, general shell traps, workflow tips). Drop outright, never archive: task-number citations (#NNN), per-task recipes, measured per-task values, incident logs and war stories, stale sections, and the live-tester's in-file append-discipline header. Useful durable guidance survives; specifics die.

# Notes-file edit mechanics

The .kanban/AGENTS.*.md files are shared board files (untracked, mirrored by the daemon; worktrees share the board). Edit them in place; your deliverable commit carries only the five agents/*.md prohibition edits. Do not git-add or commit anything under .kanban/.

# Constraints

- agents/doctor.md is out of scope: the doctor is the sanctioned writer of the notes files.
- Do not touch the splitter inline-injection byte cap (out of scope, noted hazard only).

# Acceptance criteria (grep-checkable from the repo root)

- grep -n "Edit it for project-specific\|append what future agents" over the five agents/*.md files returns no matches; each of the five carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent).
- For each of the five .kanban/AGENTS.<role>.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.

# Notes
