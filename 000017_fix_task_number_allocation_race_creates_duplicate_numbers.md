---
name: "fix: task number allocation race creates duplicate numbers"
priority: "low"
state: "done"
worktree: ""
---

# Summary
createTask allocates the task number by reading the current max and creating the file without handling a collision. Two concurrent creates can produce the same number, which already happened: two files shared number 000015. Make createTask handle collisions with a bounded retry.

# Specs
# Need

src/kanban.ts createTask allocates the task number by reading the current max and creating the file without handling a collision. Two concurrent creates can produce the same number, which already happened: two files shared number 000015.

# Facts

- Check how createTask computes the next number and with which flags the file is created.
- A previous duplicate 000015 pair existed (a fix task and a docs task); the docs one remains on the board.

# Required behavior

1. createTask: when the target file already exists (number collision), bump to the next free number and retry, bounded (10 attempts).
2. Nothing else changes.

# Constraints

- Minimal diff. Keep the kanban_* tool contracts unchanged.

# Acceptance criteria

- `node src/kanban.test.ts` passes; add a small test: two creates against the same board never produce the same number.

# Notes

- [2026-02-04 12:00] createTask now writes the task file with the exclusive `wx` flag and retries on EEXIST: the loop rescans the max and bumps to the next free number, bounded at 10 attempts, then throws. Tool contracts unchanged (only caller is index.ts kanban_create).
- [2026-02-04 12:00] Tests: `node src/kanban.test.ts` passes with two new assertions (5 repeated creates all get unique numbers; a pre-existing 000006 collision file makes createTask return 000007 without overwriting the existing file). Also ran a two-process concurrent create check on a shared board, no duplicates. `node src/orchestrator.test.ts` still passes.
- [2026-02-04 12:00] Committed as efe3e31 in the worktree. State set to to-review.
- [2026-02-04 12:30] Review: implementation matches the specs. Retry loop rescans taskFiles each attempt, writes with the exclusive wx flag, retries only on EEXIST (other errors rethrown), bounded at 10 attempts then throws. Only change in src/kanban.ts is createTask; single caller index.ts:66 untouched, tool contracts unchanged. Ran node src/kanban.test.ts (pass) and node src/orchestrator.test.ts (pass). No fixes needed; state set to to-live-test.
- [2026-02-04 13:00] Live test: PASS. Suites: node src/kanban.test.ts and node src/orchestrator.test.ts pass. Race reproduced like a user: multiple roots sharing one board via .kanban symlink (the worktree topology behind the original 000015 duplicate). 8 concurrent creates across 2 roots: 8 unique numbers, no duplicates, all files parse. 12 concurrent creates across 3 roots: numbers 000001-000012 all unique and contiguous. Number gaps in the allocated sequence (e.g. 000004 then 000006) show the EEXIST retry path firing live: a loser rescanned and bumped instead of overwriting. Content integrity: every created file's name field matches its filename, no overwrites or mixing. Original failure shape: a pre-existing docs file at 000006 stayed intact while createTask allocated 000007. Not exercised end-to-end through the pi kanban_create tool on the real board, deliberately: a junk task would be picked up by the orchestrator watching .kanban/ and spawn agents; the tool is a thin wrapper calling the same createTask. No issues found.
