---
name: "fix: task number allocation race creates duplicate numbers"
priority: "low"
state: "backlog"
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
