---
name: "fix: reviewer, merger and splitter prompt prohibitions and notes distills"
priority: "high"
state: "doing"
worktree: "fix/287-doctor-minimal-notes-reviewer-group"
issuer: "#281"
complexity: "simple"
shortName: "doctor-minimal-notes-reviewer-group"
---

# Summary
Reviewer, merger and splitter piece of the content half of #279: replace the notes-editing instructions in the three prompts with explicit prohibitions (the doctor maintains the notes files; the splitter wording must cover its inline-injection path), and one-time distill their three .kanban/AGENTS.*.md files to the new contract (at most 20 durable task-agnostic bullets each, task specifics deleted). Two sibling subtasks cover the developer and live-tester roles; #280 owns the code half.

# Specs
# Need

Role agents currently append to .kanban/AGENTS.<role>.md during runs (the shipped role prompts instruct it) and the files carry task-specific war stories. For the reviewer, merger and splitter roles: stop the appending in the prompts and one-time distill their three notes files to the new contract: at most 20 bullet lines each, durable task-agnostic guidance only, the doctor as sole ongoing writer.

# File ownership (hard boundary)

You own: agents/reviewer.md, agents/merger.md, agents/splitter.md (one paragraph each) and .kanban/AGENTS.reviewer.md, .kanban/AGENTS.merger.md, .kanban/AGENTS.splitter.md (one-time distills).
Do NOT touch: agents/doctor.md (sibling code task #280 owns it), agents/analyst.md, agents/developer.md and agents/live-tester.md or their notes files (sibling content subtasks own them in parallel), anything under src/ or tests/. No test changes: this task's acceptance is grep-based.

# Changes

1. Three prompt paragraphs. Reviewer and merger carry the identical sentence shape (role name differs); keep the edit to that one paragraph, touch nothing else in each file. Reviewer old sentence:
   "Your project-specific guidance loads into your context as AGENTS.md (the real file lives at .kanban/AGENTS.reviewer.md; editing AGENTS.md edits it). Edit it for project-specific things future agents of your kind need, e.g. how to run the project; you may rewrite or compact existing sections."
   Merger old sentence: the same with .kanban/AGENTS.merger.md.
   Splitter old sentence (different shape, has no AGENTS.md symlink):
   "Your project-specific guidance lives in .kanban/AGENTS.splitter.md in the main checkout: append what future agents of your kind need there (e.g. how to run the project, how to live-test). This session has no AGENTS.md symlink in its cwd: the project's own root AGENTS.md stays in place, and the role notes ride the appended system prompt."
   Replace each with an explicit prohibition: the notes file is read-only for the role agent, the doctor rewrites it after every run. The splitter wording must cover its inline-injection path (no AGENTS.md symlink in cwd; the notes ride the appended system prompt; still read-only).
2. Three one-time distills in this checkout: at most 20 durable, task-agnostic bullet lines per file (repo map, build/test recipes, general shell traps, workflow tips). Current sizes: AGENTS.reviewer.md 20921 bytes / 97 lines, AGENTS.splitter.md 10856 bytes / 30 lines (grows slightly: a split-pattern bullet landed today), AGENTS.merger.md 2163 bytes / 7 lines. Drop outright, never archive: task-number citations (#NNN), per-task recipes, measured per-task values, incident logs and war stories, stale sections, in-file append-discipline headers. Useful durable guidance survives; specifics die.

# Mechanical contract for the distills

- Per file: at most 20 bullet lines total; grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' counts indented sub-bullets too, so nested bullets count against the cap. Headings (# and ##) do not count; keep valid markdown.
- Per file: at most 8192 bytes (wc -c); zero task-number citations (grep -c '#[0-9]' is 0).
- Keep the rules, lose the stories: a war story usually wraps a durable rule; rewrite the rule without the incident, the task numbers and the measured per-task values.

# Notes-file edit mechanics

The .kanban/AGENTS.*.md files are shared board files (untracked, mirrored by the daemon; worktrees share the board, the worktree .kanban symlink points at the main checkout's .kanban dir, so an edit from the worktree lands in the real notes file). Edit them in place; your deliverable commit carries only the three agents/*.md paragraph edits. Do not git-add or commit anything under .kanban/. Sibling subtasks distill the other notes files in parallel: never edit a notes file you do not own.

# Acceptance criteria (grep-checkable from the repo root)

- grep -n "Edit it for project-specific\|append what future agents" over agents/reviewer.md agents/merger.md agents/splitter.md returns no matches; each of the three carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent; the splitter one covers the inline-injection path).
- For each of .kanban/AGENTS.reviewer.md, .kanban/AGENTS.merger.md, .kanban/AGENTS.splitter.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.

# Constraints

- agents/doctor.md is out of scope: the doctor is the sanctioned writer of the notes files.
- Do not touch the splitter inline-injection byte cap (out of scope, noted hazard only).

# Notes
