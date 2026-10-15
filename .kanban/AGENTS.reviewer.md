# Reviewer guidance (se-llm-team)

## Review loop: verify once, then move on
- Decide the scope from the diff first. Then verify each spec requirement once, record pass/fail, and do not re-open a settled check in later thinking. When every check is settled and the diff is sound, the verdict is pass; do not re-derive it. State the plan once, then run the commands: do not restate the plan or re-choose the method in later thinking.
- The verdict stands on the diff plus the scoped suite run. Do not reconstruct pre-fix behavior to prove what the diff already shows: no `git show <base>:<file>` extraction, no evaluation of old code in Node, no stash. If a claim names a commit, read that commit's diff with one command and stop.
- Stop a check at the first agreement between two readings (e.g. `:hover` vs `.agent-card-active` both resolve to the wanted color): record pass and move on. Do not re-derive a computed value that already matched, and do not end a pass with an unresolved "let me check": run the one command that closes it.
- Verify claims in the task Notes (named commits, recorded outputs) with one command at first read, not at the end. The named command is your next tool call. A grep is not a suite run: do not swap it in, and do not read test sources first to predict the result. A deferred check grows into re-litigation. Recorded live checks (Playwright, browser, daemon runs) are facts: accept them, never plan to reproduce them.
- Enforce the test policy by outcome: a fix needs a test covering the bug, a feature needs tests for the new behavior, a refactor needs the tests passing. complexity: trivial is exempt.
- Append findings to # Notes in SPECS.md. Check counts and section structure inside the same edit, not in a follow-up edit.
- A silent developer assumption that changes direction is a review finding and belongs in the task Notes. Open questions hold questions for the user, never assumptions. An "Assumptions" entry under Open questions that the specs already answer moves to Notes, or drops as settled, in the same edit as your findings. Apply this rule mechanically and move on.

## Read one file per call
- Read files with the read tool, one file per call. A bash command that prints two or more files can pass the 50KB output cap, hide the echo headers, and force grep salvage from the log file.
- .kanban files (role notes, SPECS.md) are untracked in the worktree: git diff and git log say nothing about them. To check a "moved into .kanban" claim, grep the file in the task worktree directly. Do not search git history for untracked files.
- Your cwd SPECS.md is a symlink through the linked .kanban board to the current task file in the main checkout. It is git-ignored. Append to it directly, right after the last check passes. Never inspect the path: no ls, no realpath, no worktree-vs-board check, no check of the .kanban chain. Every link lands in the main checkout by design.

## Running the suites
- Suites are plain node scripts with asserts, no test runner. Eight: kanban, orchestrator, webui, extension, efficiency-analysis, mcp, plugin (tests/), plus index at the root (`node index.test.ts`, not tests/index.test.ts). `npm test` runs all eight; never run it. Run only the suites the diff touches.
- Long suites (orchestrator, webui) spawn real daemons on free ports: run one at a time, allow up to 10 min, and capture the result in one command:
  `node tests/orchestrator.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`
  Never pipe a suite to `tail`: the pipe replaces the exit code with tail's and hides the pass marker, which forces a full re-run (~3.5 min).
- Coverage map (decide scope once from the diff):
  - src/efficiency-analysis.ts, src/analysis-run.ts: tests/efficiency-analysis.test.ts plus tests/orchestrator.test.ts (part AT2 exercises the real analysis hook).
  - src/tools.ts: tests/mcp.test.ts (fast) plus tests/extension.test.ts.
  - src/mcp.ts: tests/mcp.test.ts.
  - src/orchestrator/* (liveness, spawn, pipeline): tests/orchestrator.test.ts.
  - src/webui/*, src/kanban.ts, src/hub.ts: tests/webui.test.ts. When the diff touches none of these, skip it and say so once.
  - agents/*.md, skills/se-llm-team/SKILL.md: tests/plugin.test.ts reads the real SKILL.md; it is the only suite to run. No test reads the real role prompts: tests/efficiency-analysis.test.ts exercises prompt substitution with temp-dir fixtures.
  - tests/*.ts: the touched suite.
- kanban.test.ts concurrency tests are load-sensitive. When touching createTask or the allocation path, run it 3+ times; a single pass can hide a race.
- tests/mcp.test.ts is fast: it spawns `node src/mcp.ts` against a temp git repo plus an in-process part with a spawn stub.

## Facts that bite
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- Tests added by tasks are smoke-style (`part X` console sections) in the plain script suites; follow that shape, do not introduce a runner.
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the quoting layers mangle it and the command dies on a syntax error. If code must run, write it to a temp file, run it, delete it.

## Merge flow (rebase, #199)
- The orchestrator rebases the task branch onto the base at merge time, then ff-merges; main history stays linear. A rebase conflict goes to the spawned Merger (`--ours` = base side, then `git rebase --continue`).
- Find the base branch with `git -C /home/phamba/repos/se-llm-team branch --show-current`; never assume main.

## Verifying webui PAGE parity
- PAGE (defined in src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source into the served page, so a webui refactor must keep it byte-identical. Copy the old page module inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete the temp file. Compare runtime exports with a name + `String()` diff of the two module objects.

## Liveness and poll internals (only when the diff touches the poll path)
- poll(root, stallMinutes, now) is directly callable with an injectable stall window: hand-write a pid file (a dead pid like "999999999" reads dead) and an exit file .pids/<name>.exit, then call poll and assert the state.
- WORKING_STATES (src/orchestrator/liveness.ts) keys are only doing, reviewing, live-testing, merging. Queue states (to-do, to-review, to-merge, to-live-test) are not working states: the poll's !working path clears stale files and never moves a task.
- A merging fixture must also write .pids/merger.slug naming the recorded task, or the task requeues to to-merge (part AU of orchestrator.test.ts).
- The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file so the next pass re-logs "left for the PM" instead of crash-bouncing. Only a fresh spawn or a poll-observed transition clears it.
- newestRunRole parses .logs file names: match `.log(?:\.gz)?$` (every sweep gzips finished logs between exit and the next poll) and return the role capture m[2], not the slug m[1].
- compactFinishedLogs must survive unresolvable entries: the AT3 skip-path fixture plants a broken symlink whose read throws; an unguarded read propagates out of poll and kills the daemon loop.
- The self-advanced analysis path (poll's !working + hadPid + exit 0) is only exercised by a poll with a hand-written stale pid + exit file. When touching the poll's dead-pid paths, add a poll-driven self-advanced check (part AT3 shape).

## State transitions
- kanban_get, kanban_set_state, kanban_list are MCP tools, not built-ins: run tool_search("kanban") to load them before a transition.
- A task parked per its own Specs (no runnable precondition, e.g. #221) goes back to backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds it for the user with no respawn loop. to-do would re-spawn a developer at once.
