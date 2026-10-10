---
name: "fix: commit kanban tasks only on create and done"
priority: "medium"
state: "to-do"
worktree: ""
---

# Summary
Commit .kanban/ task files only at two points: creation in backlog, and reaching done. Remove commits for all updates in between (state moves, worktree sets, spec/summary edits, notes) to reduce commit noise.

# Specs


# Notes
