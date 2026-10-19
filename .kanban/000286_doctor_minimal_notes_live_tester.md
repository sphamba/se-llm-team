---
name: "fix: live-tester role prompt prohibition and notes distill"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#281"
complexity: "moderate"
shortName: "doctor-minimal-notes-live-tester"
---

# Summary
Live-tester piece of the content half of #279: replace the notes-editing instruction in agents/live-tester.md with an explicit prohibition (the doctor maintains the notes file), and one-time distill .kanban/AGENTS.live-tester.md (98 KB, the largest notes file) to the new contract (at most 20 durable task-agnostic bullets, task specifics deleted). Two sibling subtasks cover the developer and reviewer/merger/splitter roles; #280 owns the code half.

# Specs
# Need

Role agents currently append to .kanban/AGENTS.<role>.md during runs (the shipped role prompts instruct it) and the files carry task-specific war stories. For the live-tester role: stop the appending in the prompt and one-time distill the notes file to the new contract: at most 20 bullet lines, durable task-agnostic guidance only, the doctor as sole ongoing writer.

# File ownership (hard boundary)

You own: agents/live-tester.md (one paragraph) and .kanban/AGENTS.live-tester.md (one-time distill).
Do NOT touch: agents/doctor.md (sibling code task #280 owns it), agents/analyst.md, the other four role prompts or their notes files (sibling content subtasks own them in parallel), anything under src/ or tests/. No test changes: this task's acceptance is grep-based.

# Changes

1. agents/live-tester.md: replace this sentence (the file's only notes-guidance paragraph, keep the edit to that one paragraph, touch nothing else):
   "Your project-specific guidance loads into your context as AGENTS.md (the real file lives at .kanban/AGENTS.live-tester.md; editing AGENTS.md edits it). Edit it for project-specific things future agents of your kind need, e.g. how to run the project; you may rewrite or compact existing sections."
   with an explicit prohibition: the notes file is read-only for the role agent, the doctor rewrites it after every run. Keep the AGENTS.md-symlink mechanics wording (where the real file lives) if useful, it is accurate.
2. One-time distill of .kanban/AGENTS.live-tester.md (currently 98311 bytes / 239 lines) in this checkout: at most 20 durable, task-agnostic bullet lines (repo map, build/test recipes, general shell traps, workflow tips). Drop outright, never archive: task-number citations (#NNN), per-task recipes (fixture shapes copied from past tasks), measured per-task values, incident logs and war stories, stale sections, and the file's in-file append-discipline header (the "compacted each run; append a new lesson as ONE bullet" line). Useful durable guidance survives; specifics die.

# Mechanical contract for the distill

- At most 20 bullet lines total: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' counts indented sub-bullets too, so nested bullets count against the cap. Headings (# and ##) do not count; keep valid markdown, one top-level heading plus ## subsections is fine.
- At most 8192 bytes (wc -c).
- Zero task-number citations: grep -c '#[0-9]' is 0.
- Keep the rules, lose the stories: a war story usually wraps a durable rule; rewrite the rule without the incident, the task numbers and the measured per-task values. The codebase-map and general shell/port/process-discipline sections are the durable core; the run-order bullets mix durable discipline with war stories, distill the discipline.

# Notes-file edit mechanics

The .kanban/AGENTS.*.md files are shared board files (untracked, mirrored by the daemon; worktrees share the board, the worktree .kanban symlink points at the main checkout's .kanban dir, so an edit from the worktree lands in the real notes file). Edit it in place; your deliverable commit carries only the agents/live-tester.md paragraph edit. Do not git-add or commit anything under .kanban/. Sibling subtasks distill the other notes files in parallel: never edit a notes file you do not own.

# Acceptance criteria (grep-checkable from the repo root)

- grep -n "Edit it for project-specific" agents/live-tester.md returns no matches; the guidance paragraph names the doctor as the maintainer and the file as read-only for the role agent.
- .kanban/AGENTS.live-tester.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.

# Constraints

- agents/doctor.md is out of scope: the doctor is the sanctioned writer of the notes files.
- Do not touch the splitter inline-injection byte cap (noted hazard only).

# Notes
