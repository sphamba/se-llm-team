---
name: "fix: orchestrator_wait resolves the board feed from session cwd; worktree sessions never see main-checkout events"
priority: "medium"
state: "live-testing"
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

- Implemented the suggested project-root resolution (worktree commit 66beb72). Extracted the wait into `waitForBoardCommits(cwd, timeoutSeconds, signal)` in src/orchestrator.ts: it resolves the feed root via `git rev-parse --path-format=absolute --git-common-dir` (points at the main checkout's .git even from a task worktree, whose HEAD is pinned at its branch tip) and runs the mirror `git rev-parse refs/heads/meta/kanban` and `git log baseline..mirror` there, falling back to the session cwd outside a git repo (wait then times out as before). Timeout clamping (1-900s), 2s poll cadence, kanban: create/done subject filter, baseline-absent handling, and abort handling are unchanged from the post-000034 logic. index.ts now calls the helper; the no-longer-used execSync import was dropped.
- Added test part M to src/orchestrator.test.ts: fixture repo with a linked worktree whose HEAD is pinned at an advanced feat/session branch (the old HEAD-based wait would satisfy itself there), a baseline mirror commit, a wait started from the worktree cwd while a kanban: done commit lands in the main checkout (asserted to report it), and an unrelated mirror commit asserted not to satisfy a second wait (timeout). Full suite passes: node src/orchestrator.test.ts, src/kanban.test.ts, src/webui.test.ts. index.ts parse-verified; only the pi-provided packages are unresolvable in this bare worktree, as before.
- Note on scope: task 000034 already switched the wait from HEAD to the shared refs/heads/meta/kanban ref, which alone makes worktree waits see main-checkout commits (refs/heads is shared across worktrees); this change makes the cwd independence explicit and robust per the specs' suggested fix (feed resolved at the project root) and pins it with a regression test, so it survives future refactors of the area.
- Review (no fixes needed): diff main...HEAD (commit 66beb72) matches the specs. Verified live from a real worktree: `git rev-parse --path-format=absolute --git-common-dir` resolves to the main checkout's .git, so dirname(feedRoot) is the project root, and the mirror rev-parse/git log run there; non-git cwd degrades to the old behavior (fatal → catch → feedRoot stays cwd → timeout). All preserved behavior confirmed identical to the pre-extraction logic in index.ts (clamp 1-900 default 300, 2s poll with remaining-time clamp, create/done subject filter, baseline-absent full-mirror handling, abort listener + aborted break). Regression test part M is sound: the fixture worktree HEAD is pinned at an advanced feat/session branch so a HEAD-based wait would falsely succeed there, the worktree-cwd wait reports the kanban: done commit landed in the main checkout, and an unrelated mirror commit times out a second wait. Suites pass in the worktree: orchestrator.test.ts (incl. part M), kanban.test.ts, webui.test.ts; index.ts parse-checks; waitForBoardCommits exports. Minor accepted limitation: --path-format=absolute needs git >= 2.31 (env has 2.43); on older git the resolution fails and the wait falls back to the session cwd, i.e. the old behavior, no data-loss risk.
