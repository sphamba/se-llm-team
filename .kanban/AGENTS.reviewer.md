# reviewer: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.

## Running the suites
- `npm test` in the worktree runs all seven (kanban, orchestrator, webui, extension, efficiency-analysis, index, mcp); ~5 min. The orchestrator/webui suites spawn real daemons on free ports with a temp HOME, so run them one at a time and allow up to 10 min.
- Single suite: `node tests/orchestrator.test.ts` (they are plain node scripts with asserts, no test runner). The index suite is root-level `node index.test.ts`, not tests/index.test.ts. tests/mcp.test.ts is fast: it spawns `node src/mcp.ts` against a temp git repo plus an in-process part with a spawn stub.
- The shared tool schemas in src/tools.ts are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- The MCP host has no wire validator: src/mcp.ts calls checkEnums before dispatch, because pi validates before execute but an MCP client must not silently write an out-of-enum value (state, priority, complexity, scope). Removing that guard re-opens silent board corruption.
- The concurrency tests in kanban.test.ts are load-sensitive. When touching createTask or anything in the allocation path, run `node tests/kanban.test.ts` several times (3+); a single pass can hide a race.

## Merge flow (rebase, #199)
- The orchestrator rebases the task branch onto the base at merge time, then ff-merges the branch into the base; main history stays linear (no merge commits). A task branch no longer merges main into itself before to-merge: a moved base is handled by the orchestrator's rebase, and a rebase conflict is resolved by the spawned Merger (`--ours` = base side, then `git rebase --continue`). Find the base branch with `git -C /home/phamba/repos/se-llm-team branch --show-current`, never assume main.

## Verifying webui PAGE parity
- `PAGE` interpolates function source into the served page, so a webui refactor must keep it byte-identical. To check: `git show main:src/webui.ts > src/webui_old_review.ts` (inside src/ so its relative imports resolve), then a 3-line mjs script `await import(process.argv[2])` + `writeFileSync(process.argv[3], mod.PAGE)` run once for the old file and once for `./src/webui/index.ts` (and `./src/webui.ts` for the shim). Diff the outputs. Delete the temp file after. Also compare runtime exports with a name + `String()` diff of the two module objects.

## Probing the liveness poll and the exit-file mechanism
- `poll(root, stallMinutes, now)` is directly callable with an injectable stall window, so races are testable without real daemons: hand-write a pid file (a bare dead pid, e.g. "999999999", reads dead; killTree stays safe on it) and an exit file `.pids/<name>.exit`, then call poll and assert the state.
- A merging task the poll matches against `.pids/merger.slug` (written at merger spawn): a task the slug file does not name requeues to to-merge with no death record. A hand-written poll fixture that puts a task in merging must also write that slug file naming the recorded task (or the task requeues) - see part AU of orchestrator.test.ts.
- WORKING_STATES keys are only doing, reviewing, live-testing, merging. Queue states (to-do, to-review, to-merge, to-live-test) are NOT working states: the poll's !working path clears a stale pid + exit file and the dead streak there and never moves the task. Every working state is entered through spawnAgent, which clears the exit file before the spawn, so a working state never starts with a foreign exit code.
- The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file so the next pass re-logs "left for the PM" instead of crash-bouncing. Only a fresh spawn or a poll-observed transition clears it.

## Review notes
- Verify recorded developer assumptions against the code before trusting them; a silent assumption that changes direction is a review finding and belongs in the task Notes.
- Tests added by tasks are smoke-style (`part X` console sections) in the plain script suites; follow that shape, do not introduce a runner.
- Check the pass criterion in the task's Failure section before a to-merge pass: it may require recorded outputs (commands, argv, observed results), not just a correct diff (test task #221).
- A task parked per its own Specs (no runnable precondition, e.g. #221) goes back to backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds it for the user with no respawn loop. to-do would re-spawn a developer at once (the sweep's to-do path has no openQuestions gate).
