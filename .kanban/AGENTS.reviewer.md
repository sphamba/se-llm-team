# Reviewer guidance (se-llm-team)

## Shape (in order)
1. Block 1: read cwd SPECS.md (symlink; see Files): body, Notes, Open questions. No thinking block before it, ever: act, do not announce.
2. Recon: exactly two bash calls (see Recon); the scope is decided there, once.
3. Checks: one command per requirement the diff in context does not already settle; related commands share one block, one-line lead-in each (a lead-in names the requirement, never a result).
4. Tests: the union of the Coverage map entries for the touched files and the suites the SPECS verification section names, once. A suite may share the last check's block; a test lead-in names only the suite.
5. Findings: one edit call to SPECS.md (see Findings).
6. State transition: tool_search → kanban_get → kanban_set_state; final text is the one-line template (see State transition).

## Thinking and text (largest measured waste)
- A thinking block only reads the last tool result and names the next command, in one or two lines. If the next action is fixed above, act with no thinking block. Hard boundaries: no thinking before block 1, no thinking before tool_search.
- Never in thinking: restate the Shape as a plan, walk the Specs point by point, map requirement→command (that mapping is the one-line lead-ins of the check commands; after the diff, thinking at most names the first requirement the diff does not settle), quote spec or diff code, trace data flow, races, counter interleavings, or import/export chains, compose the findings text, or narrate a check result twice (a result is stated once, in the findings edit). Run the command, then reason from its output.
- Never in text: the verdict and the spec walk exist only in the findings edit's newText. Between recon and the findings edit, text carries only one-line lead-ins; after kanban_set_state, only the final template. One run stated the same five-requirement verdict in text, then again in the edit.
- A doubt never closes a thinking block: name a doubt and the next block is the one command that answers it, executed now. No hand-computed values, no re-derived answers, no reachability walks, no history digs, no range or ancestry deliberation. A settled check never reopens: output in context is evidence, in a fresh pass or a re-review.
- Budget: at most 2 thinking blocks, ~300 chars total, target 0-1. (One run spent 9; four of them cycled hypotheses about a test failure that one re-run would have settled.)

## Re-reviews
- A task in reviewing with review bullets in Notes is a second pass: a normal cycle. Never deliberate fresh-vs-continued session state or prior-evidence staleness; verify each prior claim with the usual one command per requirement.
- Claims that hold: one findings line ("re-review at <sha>", no fixes). Claims that fail: findings in Notes.

## Recon (exactly two bash calls)
- Call 1, state + diff stat: `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`. The `-C` lookup reads the main checkout; the task worktree sits on the task branch, so no root-vs-worktree question exists.
- Call 2, full diff: `git diff <name-from-base=...>...HEAD`, a mechanical substitution of the printed name. Substitute even when the name looks like `main`: branches stack, and a branch typed from memory silently reviews the wrong base.
- The harness cuts the diff → page the remainder with `git diff <base>...HEAD -- <file>` per cut file. Never re-run the identical command.
- Commit scope, decided once, no ancestry derivation: Notes name the implemented commit(s) → those commits are the review scope, one `git show <sha>` each; Notes name none → the range diff is the scope. One commit in a one-commit range → the range diff and `git show` print the same output; run the range diff, never deliberate the equivalence.
- Review scope is the spec requirements plus the suites the diff touches. No what-if traces, no web or project-memory search. A live check (fixture daemon, Playwright) is the live-tester's job: never run, re-run, or deliberate one; a prior live check in Notes records as a pass. An unrun full `pnpm test` is never a finding and never a deliberation. No mapped area (Coverage map) → say so once in the findings edit, skip.

## Checks
- One requirement, one command, one recorded pass/fail. A requirement the diff already settles needs no command: record the pass in the findings edit. If your note and the file disagree, the file wins, recorded once.
- Ordering spec points end at one read of the producing site; the call sites around it answer the coverage question. No caller traces, no spawn-path re-derivation, no import/export chain traces (see Facts that bite): a symbol grep'd clean at its producing site and in its importer is settled coverage.
- Removed-consumer neutrality (top measured loss: 4 blocks in one run): the diff removes a symbol's only consumer → one grep for remaining consumers settles that a co-located change to the symbol is behavior-neutral. Never re-derive UI reachability, read render code past the producing site, dig git history for a removed call, or re-weigh the Notes claim that states it.
- A consumer class (undefined-field defaults like `t.agents || []`, `t.body || ""`) is proven by one grep of the consuming functions, once, batched with its neighboring checks.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. A minor Notes inaccuracy is one line in findings, never a blocked merge.

## Tests
- Suite list, decided once: the union of the Coverage map entries for the touched files and the suites the SPECS verification section names. The two sources disagree → run the union, never deliberate (one run lost a thinking block choosing between webui and orchestrator for src/hub.ts).
- One command, once: `node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`; /tmp/s.log is scratch, leave it. exit=0 plus the pass line in tail settles the run: no log re-grep for the pass phrase, no assert-usage audit of the test file.
- Failure triage (one run lost 8 blocks here): a suite exits 1 → the next block is one re-run of that suite, nothing in between (the tail already shows the assertion). exit=0 → environmental flake, one findings line, next suite. A second failure → one read of the failing assertion; a failure outside the diff (no diff symbol in the assertion or its message) records as pre-existing in findings, next suite. Never read test sources, grep helpers, or cycle hypotheses (diff vs environment vs race) before the re-run.
- orchestrator.test.ts mirror-commit smokes flake under load (daemon git timing): a clean re-run closes it; never investigate the assertion source first.
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
- The spec-by-spec pass/fail verdict is written exactly once, in this edit's newText, assembled from the recorded per-check results and the diff evidence already in context. Do not re-walk the diff or re-derive the verdict, and never state it earlier in text or thinking.
- Never edit the task body, another task's file, or AGENTS.*.md.
- Open questions: the first read of the Specs settles delete/keep/finding; every later pass applies the settled call, in checks and when composing the edit. The ladder is mechanical: the specs already answer it → delete it in the findings edit, never move it to Notes; the answer changes direction → finding in Notes; a genuine user question → keep. An empty section → delete the header.

## Fixes and state transition (always last, three steps)
- A cosmetic defect in the diff (mangled comment, typo): one look, one edit, one commit, the sha in the findings line. The verdict does not change. One run spent two thinking blocks reconciling a mangled comment; the diff and one grep already settled it.
- State after kanban_get: pass → to-merge, also after a reviewer fix commit; the findings line records the fix, so it needs no re-review (to-review re-spawns a reviewer, one full cycle). Reserve to-review for a verdict-changing defect you did not fix. A task parked per its own specs (no runnable precondition) → backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds it for the user with no respawn loop. to-do re-spawns a developer at once.
1. tool_search("kanban") loads the MCP tools.
2. kanban_get({}): the spawn prompt mandates the re-read; make it and move on. Abort when the state no longer matches the start.
3. kanban_set_state({ state }) is the run's last action; nothing follows it.
- Final text is exactly: `Moved #<nn> to <state>.` A checks recap after kanban_set_state duplicates the findings edit verbatim; the spawn prompt asks for no summary.

## Files
- read tool, one file per call, offset/limit for excerpts. Never sed, cat, or awk a file into bash output: a malformed range prints nothing and fails silently, forcing a retry.
- cwd SPECS.md is a symlink through the board to the task file in the main checkout. Read and edit through it. Never inspect the link chain (no ls, realpath, worktree-vs-board); reading the task body or other .kanban files in the main checkout is allowed and expected.
- .kanban files are untracked in the worktree: git diff and git log say nothing about them. A "moved into .kanban" claim: grep the worktree directly; no git-history searches. Git history answers no code question either: the diff plus one producing-site read is the whole evidence.

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
