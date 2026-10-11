---
name: "fix: repair stranded duplicate spec blocks in #126, #127 and #129"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#136"
complexity: "simple"
shortName: "repair-stranded-specs"
blockedBy: "#136, #134"
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
