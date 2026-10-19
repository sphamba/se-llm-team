---
name: "fix: live-tester role prompt prohibition and notes distill"
priority: "high"
state: "done"
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

- No-split decision (2026-10-19): this task is already one atomic bundle of the #281 per-role split. It holds one trivial prompt paragraph and one single-file distill (one continuous rewrite, one output). No disjoint file ranges and no new-file-only seam exist, so no cut parallelizes. A prompt-vs-distill split adds a review, merge and live-test cycle for a one-paragraph change. Do not re-split this or the sibling role bundles (#285, #287); the per-role bundle is the bottom of the split.

- No-split note, second splitter session (2026-10-19): same decision. Adds facts from board forensics that change the developer job:
  - The stale first decomposition of #281 (#282, #283, #284, duplicate file ownership) was already deleted at 21:53 by a parallel session. The canonical set is #285, #286, #287. No board repair pending.
  - .kanban/AGENTS.live-tester.md was rewritten at 21:55 by an out-of-scope session (bash write; no #286 developer had run): 98311 -> 10288 bytes. Quality is good and matches this spec's kernel; 19 bullet lines and zero task citations pass, but wc -c 10288 FAILS the 8192 cap.
  - Developer job: verify the on-disk distill against the original, then trim to at most 8192 bytes without losing the kernel. Redo only if verification fails. Full pre-distill original: git show 5531b6c:.kanban/AGENTS.live-tester.md (98311 bytes; last meta/kanban snapshot before the rewrite).
  - A parallel session was still alive at 21:56 (the deleted duplicate #283's splitter log ended mid-run). Re-check the file immediately before your edit. Touch only AGENTS.live-tester.md.
  - agents/live-tester.md is untouched. Do the paragraph edit as specced.

- Done (2026-10-19, commit 4145b49): verified the on-disk distill instead of redoing it. Between the 21:55 snapshot in the older note (10288 bytes) and this check, the file was trimmed again (mtime 22:01): 8187 bytes, 19 bullet lines, 0 task citations, so all three mechanical checks pass. Kernel verification against `git show 5531b6c` (98311 bytes): sections map cleanly (Codebase map absorbs the Orchestrator flow map; Canonical fixtures absorb Fixture shapes plus Canonical recipes; Report and board hygiene absorbs Real-board daemon hygiene), per-task recipes and the in-file append-discipline header are dropped, and 10 distinctive-phrase spot checks all trace to the original. No rewrite needed; touching it again would only risk clobbering a parallel trim. agents/live-tester.md paragraph replaced per spec, wording mirrored from the already-landed developer-prompt edit (98be333). Acceptance greps: 0 matches for the old sentence, doctor named as maintainer and file read-only for the role.

- Review (2026-10-19, no fixes): prompt paragraph verified at agents/live-tester.md:17, the only diff hunk (1+/1-); old sentence 0 matches, new wording mirrors 98be333 verbatim (doctor named as maintainer, file read-only for the role agent, findings redirected to the task # Notes); commit 4145b49 carries only agents/live-tester.md, nothing under .kanban/ committed, hard boundary held (no doctor.md, analyst.md, src/ or tests/ touches). On-disk distill re-checked after the parallel-session warning and matches the Done record: 19 bullets (cap 20), grep -c '#[0-9]' 0, wc -c 8187 (cap 8192); original blob 5531b6c confirmed 98311 bytes. Tests: tests/plugin.test.ts exit 0 (total 1 suite, +0 from the diff; spec forbids test changes, acceptance is grep-based).

## Live test (2026-10-19)

- Merge identity: the Notes name no merge hashes for a `git show --stat <h1> <h2>` check, and the Done record names 4145b49, which is HEAD at task start. The root checkout `main` is also at 4145b49, so a pi session probe loads the merged prompt. The commit carries only `agents/live-tester.md` (1 file, +1/-1).

- Usage test 1, real spawn path without the daemon. I called the merged `spawnAgent(root, cfg, "live-tester", task, worktreeCwd)` on a fixture with the real task-worktree shape, that is, a root repo, `.worktrees/fixture-task`, the `.kanban` link that `syncBoard` creates, and a copy of the real board notes. A fake pi agent logged argv and cwd. Check script tally: 22 PASS, 0 FAIL.
  - The fake agent received `--approve --mode json ... -p <payload>`. The payload is byte-equal to `agents/live-tester.md` with `{{logStallMinutes}}` filled with the configured 60 minutes (S4).
  - The payload carries the new sentence "That file is read-only for you: never edit it, never append to it.", names the doctor as maintainer, and redirects task-specific findings to the task file `# Notes`. Both old permission phrases are absent (S5 to S8).
  - The worktree cwd `AGENTS.md` is a symlink to `.kanban/AGENTS.live-tester.md`, and the content that pi loads through it is byte-identical to the real board distill (S11, S12). The run log and the exit file appear as usual (S13, S14).

- Usage test 2, a real pi session with the shipped prompt. One session ran with `pi -p --no-session --no-context-files --approve --no-mcp --thinking minimal` in a probe fixture whose `AGENTS.md` points at a copy of the real notes file. The agent made 4 tool calls (reads and one memory write) and 0 file edits. Both fixture files are md5-unchanged. It read SPECS.md, stated "AGENTS.md is doctor-maintained and read-only for me", saved the durable lesson to the repo Hindsight memory, and left the notes file and the task file alone.

- Usage test 3, the notes file as the agent loads it. `wc -c` is 8187 (cap 8192), bullet lines are 19 (cap 20), the `#[0-9]` count is 0, the append-discipline header is absent, the markdown is valid (one H1 and six H2 sections), and the durable kernel is intact (run order, codebase map, canonical fixtures, Playwright discipline, shell traps, report and board hygiene).

- Acceptance greps at the repo root. `grep -n "Edit it for project-specific" agents/live-tester.md` has no matches. "read-only for you" and "doctor maintains it" each match once.

- Assumptions. (a) HEAD at task start is the merge, because the Notes name no merge hashes and the Done hash 4145b49 equals HEAD. (b) The spawn test calls `spawnAgent` directly with role `live-tester` and a worktree cwd, one layer below the pipeline sweep, because the diff does not touch the state machine. (c) The fixture copies the real board notes file, so the loaded content is the delivered artifact. (d) The pi probe uses `--no-context-files` per the role recipe, so the observed choices come from the `-p` payload.

- Technical difficulty while testing. My first fixture worktree had no `.kanban` symlink, so the cwd `AGENTS.md` did not resolve and the read failed with ENOENT. The real pipeline creates that link in `syncBoard` (`src/orchestrator/board.ts`). I added it to the fixture and reran. This is a fixture gap and not a product defect.

- Observation, not a defect. The new wording redirects task-specific findings only. A task-agnostic lesson has no named destination, so the probe agent used the repo Hindsight memory. The Specs do not forbid this, and the notes file stayed untouched. No behavior contradicted the task's stated assumptions.
