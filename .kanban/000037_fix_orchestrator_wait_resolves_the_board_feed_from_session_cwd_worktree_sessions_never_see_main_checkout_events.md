---
name: "fix: orchestrator_wait resolves the board feed from session cwd; worktree sessions never see main-checkout events"
priority: "medium"
state: "to-do"
worktree: "fix/orchestrator-wait-resolves-the-board-feed-from-session-cwd-worktree-sessions-never-see-main-checkout-events"
---

# Summary
orchestrator_wait runs `git rev-parse HEAD` and `git log baseline..HEAD` in the session cwd, so any session whose cwd is a task worktree (all role agents; also a user running pi inside a worktree) waits on the wrong HEAD and every wait times out with no events. Resolve the project root (e.g. via .kanban/.orchestrator.lock or `git rev-parse --git-common-dir`) instead of trusting ctx.cwd, or otherwise guarantee waits see the main checkout's kanban commits.

# Specs
Finding from the live test of task 000035 (fix: PM skill spawns a Watcher without checking for a live one).

File: src/index.ts — orchestrator_wait tool, registered by the se-llm-team extension.

Behavior: orchestrator_wait resolves the board's git feed from the session cwd: it runs `git rev-parse HEAD` and `git log baseline..HEAD` in ctx.cwd. A session whose cwd is a task worktree (role agents always run in worktrees; a user could also run pi inside a worktree) has HEAD pinned at its branch tip, so orchestrator_wait never sees the main-checkout kanban commits and every wait times out with no events. In the intended PM flow (cwd = project root) the same call works.

Evidence (observed live): a Watcher subagent spawned from the live-tester session (cwd = the 000035 worktree) reported "no board events" after a full 300s wait, while 3 kanban commits (kanban: done 000029, kanban: create 000036, kanban: done 000027) landed on the main checkout during exactly that window.

Suggested fix: have orchestrator_wait resolve the project root instead of trusting the session cwd — for example via the .kanban/.orchestrator.lock location or `git rev-parse --git-common-dir` (which points at the main checkout's git dir even from a worktree) — and run the feed resolution there; alternatively, document the cwd requirement for Watcher sessions. Related context: task 000034 (board on meta/kanban branch, watched in orchestrator_wait) will rework this area — coordinate so the cwd fix survives that refactor.

# Notes
