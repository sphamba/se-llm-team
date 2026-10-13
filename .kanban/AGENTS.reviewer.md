# reviewer: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.

## Running the suites
- `npm test` in the worktree runs all five (kanban, orchestrator, webui, extension, index); ~3-4 min. The orchestrator/webui suites spawn real daemons on free ports with a temp HOME, so run them one at a time and allow up to 10 min.
- Single suite: `node tests/orchestrator.test.ts` (they are plain node scripts with asserts, no test runner).
- The concurrency tests in kanban.test.ts are load-sensitive. When touching createTask or anything in the allocation path, run `node tests/kanban.test.ts` several times (3+); a single pass can hide a race.

## Merging main when the base moved
- Convention: a task branch merges main into itself before to-merge (see 7ecec18, ed55fe1). Check `git merge-base main HEAD`; if main has moved past it, `git merge main` in the worktree, resolve conflicts, run `npm test`, commit the merge. Record the merge commit in the task Notes.
- The Merger then fast-forwards or merges cleanly.

## Verifying webui PAGE parity
- `PAGE` interpolates function source into the served page, so a webui refactor must keep it byte-identical. To check: `git show main:src/webui.ts > src/webui_old_review.ts` (inside src/ so its relative imports resolve), then a 3-line mjs script `await import(process.argv[2])` + `writeFileSync(process.argv[3], mod.PAGE)` run once for the old file and once for `./src/webui/index.ts` (and `./src/webui.ts` for the shim). Diff the outputs. Delete the temp file after. Also compare runtime exports with a name + `String()` diff of the two module objects.

## Probing the liveness poll and the exit-file mechanism
- `poll(root, stallMinutes, now)` is directly callable with an injectable stall window, so races are testable without real daemons: hand-write a pid file (a bare dead pid, e.g. "999999999", reads dead; killTree stays safe on it) and an exit file `.pids/<name>.exit`, then call poll and assert the state.
- WORKING_STATES keys are only doing, reviewing, live-testing, merging. Queue states (to-do, to-review, to-merge, to-live-test) are NOT working states: the poll's !working path clears a stale pid + exit file and the dead streak there and never moves the task. Every working state is entered through spawnAgent, which clears the exit file before the spawn, so a working state never starts with a foreign exit code.
- The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file so the next pass re-logs "left for the PM" instead of crash-bouncing. Only a fresh spawn or a poll-observed transition clears it.

## Review notes
- Verify recorded developer assumptions against the code before trusting them; a silent assumption that changes direction is a review finding and belongs in the task Notes.
- Tests added by tasks are smoke-style (`part X` console sections) in the plain script suites; follow that shape, do not introduce a runner.
