# Reviewer guidance (se-llm-team)

## Shape (in order)
1. Read cwd SPECS.md (symlink; see Files): body, Notes, Open questions.
2. Recon: exactly two bash calls (see Recon), then leave recon.
3. Checks: one command per spec requirement (see Checks); related commands batched in one block, one-line lead-in each.
4. Tests: the suites the diff touches, once (see Tests).
5. Findings edit: one edit to SPECS.md (see Findings).
6. State transition: tool_search → kanban_get → kanban_set_state; final text is one sentence (see State transition).

## Thinking (largest measured waste: last two runs, thinking carried ~90% of streamed output; one run had a 15k-char block, 47% of the whole run, re-walking the diff against the Specs; the verdict was composed three times)
- A thinking block only reads the last tool result and names the next command this file fixes, in one or two lines. If the next action is fixed above, act without a thinking block.
- Never walk the Specs point by point in thinking, compare field lists by hand, quote spec or diff code, trace data flow, races, or counter interleavings, restate the Shape as a plan, or compose the findings text. That walk is the Checks commands: run the command, then reason from its output. No hand-computed values, no re-derived answers.
- The full verdict exists exactly once, inside the findings edit's newText. Never state a spec-by-spec verdict in a thinking block, and never after the state transition.
- Hard boundaries: no thinking before Recon call 1 or before tool_search. After the last suite passes: at most one doubt-closing command, then the findings edit itself. The findings edit is built from the per-check pass/fail lines already made, not re-derived.
- One narration per fact, in the findings edit. Outside it: one-line tool lead-ins and the final state sentence.
- A settled check never reopens: output in context is evidence, in a fresh pass or a re-review. One doubt, one command, executed now.
- Scope: spec requirements plus the tests the diff touches. No what-if traces, no web or project-memory search. An unrun full `pnpm test` is never a finding and never a deliberation. No mapped area (Coverage map) → say so once in the findings edit, skip.
- Budget: at most 3 thinking blocks and ~1k chars per review. This run: 6 blocks, ~29k chars.

## Re-reviews
- A task in reviewing with review bullets in Notes is a second pass: a normal cycle. Never deliberate fresh-vs-continued session state or prior-evidence staleness; verify each prior claim with the usual one command per requirement.
- Claims that hold: one findings line ("re-review at <sha>", no fixes). Claims that fail: findings in Notes.

## Recon (exactly two bash calls)
- Call 1, state + diff stat: `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`. The `-C` lookup reads the main checkout; the task worktree sits on the task branch, so no root-vs-worktree question exists.
- Call 2, full diff: `git diff <name-from-base=...>...HEAD`, a mechanical substitution of the printed name. Substitute even when the name looks like `main`: branches stack, and a branch typed from memory silently reviews the wrong base.
- The base diff carries other tasks' commits. When Notes name the implemented commit(s), those commits are the review scope: one `git show <sha>` each, the rest out of scope, no range deliberation.

## Checks
- One requirement, one command, one recorded pass/fail. If your note and the file disagree, the file wins, recorded once.
- Ordering spec points end at one read of the producing site; the call sites around it answer the coverage question. No caller traces, no spawn-path re-derivation.
- A consumer class (undefined-field defaults like `t.agents || []`, `t.body || ""`) is proven by one grep of the consuming functions, once. Never re-prove it per field in a later turn.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. A minor Notes inaccuracy is one line in findings, never a blocked merge.

## Tests
- One command, once: `node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`; /tmp/s.log is scratch, leave it.
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

## Findings (one edit to cwd SPECS.md, appended to # Notes)
- The spec-by-spec pass/fail verdict is written exactly once, in this edit's newText, assembled from the recorded per-check results.
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
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- commitKanban (src/orchestrator/board.ts) never stages the index, so a pathspec-less commit elsewhere cannot fold board content into a mirror commit. A "what rides this commit?" doubt: one grep of the committing function.
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the layers mangle it. Write it to a temp file, run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete; compare runtime exports with a name + `String()` diff of the two module objects.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES holds only doing, reviewing, live-testing, merging; the !working path clears stale files, never moves a task. poll(root, stallMinutes, now) takes an injectable stall window; a dead pid like "999999999" reads dead. A merging fixture writes .pids/merger.slug, or the task requeues to to-merge. The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file; a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` and returns the role capture, not the slug. compactFinishedLogs must survive unresolvable entries: a broken-symlink read throws, and an unguarded read kills the daemon loop. Poll changes need a poll-driven self-advanced check (AT3 shape).
- Merge flow: the orchestrator rebases the task branch onto the base at merge time, then ff-merges, one rebase per sweep in a serialized lane. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours. The rebase block in pipeline.ts shows the full order, and the Merger spawn sits after a hygiene pass in the same sweep, so every conflict-round rebase starts clean. One read answers ordering and Merger coverage; no spawn.ts trace, no rebase --continue speculation.
