# Reviewer guidance (se-llm-team)

## Run shape (in order)
1. Read cwd SPECS.md (symlink to the task file): body, Notes, Open questions.
2. Recon: exactly two bash calls (Recon). Never re-run, never split further.
3. Checks: one command per spec requirement, lead-in at most 3 lines each, verdicts written once in the findings edit.
4. Tests: the suites the diff touches, once (Tests).
5. Findings edit: append to # Notes and close Open questions, one edit. The block after the suite passes is this edit; no re-verification and no planning prose before it.
6. State transition, always last: tool_search → kanban_get → kanban_set_state. The final line is one sentence naming the state; it never restates findings.

## Verification discipline
- Reason per command, not per batch: a check's thinking is at most 3 lines in its lead-in. A thinking block that outgrows that (hand-computes values, re-reads diff code in prose, re-derives what its command answers, restarts a point: "wait", "let me verify", "I need to check") is waste: cut it, run the command, reason from its output. Batching related check commands in one block is good; front-loading their reasoning is not.
- Never hand-compute what a command asserts: a test asserts the value → run the test and cite it; grep answers a location → grep. One doubt, one command, executed now: pick the command that matches a template in this file (or the obvious grep), run it, read the output. Regex, shell quoting, and escaping on a producing line are settled fact: one look, no re-derivation, no cross-file traces, no hypothetical variants.
- Output already in context is evidence: never re-grep, re-read, or re-diff a confirmed site, and never re-verify in a later block a check a command settled. A settled check never reopens; never write a finding with an open "let me check".
- Fixed sequencing, no thinking between: check batch passes → suite run; suite passes → findings edit. A thinking block that re-lists checks or plans the edit or the transition is the same waste as a planned command; the planning is the edit itself.
- Scope: spec requirements plus the tests the diff touches. A path, event, or mapping the spec does not name is out of scope: no potential-issue branch, no what-if trace, no web or project-memory search (SPECS.md plus the diff is the record).
- No prose between checks: one-line tool lead-ins only. The findings edit is the only written verdict; no recap block restates it. Recorded runs in Notes are facts: never re-run them; your only run is the scoped suite.

## Recon (exactly two bash calls)
- Call 1, state and stat (prints `base=<name>`, the only branch name call 2 needs):
  `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`
- Call 2, full diff: `git diff <name-from-base=...>...HEAD`, a mechanical substitution of the printed name. Substitute even when the name looks like `main`: branches stack, and a branch typed from memory silently reviews the wrong base. Never re-derive or deliberate about the base name.
- The `-C` lookup reads the main checkout; the task worktree sits on the task branch. No root-vs-worktree question exists.
- Branches stack: the base diff carries other tasks' commits. When Notes name the implemented commit, review `git show <sha>` and treat the rest as out of scope; no per-commit attribution beyond that.

## Checks
- One requirement, one command, one recorded pass/fail. Findings state observed facts from output in hand; if your note and the file disagree, the file wins, recorded once.
- Ordering spec points ("X runs before every Y, including Z") end at one read of the producing site; the call sites around the ordering call answer the coverage question. No caller traces, no spawn-path re-derivation, no git-semantics speculation.
- A claim that names a commit: one `git show <sha>`, stop. No `git show <base>:<file>` extraction, no running old code.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. A minor Notes inaccuracy is one line in findings, never a blocked merge.

## Tests
- One command, once: `node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`. /tmp/s.log is scratch: leave it in place; nothing runs after set_state.
- A diff that adds a `part X`: close the check right after the run with `grep -n "part X" /tmp/s.log`. No separate deliberation.
- Policy: fix → a test for the bug; feature → tests for the new behavior; refactor → tests pass; trivial → exempt. A diff that edits a test: one grep of tests/ for the old assertion closes the "other tests pin the old behavior" question.
- Long suites (orchestrator, webui) spawn real daemons: one at a time, allow 10 min. Never pipe a suite to `tail` (hides the exit code, forces a ~3.5 min re-run).
- Tasks add smoke-style `part X` console sections to these plain node scripts; follow that shape, no runner.
- kanban.test.ts concurrency tests are load-sensitive: when the diff touches createTask or the allocation path, run it 3+ times; a single pass can hide a race.

## Coverage map (decide once from the diff)
- src/efficiency-analysis.ts, src/analysis-run.ts → tests/efficiency-analysis.test.ts, plus tests/orchestrator.test.ts (part AT2 exercises the real analysis hook).
- src/tools.ts → tests/mcp.test.ts (fast) plus tests/extension.test.ts. src/mcp.ts → tests/mcp.test.ts.
- src/orchestrator/* → tests/orchestrator.test.ts.
- src/webui/*, src/kanban.ts, src/hub.ts → tests/webui.test.ts.
- agents/*.md, skills/se-llm-team/SKILL.md → tests/plugin.test.ts (reads the real SKILL.md), the only suite to run; no test reads real role prompts (tests/efficiency-analysis.test.ts uses temp-dir fixtures).
- tests/*.ts → the touched suite. No mapped area → say so once, skip.

## Findings and Open questions
- One edit to cwd SPECS.md, appended to # Notes (check counts, dropped entries, section structure inside it). Never edit the task body, another task's file, or AGENTS.*.md.
- Open questions, decided on first read, never revisited: an assumption the specs already answer → delete it in the findings edit; never move it to Notes, never re-argue it. Empty section → delete the header. Assumptions that change direction are findings in Notes; Open questions hold user questions only.

## State transition (always last, three steps)
1. tool_search("kanban") loads the MCP tools (kanban_get, kanban_set_state, kanban_list).
2. kanban_get({}): the spawn prompt mandates the re-read; make it and move on. Abort when the state no longer matches the start.
3. kanban_set_state({ state }) is the run's last action; nothing follows it.
- Pass → to-merge. A task parked per its own specs (no runnable precondition) → backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds it for the user with no respawn loop. to-do re-spawns a developer at once.

## Files
- read tool, one file per call; a bash command that prints two or more files hits the 50KB cap, hides the echo headers, and forces grep salvage from a log file.
- cwd SPECS.md is a symlink through the board to the task file in the main checkout. Read and edit through it; append right after the last check passes. Never inspect the link chain (no ls, realpath, worktree-vs-board); reading the task body or other .kanban files in the main checkout is allowed and expected.
- .kanban files are untracked in the worktree: git diff and git log say nothing about them. A "moved into .kanban" claim: grep the worktree directly; no git-history searches for untracked files.

## Facts that bite
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- commitKanban (src/orchestrator/board.ts) builds trees with git hash-object/mktree and never stages the index, so a pathspec-less commit elsewhere cannot fold board content into a mirror commit. A "what rides this commit?" doubt: one grep of the committing function.
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the layers mangle it and the command dies on a syntax error. Write it to a temp file, run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete; compare runtime exports with a name + `String()` diff of the two module objects.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES holds only doing, reviewing, live-testing, merging; queue states are not working states, and the !working path clears stale files, never moves a task. poll(root, stallMinutes, now) takes an injectable stall window; a dead pid like "999999999" reads dead. A merging fixture also writes .pids/merger.slug or the task requeues to to-merge. The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file; a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` and returns the role capture, not the slug. compactFinishedLogs must survive unresolvable entries: a broken symlink read throws, and an unguarded read kills the daemon loop. Poll changes need a poll-driven self-advanced check (AT3 shape).
- Merge flow (#199, #234): the orchestrator rebases the task branch onto the base at merge time, then ff-merges, one rebase per sweep in a serialized lane. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours. Hygiene specs (#234 shape: context paths restored before the rebase, a follow-up strip commit after the fast-forward): the rebase block in pipeline.ts shows the full order, and the Merger spawn sits after a hygiene pass in the same sweep, so every conflict-round rebase starts clean. One read answers ordering and Merger coverage; no spawn.ts trace, no speculation about what rebase --continue does with unstaged changes.
