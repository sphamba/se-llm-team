---
name: "fix: developer role prompt prohibition and notes distill"
priority: "high"
state: "done"
worktree: ""
issuer: "#281"
complexity: "moderate"
shortName: "doctor-minimal-notes-developer"
---

# Summary
Developer-role piece of the content half of #279: replace the notes-editing instruction in agents/developer.md with an explicit prohibition (the doctor maintains the notes file), and one-time distill .kanban/AGENTS.developer.md to the new contract (at most 20 durable task-agnostic bullets, task specifics deleted). Two sibling subtasks cover the live-tester and reviewer/merger/splitter roles; #280 owns the code half.

# Specs
# Need

Role agents currently append to .kanban/AGENTS.<role>.md during runs (the shipped role prompts instruct it) and the files carry task-specific war stories. For the developer role: stop the appending in the prompt and one-time distill the notes file to the new contract: at most 20 bullet lines, durable task-agnostic guidance only, the doctor as sole ongoing writer.

# File ownership (hard boundary)

You own: agents/developer.md (one paragraph) and .kanban/AGENTS.developer.md (one-time distill).
Do NOT touch: agents/doctor.md (sibling code task #280 owns it), agents/analyst.md, the other four role prompts or their notes files (sibling content subtasks own them in parallel), anything under src/ or tests/. No test changes: this task's acceptance is grep-based.

# Changes

1. agents/developer.md: replace this sentence (the file's only notes-guidance paragraph, keep the edit to that one paragraph, touch nothing else):
   "Your project-specific guidance loads into your context as AGENTS.md (the real file lives at .kanban/AGENTS.developer.md; editing AGENTS.md edits it). Edit it for project-specific things future agents of your kind need, e.g. how to run the project; you may rewrite or compact existing sections."
   with an explicit prohibition: the notes file is read-only for the role agent, the doctor rewrites it after every run. Keep the AGENTS.md-symlink mechanics wording (where the real file lives) if useful, it is accurate.
2. One-time distill of .kanban/AGENTS.developer.md (currently 56623 bytes / 137 lines) in this checkout: at most 20 durable, task-agnostic bullet lines (repo map, build/test recipes, general shell traps, workflow tips). Drop outright, never archive: task-number citations (#NNN), per-task recipes, measured per-task values, incident logs and war stories, stale sections. Useful durable guidance survives; specifics die.

# Mechanical contract for the distill

- At most 20 bullet lines total: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' counts indented sub-bullets too, so nested bullets count against the cap. Headings (# and ##) do not count; keep valid markdown, one top-level heading plus ## subsections is fine.
- At most 8192 bytes (wc -c).
- Zero task-number citations: grep -c '#[0-9]' is 0.
- Keep the rules, lose the stories: a war story usually wraps a durable rule; rewrite the rule without the incident, the task numbers and the measured per-task values.

# Notes-file edit mechanics

The .kanban/AGENTS.*.md files are shared board files (untracked, mirrored by the daemon; worktrees share the board, the worktree .kanban symlink points at the main checkout's .kanban dir, so an edit from the worktree lands in the real notes file). Edit it in place; your deliverable commit carries only the agents/developer.md paragraph edit. Do not git-add or commit anything under .kanban/. A sibling subtask distills the other notes files in parallel: never edit a notes file you do not own.

# Acceptance criteria (grep-checkable from the repo root)

- grep -n "Edit it for project-specific" agents/developer.md returns no matches; the guidance paragraph names the doctor as the maintainer and the file as read-only for the role agent.
- .kanban/AGENTS.developer.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.

# Constraints

- agents/doctor.md is out of scope: the doctor is the sanctioned writer of the notes files.
- Do not touch the splitter inline-injection byte cap (noted hazard only).

# Notes
- Replaced the notes-guidance paragraph in agents/developer.md (commit 98be333): the paragraph now says .kanban/AGENTS.developer.md is read-only for the role agent, the doctor maintains it and rewrites it after every run, and task-specific findings go to the task file's # Notes. The AGENTS.md symlink mechanics sentence is kept. Diff is 1 insertion, 1 deletion. No other lines touched.
- Found the notes-file distill already satisfied on disk: .kanban/AGENTS.developer.md is 6710 bytes / 33 lines (SPECS recorded 56623 bytes / 137 lines at task creation), with 4 sections of durable, task-agnostic guidance. Left it unchanged.
- Acceptance greps pass from the repo root: "Edit it for project-specific" returns 0 matches in agents/developer.md. Notes file: 18 bullet lines (cap 20), 0 '#[0-9]' citations, 6710 bytes (cap 8192). Nothing staged or committed under .kanban/ (board file, untracked). No test changes made, per Specs.
- Review at 98be333: commit touches only the developer.md guidance paragraph (1+/1-); new text names the doctor as maintainer, file read-only for the role agent, symlink mechanics wording kept. On-disk greps re-verified (18 bullets, 0 task citations, 6710 bytes); a read of .kanban/AGENTS.developer.md confirms durable task-agnostic guidance (build/test recipes, suite layout, shell traps, task-file bookkeeping), no war stories. Open question settled: the on-disk distill satisfies the mechanical contract, no rewrite needed. tests/plugin.test.ts exit=0 (the diff's only covered suite).

## Live test (2026-10-19)

- Setup: a fixture board and an isolated HOME. The merged daemon ran from this worktree (commit 98be333) with a fake agent that records each spawn. A probe task in state to-do made the daemon spawn the Developer role through the normal pipeline. The prompt check printed "12 checks, 0 failed". The daemon stopped from its own pidfile, and no fixture process is left.
- Prompt delivery (pass): the captured -p payload is byte-identical to this worktree's agents/developer.md with the single {{logStallMinutes}} placeholder replaced by the configured 60. It holds the new prohibition, names the doctor as the maintainer and rewriter, and routes task findings to the task file's # Notes. The old wording ("Edit it for project-specific" and the rewrite-or-compact sentence) is absent.
- Role context (pass): the developer cwd is the task worktree. The AGENTS.md link points to .kanban/AGENTS.developer.md and the SPECS.md link points to the probe task file. Both links resolve at agent startup, so the role agent loads the distilled notes file.
- Acceptance greps (22:12): "Edit it for project-specific" gives 0 matches in agents/developer.md. The notes file has 20 bullet lines (cap 20), 0 '#[0-9]' citations (cap 0), and 8182 bytes (cap 8192, sha256 84368204, mtime 22:08:36).
- Finding: the notes file does not hold the byte cap while other pipeline runs rewrite it. At the start of this live test (21:58:15) the file was 8455 bytes, over the 8192 cap, with 20 bullets and 0 citations. Routine doctor rewrites caused this: this task's developer doctor rewrote the file to 17 bullets and 7074 bytes, then the developer doctor of sibling task #279 added 3 bullets to the same shared role file, which gave the 8455-byte state. At 22:08:36 the developer doctor of sibling task #280 rewrote the file to 8182 bytes, back under the cap. The one-time-distill caps are a point-in-time property only. The doctor analysis for this task reports "Role file updated: 7074 bytes (limit 8192), 17 bullets (limit 20).", and those numbers do not match the file at that time (8455 bytes, 20 bullets).
- Assumptions: the fake agent replaces a real pi session because the change is prompt text. The fake records the exact argv that the daemon builds, so the test uses the real spawn path and no API calls. The notes file is a shared live board file that concurrent tasks rewrite, so the measurements carry a timestamp and a sha256. The fixture daemon ran the merged code from this worktree, so the rendered prompt came from this worktree's agents/developer.md.
- Technical note: the first check run read the worktree AGENTS.md and SPECS.md links after the daemon had cleared them, because the fake agent exits at once. The fake agent now records the links at startup. This was a check-script timing bug, not a product finding.


