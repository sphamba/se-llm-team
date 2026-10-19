---
name: "fix: reviewer, splitter and merger prompt prohibitions and notes distill"
priority: "high"
state: "to-do"
worktree: ""
issuer: "#279"
complexity: "moderate"
shortName: "doctor-minimal-notes-small-roles"
---

# Summary
Reviewer, splitter and merger slice of #281 (content half of #279): replace in the three prompts the instructions to edit or append .kanban/AGENTS.<role>.md with explicit prohibitions (the doctor maintains them; the splitter wording must cover its inline-injection path), and one-time distill the three notes files to the new contract (at most 20 durable task-agnostic bullets each). Developer and live-tester slices are sibling subtasks; the doctor/code half is #280.

# Specs
# Need

Role agents currently append to .kanban/AGENTS.<role>.md during runs (the shipped reviewer, splitter and merger prompts instruct it) and the files carry task-specific war stories. Stop the appending in the three prompts and one-time distill the three files to the new contract: at most 20 top-level bullets each, durable task-agnostic guidance only, the doctor as sole ongoing writer.

# File ownership (hard boundary with siblings)

You own: agents/reviewer.md, agents/splitter.md, agents/merger.md (prohibition sentences) and .kanban/AGENTS.reviewer.md, .kanban/AGENTS.splitter.md, .kanban/AGENTS.merger.md (one-time distills).
Do NOT touch: agents/doctor.md, anything under src/ or tests/ (task #280 owns them), or the developer and live-tester prompts and notes files (sibling subtasks own them). No test changes: this task's acceptance is grep-based.

# Changes

1. agents/reviewer.md and agents/merger.md: replace the guidance sentence (reviewer line 23, merger line 19: "Your project-specific guidance loads into your context as AGENTS.md (the real file lives at .kanban/AGENTS.<role>.md; editing AGENTS.md edits it). Edit it for project-specific things future agents of your kind need, e.g. how to run the project; you may rewrite or compact existing sections.") with an explicit prohibition: the notes file is read-only for the role agent, the doctor rewrites it after every run.
2. agents/splitter.md: replace the guidance sentence at line 15 ("Your project-specific guidance lives in .kanban/AGENTS.splitter.md in the main checkout: append what future agents of your kind need there (e.g. how to run the project, how to live-test). This session has no AGENTS.md symlink in its cwd: the project's own root AGENTS.md stays in place, and the role notes ride the appended system prompt.") with the same prohibition, worded so it covers the splitter's inline-injection path: no AGENTS.md symlink in cwd, the notes ride the appended system prompt, and the file is still read-only for the role agent (the doctor rewrites it after every run).
3. Three one-time distills in this checkout, each: at most 20 durable, task-agnostic bullets (role map, recipes, general shell traps, workflow tips); drop outright, never archive: task-number citations (#NNN), per-task recipes, measured per-task values, incident logs and war stories, stale sections, and each file's append-discipline header clause. Useful durable guidance survives; specifics die.
   - .kanban/AGENTS.reviewer.md: 20.9 KB, 67 top-level bullets, 0 citations, dense per-run procedural text to generalize (Shape, Recon, Re-reviews, Checks, Tests, Coverage map, Findings, Files, Facts that bite, Situational checks).
   - .kanban/AGENTS.splitter.md: 11.5 KB, 29 bullets, 3 citations, mostly per-task split-decision war stories; the durable kernel is the symlink/tool-argument mechanics and the parallel-split patterns (disjoint file ownership, shared-file attachment to one subtask, new-files-only variant).
   - .kanban/AGENTS.merger.md: 2.2 KB, 5 bullets, 0 citations, already close to the contract; drop the append header and trim.

# Notes-file edit mechanics

The .kanban/AGENTS.*.md files are shared board files (untracked, mirrored by the daemon; worktrees share the board). Edit the three files in place. Your deliverable commit carries only the three agents/*.md prohibition edits. Do not git-add or commit anything under .kanban/.

# Constraints

- agents/doctor.md is out of scope: the doctor is the sanctioned writer of the notes files.
- Do not touch the splitter inline-injection byte cap (out of scope, noted hazard only).

# Acceptance criteria (grep-checkable from the repo root)

- grep -n "Edit it for project-specific\|append what future agents" agents/reviewer.md agents/splitter.md agents/merger.md returns no matches; each of the three carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent); the splitter wording covers the inline-injection path.
- For each of .kanban/AGENTS.reviewer.md, .kanban/AGENTS.splitter.md, .kanban/AGENTS.merger.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.

# Notes
