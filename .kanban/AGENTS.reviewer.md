# Reviewer guidance (se-llm-team)

## Run shape (in order)
1. Read cwd SPECS.md (symlink to the task file): body, Notes, Open questions.
2. Recon: exactly two bash calls (below). Never re-run, never split further.
3. Verify each spec requirement: one command, record pass/fail in the finding, move on.
4. Run the suites the diff touches (Coverage map), once.
5. Append findings to # Notes in one edit; close Open questions in the same edit.
6. State transition (below): tool_search → kanban_get → kanban_set_state. Output nothing after set_state: the findings in SPECS.md are the verdict.

## Recon (exactly two bash calls)
- Call 1, state and stat. It prints `base=<name>`; that echo is the only branch name call 2 needs (the worktree branch is visible in the task frontmatter, not printed):
  `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`
- Call 2, full diff: `git diff <name-from-base=...>...HEAD`, a mechanical substitution of the printed name. Never re-derive the base name, never assume main, never deliberate about how to obtain it.
- The `-C` lookup reads the main checkout because the task worktree sits on the task branch and the base branch does not. No root-vs-worktree question exists.
- Branches stack: the base diff carries other tasks' commits. When Notes name the implemented commit, review `git show <sha>` and treat the rest as out of scope. No per-commit attribution beyond that.
- Do not search project memory or the web for task context: SPECS.md plus the diff is the record.

## Checks
- One requirement, one command, one recorded pass/fail. A settled check never reopens. Each verdict is written once, in the findings edit: no lead-in text, no recap block, no closing summary restates it. If you catch yourself recapping a passed check, start the findings edit.
- Output already in context is evidence: never re-grep or re-read a site you just confirmed.
- Shape and type doubts end at one grep of the producing site. No cross-file traces, no hypothetical variants the compiler or the diff already rejects.
- A claim that names a commit: one `git show <sha>`, stop. No `git show <base>:<file>` extraction, no running old code.
- Stop a check at the first agreement between two readings. Never write a finding with an open "let me check": run the closing command first.
- Findings state observed facts from output in hand. If your note and the file disagree, the file wins; record the file's state once.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. A minor Notes inaccuracy is one line in findings, never a blocked merge.

## Tests
- Recorded runs in Notes are facts. Never re-run them and never debate it. Your only run is the scoped suite below.
- Run only the suites the diff touches, once, in one command:
  `node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`
- When the diff adds a `part X`, close the check right after the run with `grep -n "part X" /tmp/s.log` (or its pass line). No separate deliberation.
- Policy: fix → a test for the bug; feature → tests for the new behavior; refactor → tests pass; complexity: trivial → exempt. When the diff edits a test, one grep of tests/ for the old assertion closes the "other tests pin the old behavior" question.
- Long suites (orchestrator, webui) spawn real daemons: one at a time, allow 10 min. Never pipe a suite to `tail`; the pipe hides the exit code and forces a full re-run (~3.5 min).
- Tasks add smoke-style `part X` console sections to these plain node scripts; follow that shape, no runner.
- kanban.test.ts concurrency tests are load-sensitive: when the diff touches createTask or the allocation path, run it 3+ times; a single pass can hide a race.

## Coverage map (decide once from the diff)
- src/efficiency-analysis.ts, src/analysis-run.ts → tests/efficiency-analysis.test.ts, plus tests/orchestrator.test.ts (part AT2 exercises the real analysis hook).
- src/tools.ts → tests/mcp.test.ts (fast) plus tests/extension.test.ts. src/mcp.ts → tests/mcp.test.ts.
- src/orchestrator/* (liveness, spawn, pipeline) → tests/orchestrator.test.ts.
- src/webui/*, src/kanban.ts, src/hub.ts → tests/webui.test.ts.
- agents/*.md, skills/se-llm-team/SKILL.md → tests/plugin.test.ts (reads the real SKILL.md), and it is the only suite to run. No test reads real role prompts: tests/efficiency-analysis.test.ts uses temp-dir fixtures.
- tests/*.ts → the touched suite. Diff touches no mapped area → say so once, skip.

## Findings and Open questions
- Findings go to # Notes in cwd SPECS.md, one edit (check counts, dropped entries, section structure inside it). Never edit the task body, another task's file, or AGENTS.*.md.
- Open questions: decide each entry on first read, never revisit. An Assumptions entry the specs already answer → delete it in the findings edit; never move it to Notes, never re-argue it. If the section empties, delete the header too. Silent assumptions that change direction are findings and belong in Notes. Open questions hold questions for the user, never assumptions.

## State transition (always last, three steps)
1. tool_search("kanban") loads the MCP tools (kanban_get, kanban_set_state, kanban_list).
2. kanban_get({}) before set_state: the spawn prompt mandates the re-read, so make it and move on. Abort when the state no longer matches what you saw at start.
3. kanban_set_state({ state }) and end the run. Output nothing after it: the findings in SPECS.md are the verdict, a closing text block only restates them.
- Pass → to-merge. A task parked per its own specs (no runnable precondition) → backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds it for the user with no respawn loop. to-do re-spawns a developer at once.

## Files
- read tool, one file per call. A bash command that prints two or more files hits the 50KB cap, hides the echo headers, and forces grep salvage from a log file.
- cwd SPECS.md is a symlink through the board to the current task file in the main checkout. Read and edit through it; append right after the last check passes. Never inspect the link chain itself: no ls, no realpath, no worktree-vs-board check. Reading the task body or other .kanban files in the main checkout is allowed and expected; only chain inspection is banned.
- .kanban files (role notes, task files, SPECS.md) are untracked in the worktree: git diff and git log say nothing about them. To check a "moved into .kanban" claim, grep the worktree directly. No git-history searches for untracked files.

## Facts that bite
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the quoting layers mangle it and the command dies on a syntax error. Write it to a temp file, run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete. Compare runtime exports with a name + `String()` diff of the two module objects.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES holds only doing, reviewing, live-testing, merging; queue states (to-do, to-review, to-merge, to-live-test) are not working states, and the !working path clears stale files, never moves a task. poll(root, stallMinutes, now) takes an injectable stall window; a dead pid like "999999999" reads dead. A merging fixture also writes .pids/merger.slug or the task requeues to to-merge. The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file; a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` and returns the role capture, not the slug. compactFinishedLogs must survive unresolvable entries: a broken symlink read throws, and an unguarded read kills the daemon loop. Poll changes need a poll-driven self-advanced check (AT3 shape).
- Merge flow (#199): the orchestrator rebases the task branch onto the base at merge time, then ff-merges. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours.
