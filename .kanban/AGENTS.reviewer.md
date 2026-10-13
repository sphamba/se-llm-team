# reviewer: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.

## Running the suites
- `npm test` in the worktree runs all five (kanban, orchestrator, webui, extension, index); ~3-4 min. The orchestrator/webui suites spawn real daemons on free ports with a temp HOME, so run them one at a time and allow up to 10 min.
- Single suite: `node tests/orchestrator.test.ts` (they are plain node scripts with asserts, no test runner).
- The concurrency tests in kanban.test.ts are load-sensitive. When touching createTask or anything in the allocation path, run `node tests/kanban.test.ts` several times (3+); a single pass can hide a race.

## Merging main when the base moved
- Convention: a task branch merges main into itself before to-merge (see 7ecec18, ed55fe1). Check `git merge-base main HEAD`; if main has moved past it, `git merge main` in the worktree, resolve conflicts, run `npm test`, commit the merge. Record the merge commit in the task Notes.
- The Merger then fast-forwards or merges cleanly.

## Review notes
- Verify recorded developer assumptions against the code before trusting them; a silent assumption that changes direction is a review finding and belongs in the task Notes.
- Tests added by tasks are smoke-style (`part X` console sections) in the plain script suites; follow that shape, do not introduce a runner.
