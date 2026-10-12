---
name: "fix: createTask misses a same-number file with a different slug"
priority: "medium"
state: "live-testing"
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

## Review (2026-10-12)

- Confirmed the original bug and that the test catches it: on pre-fix code the suite fails with duplicate numbers (80 files, 52-79 distinct numbers per run), matching the note above.
- Review finding: the spec's unlink-and-retry rescan livelocks. Two creators that clash on a number both unlink their file, the max scan drops back, and both re-pick the same number round after round until the 10-attempt bound throws. Proven: a full `npm test` run failed with "could not allocate a task number ... after 10 attempts" on the first version of this fix.
- Fix (eafaf46): createTask now holds a `.create.lock` file across scan+write, so the allocation is one critical section. A lock older than 10s is stolen (a crashed creator's leftover). The post-write rescan stays as the net for a hand-written file slipping in between scan and write. The 10-attempt bound and the throw stay. The lock file is transient, non-.md, and invisible to taskFiles, so no tool contract, frontmatter, or parseTask behavior changes. Confirmed: keep the pre-existing file, remove our own, retry.
- Verified: 8 creators x 30 creates x 3 rounds standalone gave 240 unique numbers and no lock leftovers. kanban suite passes 5+ consecutive runs. Full suite passes, including after merging main (4f8f2ea) into the branch per convention.
- Test updates in the same commit: concurrency block comment now describes the lock; new stale-lock steal assertion (backdated lock, createTask succeeds, no leftovers).

## Merge (2026-10-12)

- Step 1: main was already merged into the branch (e33bf83, done at review) and no new main commits existed, so the merge in the worktree was "Already up to date". Clean, no conflicts, test suites skipped per the no-conflict rule.
- Step 2: merged fix/174-createTask-number-collision into main in the project root (main had not moved from 4f8f2ea). Fast-forward to e33bf83, no conflicts. Changes carried: src/kanban.ts (+51/-11 lines of the lock-file allocation) and src/kanban.test.ts (+40/-3 test additions).
- Nothing was resolved by hand; both merges were clean. Live test runs next on the merged commit at the project root.
