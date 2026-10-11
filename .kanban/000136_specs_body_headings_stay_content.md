---
name: "fix: Specs hidden by level-1 body headings; kanban_update strands old spec text"
priority: "high"
state: "done"
worktree: ""
issuer: "#131"
complexity: "moderate"
shortName: "specs-body-headings-stay-content"
blockedBy: ""
---

# Summary
kanban_get returns an empty specs field whenever the Specs region contains a markdown level-1 heading (e.g. "# 1. ...", "# Complexity"), because parseTask treats every "^# " body line as a section header and the first one after "# Specs" resets specs to "". replaceSections shares that match, so a later kanban_update(specs) writes the new text under "# Specs" and leaves the old Specs stranded below the stray headings, while kanban_get shows only the new text. Fix the parser so only the four known section names (summary, specs, notes, open questions) open a section, and decide the repair of the already-damaged board files.

# Specs
## Need

kanban_get shows specs "" for any task whose Specs region contains a markdown level-1 heading line (a line matching "^# <text>"), for example a spec structured as "# 1. ...", "# 2. ...", "# Complexity". Root cause: in src/kanban.ts, parseTask (~line 114) treats every "^# " body line as a section header; the first such heading after "# Specs" opens a pseudo-section and resets the specs value to "". replaceSections (~line 225) uses the same match to find section boundaries, so a later kanban_update(specs) writes the new text directly below "# Specs" and leaves the previous Specs text stranded below the stray headings. The file then holds both old and new spec text while kanban_get only shows the new text.

This is PRE-EXISTING and not caused by #131; #131's own Specs uses "# 1.", "# 2." and "# Complexity", so kanban_get #131 shows specs "" even though the file has full Specs content. Found while live-testing #131, whose change itself passed.

Facts measured on the board 2026-10-13 (refresh at fix time): 26 files have "# Specs" followed by a level-1 heading before the next known section. 17 are done: #001, #002, #003, #004, #005, #006, #007, #009, #012, #013, #016, #017, #018, #042, #043, #044, #125. 9 are not-done: #126, #127, #128, #129, #131, #132, #133, #134, #135 (sizes 1.0-6.8 KB of currently invisible text). Three files already show update damage inside the file itself: #126, #127 and #129 carry duplicated spec blocks (and #127 an extra "# Fix" block), the stranded-old-text half of this bug.

## Required behavior

1. parseTask: only these four section names open (or reset) a section, compared after trim + lowercase: "summary", "specs", "notes", "open questions". Any other body line matching "^# " is ordinary content of the current section. This makes the full Specs, Notes and Open questions text visible again for every affected file without touching the files.
2. replaceSections: the region of a target section ends at the next header whose name is one of those four (or EOF), not at the next "^# " line. A specs update therefore replaces the whole previous Specs region, including any level-1 headings inside it, and leaves exactly one copy of the new text in the file.
3. Appending a missing section keeps today's behavior (blank line, "# <Name>", the value, trailing blank line).

## Constraints

- Keep the fix minimal: src/kanban.ts (parseTask + replaceSections, one shared set of known section names) and src/kanban.test.ts. No index.ts change is expected; if one is made anyway, run node index.test.ts.
- Keep parseTask's public contract: same Task fields, trim, case-insensitive section names, conflicted flag. Keep updateAttrs and updateTask's patch semantics untouched.
- Read must never rewrite a board file: no migration, no normalize-on-read.
- Unknown level-1 headings become part of the enclosing section and are replaced when that section is rewritten; that is the accepted trade-off (state it in a code comment). Rejected alternative: reject/document body-level headings, because it would leave the existing 26 files unreadable and would not stop the stranding.
- Do not rename sections, add new ones, or reformat untouched sections; a file with no stray headings must round-trip byte-for-byte.
- Follow the existing test style in src/kanban.test.ts (node:assert, tmp-dir fixtures).

## Acceptance criteria

- `node src/kanban.test.ts` passes and gains at least: (a) a fixture whose "# Specs" is followed by "# 1. Part", text and "# Complexity" parses with those heading lines included in specs; (b) updateTask(specs) on that fixture yields exactly the new text: parseTask returns it, the raw file holds no leftover of the old spec text, and there is a single "# Specs" header; (c) a "^# " heading inside "# Notes" does not truncate Notes; (d) a heading like "# Specs detail" neither opens a section nor ends one; (e) a stray-heading-free file still updates byte-for-byte as today.
- `node src/orchestrator.test.ts` passes (parseTask feeds the openQuestions auto-schedule gate; the not-done board files parse the same openQuestions before and after).
- `node index.test.ts` passes if index.ts changed; otherwise # Notes states index.ts was untouched.
- # Notes records, refreshed at fix time, the exact affected file list with state and whether each file's text is whole or contains stranded duplicated content; every file gets a decision, either "no repair needed" or the repair applied, or a follow-up task ref (created with issuer "#<this task num>"). The three duplicated files #126, #127 and #129 must not be left undecided.
- After the fix, kanban_get on a task whose Specs contains "^# " headings (a new fixture task, or #131 once merged) shows the Specs text, and no board file was modified by merely parsing it.

# Notes

Done 2026-10-14 in worktree fix/136-specs-body-headings-stay-content, commit 1609846.

## What was done

- src/kanban.ts: one shared known-name check (sectionName) used by parseTask and replaceSections; only "summary", "specs", "notes", "open questions" (trim + lowercase) open or end a section. Any other "^# " body line is content of the enclosing section (trade-off named in the code comment: such headings are replaced when that section is rewritten). No migration, no normalize-on-read; updateAttrs and updateTask patch semantics untouched.
- src/kanban.test.ts: new assertions for (a) specs with "# 1. Part"/"# Complexity" headings parse whole, (b) updateTask(specs) leaves exactly one "# Specs" and no leftover old text, (c) a stray heading inside Notes does not truncate it, (d) "# Specs detail" neither opens nor ends a section, (e) a stray-heading-free file updates byte-for-byte.
- node src/kanban.test.ts, node src/orchestrator.test.ts, node index.test.ts all pass.
- index.ts was untouched.
- Verification on the real board: old-vs-new parse of all 132 files shows openQuestions identical everywhere; the specs field changes only on the 26 Specs-stray files (now whole); kanban_get on #131 returns the full 2118-char Specs and md5sum before/after the read is identical (parsing modifies no file).

## Affected files, refreshed at fix time (2026-10-14)

28 affected files: 26 with a stray level-1 heading in the Specs region (matches the 2026-10-13 list, with #131 and #135 now done) plus 2 new findings with a stray heading in the Notes region (#092 "# Review notes", #097 "# Live test report"), found by the full-board parse diff. All 28 read whole after the fix without touching the files.

| Files | State | Text | Decision |
| --- | --- | --- | --- |
| #001, #002, #003, #004, #005, #006, #007, #009, #012, #013, #016, #017, #018, #042, #043, #044, #125, #131, #135 (19) | done | whole, Specs strays | no repair needed (records, never rewritten) |
| #092, #097 (2) | done | whole, Notes strays | no repair needed |
| #128, #132, #133, #134 (4) | backlog | whole, Specs strays | no repair needed (next section rewrite replaces the whole region) |
| #126 (7 dup lines), #127 (14 dup lines), #129 (7 dup lines) | backlog | stranded duplicated spec blocks | follow-up task #137 (issuer #136, blockedBy #136): after this fix merges, kanban_update(specs = current copy) wipes the stranded old text |

The current copy in each damaged file is the text directly below "# Specs" before the first duplicated block; #137's Specs records the exact split per file.

## Review 2026-10-14: pass, no fixes

- Diff is contained to src/kanban.ts and src/kanban.test.ts, one commit (1609846), 47 insertions and 6 deletions. index.ts was untouched. This matches the constraints.
- Code review pass: parseTask and replaceSections share one sectionName check with the four known names. The trade-off comment is present. updateAttrs and the patch semantics of updateTask stayed unchanged.
- Tests: node src/kanban.test.ts, node src/orchestrator.test.ts (full run, exit 0) and node index.test.ts all pass. Assertions (a) to (e) from the acceptance criteria are all present.
- Independent check of the real board with the new parser: md5 over all 133 board files is identical before and after the parse, so a read does not rewrite a file. Old-vs-new parse diff: openQuestions is identical on every file, specs changes only on the 26 listed files, notes changes only on #092 and #097. The board grew by one file since the fix-time verification (#137 now exists), so this run saw 133 files, not 132.
- The states in the table above are correct: #131, #135, #092, #097 done; #126, #127, #128, #129, #132, #133, #134 backlog. #137 exists with issuer "#136" and blockedBy "#136, #134".
- The branch is 3 commits behind main, but those commits touch only src/webui.ts and src/webui.test.ts. No file overlap, so the later merge stays clean. No merge was done here.

## Live test 2026-10-12: pass, no issues

- Method: the change was exercised through the real kanban tool interface. A headless pi process loaded the worktree extension (index.ts at commit 1609846) and called kanban_get, kanban_update and kanban_list. The write flows ran on a scratch board. The real board was read only.
- kanban_get on a fixture whose Specs holds "# 1.", "# 2." and "# Tests" headings returns the whole Specs text with the headings. It no longer returns "".
- kanban_update(specs) on that fixture leaves exactly one "# Specs", holds the new text and has no leftover old text. Notes, Open questions and frontmatter stay intact. The same holds for a three-line specs value that contains a "# 10." heading.
- kanban_get on a fixture with a stray "# Review notes" heading in Notes returns the whole Notes text, not a truncated one.
- kanban_update(openQuestions) on a fixture with "# Specs detail" in Notes changes only the Open questions section. Notes, including "# Specs detail" and its body, is byte-for-byte unchanged, so "# Specs detail" opens no section.
- kanban_update(specs) on a normal fixture with no stray headings changed one line only. git diff shows no other change.
- Real board read only: kanban_get on #131 returns the full Specs text (before the fix it returned ""). kanban_get on #092 returns the whole Notes text. kanban_list works for all three scopes. md5sum of every board file is identical before and after these reads.
- kanban_list main vs worktree: the openQuestions value is identical on all 133 tasks. The parsing change does not move the auto-schedule gate.
- Repair path check on scratch copies of the three damaged files (#126, #127, #129): kanban_update(specs) leaves one "# Specs" and removes all stranded blocks. #137 is present with issuer "#136" and blockedBy "#136, #134".
- No issues found, so no follow-up task was created and no open questions remain.

## Merge 2026-10-12: complete, base branch main

- Step 1: base branch resolved to main. Merged main into fix/136-specs-body-headings-stay-content in the worktree: clean merge, commit 6361fe1. Only src/webui.ts and src/webui.test.ts came in, as the review predicted. No conflicts, so the test suites were skipped per the merge procedure.
- Step 2: base branch resolved to main again. Merged fix/136-specs-body-headings-stay-content into main in the project root: fast-forward from 1db82af to 6361fe1, clean, src/kanban.ts and src/kanban.test.ts landed on main. No conflicts.
- No unresolvable conflicts, no failing tests, no repo left in a dirty merge state. Follow-up task #137 (repair of #126, #127, #129) is now unblocked, since the fix is on main.
