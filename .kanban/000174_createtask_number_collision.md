---
name: "fix: createTask misses a same-number file with a different slug"
priority: "medium"
state: "reviewing"
worktree: "fix/174-createTask-number-collision"
issuer: "#17"
complexity: "simple"
shortName: "createTask-number-collision"
---

# Summary
Task #17 made createTask retry on a filename collision (wx flag), but a concurrent creator that picked the same number with a different slug still succeeds: today two files shared number 000170 (a hand-written 000170_agents_file_guidance_refine.md and a kanban_create 000170_watcher_report_open_questions.md). The wx flag only guards the exact path, not the number.

# Specs

## Change
- In src/kanban.ts createTask (the allocation loop, ~:370): after a successful wx write, re-scan taskFiles for another file whose number equals the new one (different basename). When found, unlink the just-written file and continue the loop (the next attempt rescans the max and bumps). Keep the bounded 10 attempts and the throw.
- This also catches a number taken by a hand-written file between the max rescan and the write.
- Nothing else changes: tool contracts, frontmatter, parseTask untouched.

## Tests
- src/kanban.test.ts: a pre-existing file sharing the next number with a different slug (for example 000006_some_other_task.md when createTask would allocate 000006) makes createTask allocate the next free number and never leave two files with one number; repeated concurrent-style creates still get unique numbers (extend the existing #17 assertions).

# Notes

- In src/kanban.ts createTask, after a successful wx write, the code now re-scans the task files for another file with the same number and a different basename. On a clash, it unlinks the just-written file and continues the loop. The next attempt rescans the max and bumps. The 10-attempt bound and the throw stay.
- In src/kanban.test.ts, the #17 race block now also checks the whole directory: no two files share one number, hand-written files included.
- Added a true-concurrency test: four child processes each run 20 createTask calls on one shared temp root. Without the fix, 3 of 3 runs fail with 80 files but 79 distinct numbers. With the fix, 3 of 3 runs pass. Full test suite passes.

# Open questions

Assumptions (confirm or correct before merge):
- On a number clash, createTask keeps the pre-existing file, removes its own new file, and retries with the next free number.
- The bounded 10-attempt loop and the error throw stay as task #17 made them.
- No tool contract, frontmatter field, or parseTask behavior changes.
- The check scans only the .kanban directory for .md files, like taskFiles does today.
