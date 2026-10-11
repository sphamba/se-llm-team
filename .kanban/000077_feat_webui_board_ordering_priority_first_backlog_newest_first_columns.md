---
name: "feat: webui board ordering; priority-first backlog, newest-first columns"
priority: "high"
state: "done"
worktree: ""
---

# Summary
Backlog column sorts tasks by priority first (highest above) and by most recently updated within the same priority. All other columns order tasks by most recently updated first, with deterministic ties.

# Specs
Order the tasks inside the board columns (user feedback): backlog sorts by priority first, every other column by most recently updated first.

Facts:
- Cards in each column are rendered in the /api/tasks order (file-name/task-number order). render() (src/webui.ts:446) rebuilds all columns and cards in one string.
- Task files carry no stored update timestamp; the file mtime is the natural update signal (the daemon and kanban tools rewrite task files on state changes and note appends).
- Lanes: #38 (hub backend, live-testing) branch rewrites src/webui.ts; #47 (high), #76 (medium), and #77 (high) are queued on the same webui lane.

Changes:
1. /api/tasks exposes each task's update time (from the task file's mtime) so the client can sort; alternatively the server pre-sorts per column - the developer picks the simpler option, keeping the API backward-compatible for existing consumers.
2. Backlog column ordering: highest priority first (critical, high, medium, low); within the same priority, the most recently updated first.
3. Every other column: the most recently updated first (no priority weighting).
4. Ties are deterministic: same priority and same update time falls back to the current task-number order.
5. Tests: extend src/webui.test.ts - backlog sorts priority-desc then update-desc; other columns sort update-desc; ties fall back to task-number order. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- Backlog shows critical tasks above high, high above medium, medium above low; within one priority, the most recently updated task is on top.
- Every other column shows the most recently updated task on top.
- The 5s refresh keeps the ordering stable.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind 000038 (live-testing): its branch rewrites src/webui.ts. Sequence on the webui lane by priority order: 000047 (high), then 000077 (high), then 000076 (medium); the three tasks cannot run in parallel.

# Notes

## Developer notes (2026-10-11)
- Found commit 4634e17 already on feat/77-webui-board-ordering (base d56b833, the current main head, so the #38/#47 webui lane is merged and the HOLD is satisfied; no rebase needed). It changes only src/webui.ts and src/webui.test.ts, the tree is clean, and it matches every Specs point, so no further code change was needed.
- Ordering: syncBoard ranks backlog cards critical > high > medium > low, then updated (task file mtime) descending within one priority; every other column sorts by updated descending only. The sort is stable and /api/tasks arrives in taskFiles() lexical (task-number) order, so equal priority and equal mtime keep task-number order. /api/tasks already exposed updated (file mtime) from the liveness/FLIP work, so this commit adds no API change and stays backward compatible.
- Tests added to src/webui.test.ts: a backlog fixture proves priority-desc then update-desc, a reviewing fixture proves update-desc with no priority weighting, equal keys keep task-number order, and a repeated sync proves the order is stable across a refresh.
- Verified: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all green (tests use temp roots and port 0, and the orchestrator smoke daemons run with SE_LLM_TEAM_NO_WEBUI=1, so the production webui on 4242 was never touched).
- Verified end to end on a temp board with real mtimes: the served /api/tasks carries updated per task, the shipped page script parses as JS, and syncBoard over the real payload puts backlog in the order critical-newest > critical-old > high > low and reviewing as newest > old regardless of priority.
- Typecheck: still not runnable as written (no tsconfig, no package.json scripts, decoy tsc on PATH). Ad hoc strict tsc 5.9.3 with @types/node from another checkout: src/webui.ts reports 30 errors on this branch and the same 30 on base d56b833, all pre-existing implicit-any/index-signature findings in the untyped DOM-facing helpers, so this change adds no new type error.
- After those checks, the other Developer session (developer.1) committed c5c7ae9 on top: it adds the medium-priority row 000009_i.md (updated 50) to the ordering fixture and unfolds backlog, so the test also proves medium above low. Re-ran the full suite at c5c7ae9: kanban, orchestrator and webui tests all green; tree clean.
- Pipeline observation for the PM: the orchestrator spawned two Developers for this task at about 14:57 (developer.1 pid 3742261 and developer.2 pid 3742713, this session), a scheduling race. No collision: developer.1 made the only code change (c5c7ae9), this session committed nothing, and the reviewer was spawned while developer.1 was still finishing.

## Reviewer notes (2026-10-11)
- Reviewed c5c7ae9 on top of 4634e17. git diff main...HEAD touches only src/webui.ts and src/webui.test.ts, so the Specs file constraint holds. No code change was needed.
- Code check: syncBoard ranks backlog critical 0, high 1, medium 2, low 3 (missing priority 4), then updated descending within a rank; every other column sorts by updated descending only. filter() copies the payload array, so the sort never reorders the shared list, and Array.sort is stable, so equal keys keep the taskFiles() lexical (task-number) order. /api/tasks already carries updated (file mtime) and listAll is lexical, so Specs 1-4 hold and the API stays backward compatible.
- Test check: the backlog fixture proves priority-desc then update-desc (critical e9 > b1, high c5/d5 tie, medium i50, low a100); the reviewing fixture proves update-desc with no priority weighting and task-number fallback on equal mtimes (g/h); the repeated sync proves the order is stable across a refresh.
- Re-ran the full suite on the clean c5c7ae9 tree: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all green; tree clean after the run.
- Typecheck: still no runnable typecheck (no tsconfig, no package.json scripts, the tsc on PATH is decoy tsc 2.0.4). Ad hoc strict tsc 5.9.3 with @types/node from a sibling checkout, nodenext, base d56b833 vs HEAD: identical error set on both sides (32 findings), only line numbers shift, so this change adds no type error (the developer measured 30 with their ad hoc flags, same conclusion).
- At review start the worktree was dirty with the uncommitted medium-rung fixture; developer.1 committed it as c5c7ae9 while this review ran. Reviewer made no commit.
- Pipeline observation: a second developer session (developer.2) was still alive and writing during this review. It only appended these notes, made no commit, and has exited. Together with the developer notes, the PM sees one scheduling race: the reviewer was spawned before the Developers stopped.

## Live-tester notes (2026-10-11)
- Ran the full suite on the clean c5c7ae9 tree: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all green.
- Ran the real project like a user: started startWebUi from the worktree against a temp board (9 tasks: low/critical/high/high/critical backlog at mtimes 100/1/5/5/9, medium backlog at 50, and low/critical/low reviewing at 5/3/3, all set with utimes), then loaded the served page in headless Chromium and read the rendered card order.
- Backlog rendered #5 critical(9) > #2 critical(1) > #3 high(5) > #4 high(5) > #9 medium(50), with the low task #1(100) hidden by the 5-card fold and #1 last after clicking show all. Priority wins over recency, same-priority recency wins, and the equal high pair keeps task-number order. Matches Specs 2 and 4.
- Reviewing rendered #6 low(5) > #7 critical(3) > #8 low(3): newest-first with no priority weighting, equal mtimes keep task-number order. Matches Specs 3 and 4.
- The order was identical after a 6.5 s wait, so the 5 s refresh keeps it stable (Acceptance). /api/tasks carries updated per task, so the API stays backward compatible.
- No page JavaScript errors. The only console line is the expected 404 on /api/projects, which the single-project server does not implement and the client already handles (no tabs). No issues found.
- Did not touch the production webui on 4242; every check used port 0 and a temp root/board.
