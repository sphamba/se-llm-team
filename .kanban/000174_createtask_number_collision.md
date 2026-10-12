---
name: "fix: createTask misses a same-number file with a different slug"
priority: "medium"
state: "done"
worktree: ""
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

## Live test (2026-10-12)

- Environment: isolated board /tmp/lt174/repo/.kanban (no daemon, no git). Interface: the kanban_create tool in `pi -p --no-session --no-context-files --approve --mode json` sessions with cwd in the fixture root. `~/.pi/agent/extensions/se-llm-team` resolves to the merged checkout, so every session ran the merged code. No unit suite ran.
- Hand-written number: five hand-written files 000001-000005 (000005 without frontmatter). One create gave 000006_probe_one.md. The six files have six distinct numbers. The hand-written bytes did not change (000005 md5 f4c4a92902955c49b3afde1bca47294d). No .create.lock remained.
- Concurrent creators (the reported bug): 4 pi processes x 2 creates, then 8 pi processes x 3 creates, all at the same time on one board. All 32 calls succeeded and all numbers are distinct (000007-000014, then 000016-000039 after the stale-lock case). The full board had 39 files and 39 distinct numbers. No .create.lock remained. Under this real load no lock failure occurred.
- Stale lock: a .create.lock backdated 60 s did not stop the next create. It returned 000015 and removed the lock.
- Created frontmatter is unchanged (name, priority, state backlog, worktree, issuer, complexity, shortName). The hand-written files stayed untouched.

### Findings

- A live but stuck lock holder fails creates: a fresh .create.lock held for 8 s made the tool return `could not lock "/tmp/lt174/repo/.kanban" for task creation` after about 1 s. The wait loop stops after 100 x 10 ms (about 1 s), but a lock is stolen only when it is older than 10 s. So after a creator crash, creates fail for up to about 10 s. The error is clear and a retry after 10 s succeeds. Reported to the Project manager as a low-priority finding.
- Observation, not a user-visible defect: the single-file case of the Specs (a pre-existing 000006_some_other_task.md when the next number is 6) never reaches the post-write rescan. The max scan already sees that file, so the allocation computes 000007 before any write. A strace of that exact fixture showed no unlink of the new file (only the lock). The 000007_racer.md assertion holds because of the max scan, not the unlink-and-retry net. Only the concurrent test exercises the fix. Reported to the Project manager as a low-priority finding.

### Assumptions

- The post-write same-number rescan needs a hand-written file in the short window between the max scan and the write. The live tool cannot open that window on purpose, so the live test verified the user-visible result (distinct numbers under real concurrency and with hand-written files present). The developer concurrency test covers the window itself.
- Only the task change was exercised. The daemon, git commits, promotion and the other tools were out of scope and untouched.
