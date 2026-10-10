---
name: "fix: make task-file rewrite lossless in merge-conflict handling"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The daemon's task-file rewrite during merge-conflict handling must be lossless; in a live test it reset the state, dropped the Specs section, and cleared the worktree attribute, forcing a re-test.

# Specs
Found during the live test of task 000001 (fix: commit kanban tasks only on create and done).

Problem: The daemon's task-file rewrite during merge-conflict handling is lossy. In the same live test, the daemon rewrote the conflicted task file mid-merge: it reset the state to live-testing, dropped the whole Specs section, and cleared the worktree attribute. That reset a done state edit and forced a re-test, and the merger agent had to restore the Specs section by hand.

Suggested fix: Make the task-file rewrite lossless — parse the file, modify only the intended fields, write back, and keep all sections and unknown content intact.

# Notes
