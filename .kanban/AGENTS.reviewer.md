# Reviewer guidance (se-llm-team)

## Shape (in order)
1. Read cwd SPECS.md (symlink; see Files): body, Notes, Open questions. No thinking before it.
2. Recon: exactly two bash calls (see Recon); the scope is decided there, once.
3. Checks: one command per requirement the diff in context does not already settle; related commands share one block, one-line lead-in each (see Checks).
4. Tests: the suites the diff touches, once (see Tests); the suite may share the last check's block.
5. Findings: one edit call to SPECS.md (see Findings).
6. State transition: tool_search → kanban_get → kanban_set_state; final text is one sentence (see State transition).

## Thinking (largest measured waste)
- A thinking block only reads the last tool result and names the next command, in one or two lines. It never restates the previous result, the Shape, or the budget. If the next action is fixed above, act with no thinking block. Hard boundaries: no thinking before the SPECS.md read, before Recon call 1, or before tool_search.
- Never in thinking: restate the Shape as a plan, walk the Specs point by point or map requirement→command (that mapping is the one-line lead-ins of the check commands), quote spec or diff code, trace data flow, races, counter interleavings, or import/export chains, compose the findings text, state the verdict anywhere but the findings edit's newText, or narrate a fact twice (once in a lead-in or in the findings edit, never both). Run the command, then reason from its output.
- A settled check never reopens: output in context is evidence, in a fresh pass or a re-review. One doubt, one command, executed now. No hand-computed values, no re-derived answers, no range or ancestry deliberation.
- Budget: at most 2 thinking blocks, ~300 chars total, target 0-1. This run: all 7 thinking blocks carried pain, and the top loss was one export-chain trace (3 thinking + 3 bash, ~25% of the run).

## Re-reviews
- A task in reviewing with review bullets in Notes is a second pass: a normal cycle. Never deliberate fresh-vs-continued session state or prior-evidence staleness; verify each prior claim with the usual one command per requirement.
- Claims that hold: one findings line ("re-review at <sha>", no fixes). Claims that fail: findings in Notes.

## Recon (exactly two bash calls)
- Call 1, state + diff stat: `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`. The `-C` lookup reads the main checkout; the task worktree sits on the task branch, so no root-vs-worktree question exists.
- Call 2, full diff: `git diff <name-from-base=...>...HEAD`, a mechanical substitution of the printed name. Substitute even when the name looks like `main`: branches stack, and a branch typed from memory silently reviews the wrong base.
- Commit scope, decided once, no ancestry derivation: Notes name the implemented commit(s) → those commits are the review scope, one `git show <sha>` each; Notes name none → the range diff is the scope.
- Review scope is the spec requirements plus the suites the diff touches. No what-if traces, no web or project-memory search. An unrun full `pnpm test` is never a finding and never a deliberation. No mapped area (Coverage map) → say so once in the findings edit, skip.

## Checks
- One requirement, one command, one recorded pass/fail. A requirement the diff already settles needs no command: record the pass in the findings edit. If your note and the file disagree, the file wins, recorded once.
- Ordering spec points end at one read of the producing site; the call sites around it answer the coverage question. No caller traces, no spawn-path re-derivation, no import/export chain traces (see Facts that bite): a symbol grep'd clean at its producing site and in its importer is settled coverage.
- A consumer class (undefined-field defaults like `t.agents || []`, `t.body || ""`) is proven by one grep of the consuming functions, once, batched with its neighboring checks. Never re-prove it per field or in a later turn.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. A minor Notes inaccuracy is one line in findings, never a blocked merge.

## Tests
- One command, once: `node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`; /tmp/s.log is scratch, leave it. exit=0 plus the pass line in tail settles the run: no log re-grep for the pass phrase, no assert-usage audit of the test file.
- A diff that adds a smoke-style `part X` console section: close the check with one `grep -n "part X" /tmp/s.log` after the run. Part names come from the diff, never from memory or a task note; a count that looks off gets one corrective grep against the log, then the next suite, never a recount loop.
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

## Findings (one edit call to cwd SPECS.md, appended to # Notes)
- One edit call; its edits[] may carry several disjoint changes: the Open-questions deletion and the Notes append go in the same call. Two changes are never a deliberation about the cap.
- The spec-by-spec pass/fail verdict is written exactly once, in this edit's newText, assembled from the recorded per-check results and the diff evidence already in context. Do not re-walk the diff or re-derive the verdict to compose it.
- Never edit the task body, another task's file, or AGENTS.*.md.
- Open questions are decided on first read of the Specs and never revisited; the ladder is mechanical: the specs already answer it → delete it in the findings edit, never move it to Notes; the answer changes direction → finding in Notes; a genuine user question → keep. An empty section → delete the header.

## State transition (always last, three steps)
1. tool_search("kanban") loads the MCP tools.
2. kanban_get({}): the spawn prompt mandates the re-read; make it and move on. Abort when the state no longer matches the start.
3. kanban_set_state({ state }) is the run's last action; nothing follows it.
- Pass → to-merge. A task parked per its own specs (no runnable precondition) → backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds it for the user with no respawn loop. to-do re-spawns a developer at once.
- Final text: one sentence naming the state, nothing else. A checks recap after kanban_set_state duplicates the findings edit verbatim; the spawn prompt asks for no summary.

## Files
- read tool, one file per call; a bash command that prints two or more files hits the 50KB cap, hides the echo headers, and forces grep salvage from a log file.
- cwd SPECS.md is a symlink through the board to the task file in the main checkout. Read and edit through it. Never inspect the link chain (no ls, realpath, worktree-vs-board); reading the task body or other .kanban files in the main checkout is allowed and expected.
- .kanban files are untracked in the worktree: git diff and git log say nothing about them. A "moved into .kanban" claim: grep the worktree directly; no git-history searches.

## Facts that bite
- Split modules keep one-line re-export shims (src/webui.ts → ./webui/index.ts, src/orchestrator.ts → ./orchestrator/index.ts). A symbol that greps clean at its producing site and in its importer is settled; a shim grep miss is the whole answer. Never read the shim or trace the chain: one past run lost ~25% of its blocks proving src/webui.ts re-exports ./webui/index.ts.
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- commitKanban (src/orchestrator/board.ts) never stages the index, so a pathspec-less commit elsewhere cannot fold board content into a mirror commit. A "what rides this commit?" doubt: one grep of the committing function.
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the layers mangle it. Write it to a temp file, run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete; compare runtime exports with a name + `String()` diff of the two module objects.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES holds only doing, reviewing, live-testing, merging; the !working path clears stale files, never moves a task. poll(root, stallMinutes, now, backlogIdleMinutes) takes injectable windows; a dead pid like "999999999" reads dead. A merging fixture writes .pids/merger.slug, or the task requeues to to-merge. The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file; a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` and returns the role capture, not the slug. compactFinishedLogs must survive unresolvable entries: a broken-symlink read throws, and an unguarded read kills the daemon loop. Poll changes need a poll-driven self-advanced check (AT3 shape).
- Merge flow: the orchestrator rebases the task branch onto the base at merge time, then ff-merges, one rebase per sweep in a serialized lane. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours. The rebase block in pipeline.ts shows the full order, and the Merger spawn sits after a hygiene pass in the same sweep, so every conflict-round rebase starts clean. One read answers ordering and Merger coverage; no spawn.ts trace, no rebase --continue speculation.
