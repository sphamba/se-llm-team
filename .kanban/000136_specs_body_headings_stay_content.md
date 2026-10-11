---
name: "fix: Specs hidden by level-1 body headings; kanban_update strands old spec text"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#131"
complexity: "moderate"
shortName: "specs-body-headings-stay-content"
blockedBy: "#131"
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
