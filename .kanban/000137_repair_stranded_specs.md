---
name: "fix: repair stranded duplicate spec blocks in #126, #127 and #129"
priority: "medium"
state: "done"
worktree: ""
issuer: "#136"
complexity: "simple"
shortName: "repair-stranded-specs"
blockedBy: ""
---

# Summary
Tasks #126, #127 and #129 carry stranded duplicate spec text left by the pre-#136 replaceSections bug: a kanban_update(specs) wrote the new text below "# Specs" and left the older copy below stray level-1 headings. After fix #136 merges, rewrite each Specs region with its current copy to wipe the stranded old text.

# Specs
## Need

Fix #136 changed replaceSections so a section region ends at the next known section header (summary, specs, notes, open questions) instead of the next "^# " line. The three files below were damaged before that fix: a kanban_update(specs) wrote the current copy directly below "# Specs" and left the older copy stranded below stray level-1 headings. After #136 merges, the whole region is replaceable in one update, which is the repair.

Measured 2026-10-14 (verify at fix time):
- #126 (000126_fix_token_stats_show_m_from_a_million_with_one_decimal_sub_cards_align_right.md, backlog): current copy = the text from "# 1. Token format (fmtTokens, src/webui.ts ~:499-504)" through the first "# Tests" block (the version with "# 2. Sub cards align left ... - corrected 2026-10-12, was align right"). Stranded below: an older uncorrected copy ("align right", no correction note).
- #127 (000127_fix_the_blockedby_relation_lines_are_too_visible_make_them_subtle.md, backlog): current copy = "# User observation (2026-10-12)" through the first "# Complexity" block ("simple (user-ordered 2026-10-12). Files: src/webui.ts and src/webui.test.ts only."). Stranded below: a duplicate of that content plus an extra "# Fix" block and a trailing "# Complexity".
- #129 (000129_fix_complexity_chips_get_per_value_colors_priority_hues_more_distinct.md, backlog): current copy = "# User observation (2026-10-12)" through the first "# Tests" block. Stranded below: a duplicate plus a trailing "# Complexity" block.

In every file the newest copy is the text directly below "# Specs", before the first duplicated block. Verified at #136 fix time by duplicate-line scan (7, 14 and 7 repeated long lines respectively).

## Required behavior

For each of the three files, after #136 is merged (done): extract the current copy (text from below "# Specs" to just before the first duplicated block), then run kanban_update(specs = that text). With the fixed replaceSections this replaces the whole Specs region up to "# Notes", removing the stranded copies. Verify per file afterwards: parseTask/kanban_get returns exactly the current copy, the raw file holds no second copy, and there is one "# Specs" header.

## Constraints

- Do not start before #136 is merged: the pre-fix code would re-strand the text.
- Touch only the three task files' Specs regions via kanban_update; never hand-edit the files.
- Do not change state, priority, worktree or any other section.
- No code change expected; no test run needed beyond the verification reads.

# Notes
- Prerequisite check: #136 is done and merged. The fixed parser is on main (sectionName in src/kanban.ts), so one kanban_update(specs) replaces the whole Specs region up to "# Notes".
- Repair-time finding: #126 was already repaired. Commit 562c908 (2026-10-12) removed its stale duplicate during the #126 done transition, and the #126 Notes record the removal. The duplicate scan on #126 now returns 0 repeated long lines, so no write was made. The file md5 stayed 423c1b1f.
- #127: kanban_update(specs) with the current copy (the text from "# User observation (2026-10-12)" through the first "# Complexity" block) removed the stranded region. The stranded text was lines 49-85: a duplicate of the content, an extra "# Fix" block and a trailing "# Complexity". Diff against the pre-update mirror shows a pure deletion (49,85d48), nothing else changed.
- #129: kanban_update(specs) with the current copy (the text through the first "# Tests" block) removed the stranded region. The stranded text was lines 33-51: a duplicate plus a trailing "# Complexity". Diff against the pre-update mirror shows a pure deletion (33,51d32), nothing else changed.
- Verification on all three files: parseTask (the kanban_get code path) returns exactly the current copy. The raw file holds no second copy (duplicate-line scan: 0 repeated long lines). One "# Specs" header. Summary, Notes and frontmatter (state, priority, worktree) are byte-for-byte unchanged.
- No code change, so no commit in the worktree. The board writes are mirrored on meta/kanban (commits 83dd803 and 735c9ed). No test run beyond the verification reads.
- Review (2026-10-12): pass, no fixes. Independent re-verification of all three files against the required behavior. #126: no write was needed; commit 562c908 already removed the stale uncorrected copy during the #126 done transition, the raw file md5 is 423c1b1f with 0 repeated long lines and one "# Specs" header, and kanban_get returns the current copy (the corrected align-left version). #127: commit 83dd803 removes exactly the stranded region (the duplicate content, the extra "# Fix" block and the trailing "# Complexity"), a pure deletion; kanban_get returns the current copy through the first "# Complexity" block, one "# Specs" header, 0 repeated long lines. #129: commit 735c9ed removes exactly the stranded region (the duplicate plus the trailing "# Complexity"), a pure deletion; kanban_get returns the current copy through the "# Tests" block, one "# Specs" header, 0 repeated long lines. The fixed parser (sectionName in src/kanban.ts) is on main. Worktree clean with HEAD at main (d5a1ca1), so the no-code-change constraint holds. Frontmatter of all three files unchanged (state, priority, worktree).
- No fixes made, so state set to to-live-test. There is no code to live-test: the deliverable is the board state, which the reads above verify.
- Live test (2026-10-14): pass, no findings. The deliverable is board data, not code, so the real user flows are the running dashboard's task API and the MCP kanban reads. The unit suites were not run.
- Live flow 1, running project dashboard: the production orchestrator daemon (pid 1930909, web UI on :4242, started from the main checkout) served GET /api/tasks. The payload carries the repaired body of all three tasks (the same body the web UI detail card reads). Checks on the served bodies: exactly 1 "# Specs" header and 1 "# Notes" header each, 0 repeated long lines each.
- Served headings: #126 = "# 1. Token format", "# 2. Sub cards align left ... corrected 2026-10-12, was align right", "# Tests" (the uncorrected align-right copy is gone). #127 = "# User observation", "# 1. Subtle lines", "# 2. S-shape", "# 3. Hover", "# Complexity" (no "# Fix" block, no trailing "# Complexity"). #129 = "# User observation", "# 1. Complexity chips per value", "# 2. Priority chips more distinct", "# Tests" (no trailing "# Complexity").
- Live flow 2, kanban reads: kanban_get on all three tasks returned state done, priority medium, worktree empty, and the Specs equal to the live API body's Specs region (byte-for-byte, checked with parseTask from the worktree code against the API payload).
- Live flow 3, raw files: 1 "# Specs" header each; a duplicate scan over every non-blank, non-frontmatter-dash line returned 0 duplicates in all three files. Frontmatter (state, priority, worktree) and all non-Specs sections are intact; the repair commits 83dd803 (#127) and 735c9ed (#129) are pure deletions in the Specs region, and #126 was already repaired by 562c908 during its done transition.
- Mirror check: the meta/kanban tip holds the three files byte-for-byte identical to the working .kanban (md5 423c1b1f, eaabf7e7, e8cb7517). No code change: worktree HEAD d5a1ca1 equals main, git status clean, git diff main...HEAD empty.
- No open questions and no new tasks to create.
- Merge (2026-10-14): pass, no conflicts, nothing to commit. Step 1: base branch main merged into fix/137-repair-stranded-specs in the task worktree. Result: already up to date. The branch holds no code commits (the repair was board data only), so the branch and main point at the same commit d5a1ca1. Clean merge, so no test suites ran. Step 2: base branch resolved again as main; fix/137-repair-stranded-specs merged into main in the project root. Result: already up to date. Both checkouts are clean; no dirty merge state. State set to done.
