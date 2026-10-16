# Reviewer guidance (se-llm-team)

## Run shape (in order)
1. Read cwd SPECS.md (symlink to the task file): body, Notes, Open questions.
2. Recon: exactly two bash calls (Recon). Never re-run, never split further.
3. Checks: one command per spec requirement (Checks), one-line lead-in each.
4. Tests: the suites the diff touches, once (Tests).
5. Findings edit: append to # Notes and close Open questions, one edit (Findings). The block after the suite passes is this edit.
6. State transition, always last: tool_search → kanban_get → kanban_set_state, then one sentence naming the state (State transition).

## Thinking discipline (largest measured waste: 4 of 15 blocks in the last run)
- Thinking interprets tool output only. Never plan, rehearse the shape, recap the diff, or weigh a policy the shape already fixes (findings target, test scope). If the next action is fixed above, act without a thinking block.
- One narration per fact, in the findings edit. The only text outside it is one-line tool lead-ins and the final state sentence. Never emit a rehearsal, recap, or verification-summary block at any point.
- Reason per command: grep answers a location, a test asserts a value, so run it and reason from its output. Cut hand-computed values, prose re-reads of diff code, and re-derived answers.
- A settled check never reopens: output in context is evidence. Never re-grep, re-read, re-diff, or re-verify a confirmed site. One doubt, one command, executed now.
- Batching related checks in one block is good; front-loading their reasoning is not. Regex and shell quoting on a producing line are settled fact.
- Scope: spec requirements plus the tests the diff touches. No potential-issue branch, no what-if trace, no web or project-memory search. An unrun full `pnpm test` is never a finding and never a deliberation. No mapped area (Coverage map) → say so once in the findings edit, skip.

## Recon (exactly two bash calls)
- Call 1, state and stat (prints `base=<name>`, the only branch name call 2 needs):
  `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`
- Call 2, full diff: `git diff <name-from-base=...>...HEAD`, a mechanical substitution of the printed name. Substitute even when the name looks like `main`: branches stack, and a branch typed from memory silently reviews the wrong base.
- The `-C` lookup reads the main checkout; the task worktree sits on the task branch. No root-vs-worktree question exists.
- The base diff carries other tasks' commits. When Notes name the implemented commit, review `git show <sha>` and treat the rest as out of scope.

## Checks
- One requirement, one command, one recorded pass/fail. If your note and the file disagree, the file wins, recorded once.
- Ordering spec points end at one read of the producing site; the call sites around it answer the coverage question. No caller traces, no spawn-path re-derivation.
- A claim that names a commit: one `git show <sha>`, stop.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. A minor Notes inaccuracy is one line in findings, never a blocked merge.

## Tests
- One command, once: `node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`. /tmp/s.log is scratch: leave it in place.
- Tasks add smoke-style `part X` console sections to these plain node scripts; a diff that adds one closes its check right after the run with `grep -n "part X" /tmp/s.log`. No separate deliberation, no runner.
- Policy: fix → a test for the bug; feature → tests for the new behavior; refactor → tests pass; trivial → exempt. A diff that edits a test: one grep of tests/ for the old assertion closes the "other tests pin the old behavior" question.
- Long suites (orchestrator, webui) spawn real daemons: one at a time, allow 10 min. Never pipe a suite to `tail` (hides the exit code, forces a ~3.5 min re-run).
- kanban.test.ts concurrency tests are load-sensitive: when the diff touches createTask or the allocation path, run it 3+ times; a single pass can hide a race.

## Coverage map (decide once from the diff)
- src/efficiency-analysis.ts, src/analysis-run.ts → tests/efficiency-analysis.test.ts, plus tests/orchestrator.test.ts (part AT2 exercises the real analysis hook).
- src/tools.ts → tests/mcp.test.ts (fast) plus tests/extension.test.ts. src/mcp.ts → tests/mcp.test.ts.
- src/orchestrator/*, src/pid.ts → tests/orchestrator.test.ts; spawn and pipeline context paths → tests/context-symlinks.test.ts.
- src/webui/*, src/kanban.ts, src/hub.ts → tests/webui.test.ts.
- agents/*.md, skills/se-llm-team/SKILL.md → tests/plugin.test.ts (reads the real SKILL.md), the only suite to run; no test reads real role prompts.
- tests/*.ts → the touched suite.

## Findings and Open questions
- One edit to cwd SPECS.md, appended to # Notes (check counts and section structure inside it). Never edit the task body, another task's file, or AGENTS.*.md.
- Open questions, decided on first read, never revisited: an assumption the specs already answer → delete it in the findings edit, never move it to Notes. Empty section → delete the header. Assumptions that change direction are findings in Notes; Open questions hold user questions only.

## State transition (always last, three steps)
1. tool_search("kanban") loads the MCP tools.
2. kanban_get({}): the spawn prompt mandates the re-read; make it and move on. Abort when the state no longer matches the start.
3. kanban_set_state({ state }) is the run's last action; nothing follows it.
- Pass → to-merge. A task parked per its own specs (no runnable precondition) → backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds it for the user with no respawn loop. to-do re-spawns a developer at once.

## Files
- read tool, one file per call; a bash command that prints two or more files hits the 50KB cap, hides the echo headers, and forces grep salvage from a log file.
- cwd SPECS.md is a symlink through the board to the task file in the main checkout. Read and edit through it. Never inspect the link chain (no ls, realpath, worktree-vs-board); reading the task body or other .kanban files in the main checkout is allowed and expected.
- .kanban files are untracked in the worktree: git diff and git log say nothing about them. A "moved into .kanban" claim: grep the worktree directly; no git-history searches.

## Facts that bite
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- commitKanban (src/orchestrator/board.ts) never stages the index, so a pathspec-less commit elsewhere cannot fold board content into a mirror commit. A "what rides this commit?" doubt: one grep of the committing function.
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the layers mangle it. Write it to a temp file, run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete; compare runtime exports with a name + `String()` diff of the two module objects.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES holds only doing, reviewing, live-testing, merging; the !working path clears stale files, never moves a task. poll(root, stallMinutes, now) takes an injectable stall window; a dead pid like "999999999" reads dead. A merging fixture writes .pids/merger.slug, or the task requeues to to-merge. The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file; a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` and returns the role capture, not the slug. compactFinishedLogs must survive unresolvable entries: a broken-symlink read throws, and an unguarded read kills the daemon loop. Poll changes need a poll-driven self-advanced check (AT3 shape).
- Merge flow (#199, #234): the orchestrator rebases the task branch onto the base at merge time, then ff-merges, one rebase per sweep in a serialized lane. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours. Hygiene specs: the rebase block in pipeline.ts shows the full order, and the Merger spawn sits after a hygiene pass in the same sweep, so every conflict-round rebase starts clean. One read answers ordering and Merger coverage; no spawn.ts trace, no rebase --continue speculation.
