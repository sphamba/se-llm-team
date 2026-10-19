---
name: "fix: reviewer, merger and splitter prompt prohibitions and notes distills"
priority: "high"
state: "done"
worktree: ""
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
- Prompt edits: agents/reviewer.md:23, agents/merger.md:19, agents/splitter.md:15. Each guidance paragraph now names the doctor as the notes-file maintainer and the file as read-only for the role agent ("That file is read-only for you: the doctor maintains it and rewrites it after every run. Never edit, append to or rewrite it; report durable guidance for future agents of your kind in your task's # Notes."). The splitter wording keeps the inline-injection path: no AGENTS.md symlink in its cwd, the notes ride the appended system prompt.
- Acceptance grep `grep -n "Edit it for project-specific\|append what future agents" agents/reviewer.md agents/merger.md agents/splitter.md` returns no matches (exit 1).
- One-time distills of the three shared board notes files (untracked, not part of the deliverable commit):
  - .kanban/AGENTS.reviewer.md: 20921 to 7848 bytes, 67 to 19 bullet lines, 0 citations. I wrote a 8153-byte / 19-bullet distill, then reviewer doctor runs for sibling tasks (#286, #280) rewrote the file four times (mtimes 22:07:06, 22:09:15, 22:12:14, 22:16:51), each folding lessons from the analysed reviewer run into the previous content; the last landed at 8700 bytes / 19 bullets, over the cap. I trimmed that text to 7848 bytes after the last three doctor writes. The file may be rewritten again by the next reviewer run before verification: the running daemon still has the old doctor prompt (no byte cap in src/ until #280 lands), which is why I left about 340 bytes of headroom.
  - .kanban/AGENTS.splitter.md: 30 to 10 bullet lines, 12015 to 6246 bytes, 3 to 0 citations. Kept the symlink/kanban-argument mechanics and the parallel-split patterns; dropped per-task split stories. Corrected the stale tests/webui.test.ts references to the current tests/webui/ per-area layout (the old file was dropped in commit 9673b45).
  - .kanban/AGENTS.merger.md: 5 to 0 bullet lines (prose sections), 2163 to 2262 bytes, 0 citations. Dropped the append-discipline header; kept inspect-once, rebase sides, GPG failure recovery, the test recipe and the SPECS.md symlink mechanics.
- Scoped check: `node tests/plugin.test.ts` exit 0 ("all assertions passed"). It is the only suite that covers agents/*.md; no test changes were needed.
- Deliverable commit: 504a083, three files changed, one paragraph each. Nothing under src/, tests/, agents/doctor.md or agents/analyst.md changed.

- Review (first review): total 2, +0 from the diff; all requirements pass, no fixes.
- Prompt prohibitions verified against 504a083: agents/reviewer.md:23, agents/merger.md:19, agents/splitter.md:15 each name the doctor as maintainer, mark the notes file read-only for the role agent and redirect durable guidance to the task's # Notes; the splitter paragraph keeps the inline-injection path (no AGENTS.md symlink in cwd, notes ride the appended system prompt). Acceptance grep for the old wording returns no matches (exit 1).
- Distill caps at review time: .kanban/AGENTS.reviewer.md 7848 B / 19 bullet lines / 0 citations, .kanban/AGENTS.merger.md 2262 B / 0 bullet lines (prose sections) / 0 citations, .kanban/AGENTS.splitter.md 6246 B / 10 bullet lines / 0 citations, all within the <=8192 B, <=20 bullet, 0-citation contract. Content is durable task-agnostic guidance: rules kept, war stories and task numbers gone; the splitter notes keep the prompt+notes-bundle pattern and the current tests/webui/ per-area layout.
- Claim checks: 9673b45 confirms the splitter-notes layout correction (tests/webui.test.ts dropped, tests/webui/ area files added); no doctor rewrite landed after the developer's trim (reviewer file still 7848 B). Deliverable touches exactly the three owned agents/*.md, one paragraph each; no src/, tests/, doctor or analyst files.
- Test union = tests/plugin.test.ts (coverage map: agents/*.md → plugin only; no test files in the diff): exit 0, all assertions passed. The spec's "no test changes" line holds: content-only prompt edits, no behavior change to cover.
- Open question settled by the Specs: the bullet cap is an upper bound measured by grep -cE, so the merger file's 0 prose-section bullets satisfy "at most 20"; assumption holds, question removed.

## Live test (2026-10-19)

- Lane: daemon end-to-end with a fake agent (scratch bare origin, fresh clone at /tmp/lt287/root, isolated HOME, three fixture tasks) plus grep checks on the shipped board notes. Checker /tmp/lt287/check.mjs, tally 35 passed, 1 failed.
- The merge is commit b4aa9f6 (the deliverable 504a083 rebased). Both carry the same 3-file, one-paragraph diff over agents/reviewer.md, agents/merger.md and agents/splitter.md.
- The live prompts match the shipped files. The daemon shipped the reviewer (2678 B), merger (2730 B) and splitter (2367 B) prompts equal to the merged agents/*.md with the {{ROOT}} and {{logStallMinutes}} substitutions.
- Each live prompt names the doctor as the notes-file maintainer, marks the file read-only for the role agent and sends durable guidance to the task's # Notes. The old wording ("Edit it for project-specific", "append what future agents") is absent, and the file-level acceptance grep returns no matches (exit 1).
- The splitter inline-injection path holds live. The cwd is the project root, no AGENTS.md symlink is present, and the splitter notes ride the appended system prompt byte-exact (6246 B).
- The reviewer and the merger reach their notes through the cwd AGENTS.md symlink (.kanban/AGENTS.reviewer.md and .kanban/AGENTS.merger.md) at the real worktree spawns, with the project AGENTS.md as the appended system prompt.
- Finding: the shipped .kanban/AGENTS.reviewer.md is 8701 bytes (mtime 2026-10-19 22:27:52, sha 7445e45f5bba), over the task's 8192-byte cap. It stayed at 19 bullet lines and 0 citations. The other two files pass at report time (merger 2262 B / 0 bullets / 0 citations, splitter 6246 B / 10 bullets / 0 citations).
- The reviewer notes breach comes from a sibling doctor rewrite after the review. The review-time value was 7848 B. The task Notes predicted this hazard, because the running daemon still holds the old doctor prompt, which has no byte cap before the code change of task 280. The file violates the byte bound only, never the bullet or the citation bound.
- Assumptions: (1) the merged worktree checkout runs the daemon, so agents/*.md come from commit b4aa9f6. (2) The fixture copied the real shared-board notes files, so the delivery checks use the shipped content, and the source shas match the report-time shas. (3) "Read-only" is a prompt-level prohibition, and I verified the shipped wording, never an OS-level enforcement. (4) The fixture tasks are untracked and scoped to /tmp/lt287, so no real board task was touched.
- No technical difficulty blocked a flow. The daemon log confirms the three spawns: reviewer for 000101, merger for 000102 after a real rebase conflict, splitter for 000103.
