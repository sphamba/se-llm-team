---
name: "fix: live-tester prompt prohibition and notes distill"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#279"
complexity: "moderate"
shortName: "doctor-minimal-notes-live-tester"
---

# Summary
Live-tester slice of #281 (content half of #279): replace in agents/live-tester.md the instruction to edit .kanban/AGENTS.live-tester.md with an explicit prohibition (the doctor maintains it), and one-time distill that notes file to the new contract (at most 20 durable task-agnostic bullets, task specifics deleted). Heaviest distill: 98 KB, 165 bullets, 151 task citations today. Developer slice is a sibling subtask; the doctor/code half is #280.

# Specs
# Need

Role agents currently append to .kanban/AGENTS.live-tester.md during runs (the shipped live-tester prompt instructs it) and the file carries task-specific war stories. Stop the appending in the prompt and one-time distill the file to the new contract: at most 20 top-level bullets, durable task-agnostic guidance only, the doctor as sole ongoing writer. This is the heaviest single distill in #281: the file is today 98.3 KB, 165 top-level bullets, 151 task-number citations.

# File ownership (hard boundary with siblings)

You own: agents/live-tester.md (prohibition sentence) and .kanban/AGENTS.live-tester.md (one-time distill).
Do NOT touch: agents/doctor.md, anything under src/ or tests/ (task #280 owns them), or the other four role prompts and notes files (sibling subtasks own developer, reviewer, merger, splitter). No test changes: this task's acceptance is grep-based.

# Changes

1. agents/live-tester.md: replace the guidance sentence at line 16 ("Your project-specific guidance loads into your context as AGENTS.md (the real file lives at .kanban/AGENTS.live-tester.md; editing AGENTS.md edits it). Edit it for project-specific things future agents of your kind need, e.g. how to run the project; you may rewrite or compact existing sections.") with an explicit prohibition: the notes file is read-only for the role agent, the doctor rewrites it after every run. Keep the edit to that one guidance paragraph; touch nothing else in the file.
2. One-time distill of .kanban/AGENTS.live-tester.md in this checkout. Keep at most 20 durable, task-agnostic bullets covering the role-wide kernel: the run-order discipline (one pass, no re-derivation), the fixture-shape and Playwright disciplines, shell traps, report and run discipline, and the general shape of the canonical recipes, all stripped of citations and per-task stories. Drop outright, never archive: task-number citations (#NNN), measured per-task values, incident logs and war stories, stale sections, the whole "Per-task recipes" section (its durable technique generalizes into the recipe kernel), and the opening header's append-discipline clause ("append a new lesson as ONE bullet, routed per Report discipline", old-contract material). Useful durable guidance survives; specifics die.

# Notes-file edit mechanics

The .kanban/AGENTS.*.md files are shared board files (untracked, mirrored by the daemon; worktrees share the board). Edit .kanban/AGENTS.live-tester.md in place. Your deliverable commit carries only the agents/live-tester.md prohibition edit. Do not git-add or commit anything under .kanban/.

# Constraints

- agents/doctor.md is out of scope: the doctor is the sanctioned writer of the notes files.
- Do not touch the splitter inline-injection byte cap (out of scope, noted hazard only).

# Acceptance criteria (grep-checkable from the repo root)

- grep -n "Edit it for project-specific\|append what future agents" agents/live-tester.md returns no matches; agents/live-tester.md carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent).
- .kanban/AGENTS.live-tester.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.

# Notes
