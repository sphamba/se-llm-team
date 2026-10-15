# Reviewer guidance (se-llm-team)

## Verdict loop
- Recon is two bash calls, no more: the recon command
  `git -C /home/phamba/repos/se-llm-team branch --show-current && git log --oneline -5 && git status --short && git diff <branch>...HEAD --stat`
  (substitute the printed branch for `<branch>`, never assume main), then the full diff (`git diff <branch>...HEAD`). Do not split the recon into separate branch/log/status calls, and do not re-run it.
- Do not search project memory (hindsight) or the web for task context: your SPECS.md read plus the diff hold the record, and the search returns generic pages you then dismiss in a later block.
- Verify each spec requirement once: one command, write the pass/fail into the finding as you go, move on. The findings section is the verdict; a settled check never reopens in later thinking, and no block restates settled checks, the plan, or the pass verdict. If you notice yourself recapping a passed check, start the findings edit instead.
- Data-shape and type questions end fast: internal fields carry TS annotations and the suite exercises the runtime paths. One grep of the producing site settles a shape doubt. No end-to-end trace across files, no hypothetical variant the compiler or the diff guard already rejects.
- Materiality decides blocking: a discrepancy blocks only if it changes the verdict or hides a defect. A minor task-Notes inaccuracy (a bullet kept instead of removed, a wrong date) is one line in your findings, never a re-derivation, never a blocked merge. Decide at first read and move on.
- The verdict stands on the diff plus one scoped suite run (see Coverage map). Run the suite the diff touches once and stop; do not debate whether a recorded run must be re-run, and do not read test sources first to predict the result. Recorded live checks (Playwright, browser, daemon runs) are facts: accept them, never plan to reproduce them.
- If a claim names a commit, read that commit's diff with one command and stop. No `git show <base>:<file>` extraction, no evaluation of old code in Node, no stash.
- Stop a check at the first agreement between two readings; record pass and move on. Never end a pass with an unresolved "let me check": run the one command that closes it before you write the finding.
- Write a finding only after the confirming output is in hand, and phrase it as the observed state, not the delta you expected. If your note and the file disagree, the file wins: record the file's state once.
- Findings go to # Notes in your cwd SPECS.md, in one edit (check counts, dropped entries, and section structure inside the same edit). Never edit the task body, another task's file, or AGENTS.*.md to record findings or fix Notes.
- Test policy by outcome: a fix needs a test covering the bug, a feature needs tests for the new behavior, a refactor needs the tests passing. complexity: trivial is exempt. When the diff edits a test, one grep of tests/ for the old assertion closes the "other tests pin the old behavior" question as part of that check.
- Open questions are settled on first read, one decision, never revisited: an "Assumptions" entry that the specs already answers is deleted in your findings edit, never moved to Notes and never re-argued. If the section empties, delete the header too. Silent developer assumptions that change direction are findings and belong in Notes; Open questions hold questions for the user, never assumptions.

## Files and the SPECS.md symlink
- Read files with the read tool, one file per call. A bash command that prints two or more files can pass the 50KB output cap, hide the echo headers, and force grep salvage from a log file.
- Your cwd SPECS.md is a symlink through the board to the current task file in the main checkout. Reading and editing through it is normal; append right after the last check passes. Never inspect the link chain itself: no ls, no realpath, no worktree-vs-board check. Reading the task body or other .kanban files in the main checkout is allowed and expected; only chain inspection is banned.
- .kanban files (role notes, task files, SPECS.md) are untracked in the worktree: git diff and git log say nothing about them. To check a "moved into .kanban" claim, grep the worktree directly. Do not search git history for untracked files.

## Suites
Plain node scripts with asserts, no test runner. Eight: kanban, orchestrator, webui, extension, efficiency-analysis, mcp, plugin (tests/), plus index at the root (`node index.test.ts`, not tests/index.test.ts). `npm test` runs all eight; never run it. Run only the suites the diff touches, captured in one command:
`node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`
- Long suites (orchestrator, webui) spawn real daemons on free ports: one at a time, allow up to 10 min. Never pipe a suite to `tail`: the pipe replaces the exit code with tail's and hides the pass marker, which forces a full re-run (~3.5 min).
- Coverage map (decide once from the diff):
  - src/efficiency-analysis.ts, src/analysis-run.ts: tests/efficiency-analysis.test.ts, plus tests/orchestrator.test.ts (part AT2 exercises the real analysis hook).
  - src/tools.ts: tests/mcp.test.ts (fast) plus tests/extension.test.ts. src/mcp.ts: tests/mcp.test.ts.
  - src/orchestrator/* (liveness, spawn, pipeline): tests/orchestrator.test.ts.
  - src/webui/*, src/kanban.ts, src/hub.ts: tests/webui.test.ts.
  - agents/*.md, skills/se-llm-team/SKILL.md: tests/plugin.test.ts reads the real SKILL.md; it is the only suite to run. No test reads the real role prompts: tests/efficiency-analysis.test.ts exercises prompt substitution with temp-dir fixtures.
  - tests/*.ts: the touched suite. When the diff touches no mapped area, say so once and skip.
- kanban.test.ts concurrency tests are load-sensitive: when touching createTask or the allocation path, run it 3+ times; a single pass can hide a race.
- Tasks add smoke-style `part X` console sections to these plain scripts; follow that shape, do not introduce a runner.

## Facts that bite
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the quoting layers mangle it and the command dies on a syntax error. If code must run, write it to a temp file, run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete the temp file. Compare runtime exports with a name + `String()` diff of the two module objects.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES keys are only doing, reviewing, live-testing, merging; queue states (to-do, to-review, to-merge, to-live-test) are not working states, and the poll's !working path clears stale files, never moves a task. poll(root, stallMinutes, now) is callable with an injectable stall window: hand-write a pid file (a dead pid like "999999999" reads dead) plus .pids/<name>.exit, call poll, assert. A merging fixture also writes .pids/merger.slug or the task requeues to to-merge (part AU). The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file, so the next pass re-logs "left for the PM"; only a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` (every sweep gzips finished logs) and returns the role capture, not the slug. compactFinishedLogs must survive unresolvable entries: the AT3 skip-path fixture plants a broken symlink whose read throws; an unguarded read kills the daemon loop. When touching the poll's dead-pid paths, add a poll-driven self-advanced check (part AT3 shape).
- Merge flow (#199): the orchestrator rebases the task branch onto the base at merge time, then ff-merges. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours.

## State transitions (always last)
- kanban_get, kanban_set_state, kanban_list are MCP tools, not built-ins: run tool_search("kanban") to load them, then set the state. Skip kanban_get before set_state: your SPECS.md read already holds the task body and notes.
- Verdict pass → to-merge. A task parked per its own Specs (no runnable precondition, e.g. #221) goes back to backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds it for the user with no respawn loop. to-do would re-spawn a developer at once.
