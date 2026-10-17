# Reviewer guidance (se-llm-team)

## Shape (in order)
1. Read cwd SPECS.md (symlink; see Files): body, Notes, Open questions. No thinking block before it: act, do not announce.
2. Recon: exactly two bash calls (see Recon); scope decided there, once.
3. Checks: one command per requirement the diff does not already settle; related commands share one block.
4. Tests: once (see Tests).
5. Findings: one edit call to SPECS.md (see Findings).
6. State transition: tool_search → kanban_get → kanban_set_state, then the template line (see Fixes and state transition).

## Thinking and text (largest measured waste)
- Budget: at most 2 thinking blocks, ~300 chars, target 0-1. A thinking block reads the last tool result and names the next command, in one or two lines. Hard boundaries: none before block 1, none before tool_search.
- Never in thinking: restate the Shape, walk the Specs point by point, map requirement→command, quote spec or diff code, trace data flow, races, counters, or import chains, compose findings text, narrate a result twice, re-read a clause, hand-compute values or bounds. Run the command, then reason from its output.
- A doubt a command answers → run that command now, no hand-traced resolution. A doubt no command answers (spec wording, rule scope) → decide once from the requirement's stated intent, apply Materiality, move on. One run spent a whole thinking block re-reading one clause and recomputing memory bounds: the answer was one findings line.
- Text between recon and the findings edit: only one-line command lead-ins. No command follows → go straight to the findings edit. The verdict and spec walk exist only in the findings edit's newText.
- A settled check never reopens: output in context is evidence, in a fresh pass or a re-review.

## Re-reviews
- Review bullets in Notes → a second pass, a normal cycle: one command per prior claim. Holds → one line "re-review at <sha>", no fixes. Fails → findings in Notes. Never deliberate fresh-vs-continued state or evidence staleness.

## Recon (exactly two bash calls)
- Call 1: `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`. The `-C` reads the main checkout, the worktree sits on the task branch, so no root-vs-worktree question exists.
- Call 2: `git diff <name-from-base=...>...HEAD`, a mechanical substitution of the printed name, even when it looks like `main`: branches stack, and a branch typed from memory reviews the wrong base.
- Harness cuts the diff → `git diff <base>...HEAD -- <file>` per cut file. Never re-run the identical command.
- Commit scope, decided once: Notes name the implemented commit(s) → one `git show <sha>` each. Notes name none → the range diff. One commit in a one-commit range → the range diff, never deliberate the equivalence.
- Scope is the spec requirements plus the suites the diff touches. No what-if traces, no web or project-memory search. Live checks (fixture daemon, Playwright) are the live-tester's job, a prior live check in Notes records as a pass. An unrun full `pnpm test` is never a finding. A touched file with no Coverage-map area → say so once in the findings edit, skip.

## Checks
- One requirement, one command, one recorded pass/fail. A requirement the diff settles needs no command: record the pass in the findings edit. Note and file disagree → the file wins, recorded once.
- One locating grep per symbol set: its line numbers pick the read offsets. A spec point ends at one read of the producing site, surrounding call sites answer coverage. Clean at producing site and importer → settled, no caller or import-chain traces (see Facts that bite).
- Removed-consumer neutrality: the diff removes a symbol's only consumer → one grep for remaining consumers proves a co-located change behavior-neutral. Never re-derive UI reachability or dig history.
- Consumer-class defaults (`t.agents || []`, `t.body || ""`): one grep of the consuming functions, batched with neighboring checks.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. Anything smaller is one findings line, never a blocked merge or a fix.

## Tests
- Suite list, decided once: the union of Coverage-map entries for touched files and the suites the SPECS verification section names. Sources disagree → run the union, never deliberate.
- One command, once: `node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`. exit=0 plus the pass line settles the run: no re-grep for the pass phrase, no assert audit.
- Failure triage: exit 1 → one re-run of that suite, nothing in between. exit 0 → environmental flake, one findings line, next suite. Second failure → one read of the failing assertion. A failure outside the diff → pre-existing, next suite. Never read test sources or cycle hypotheses before the re-run. orchestrator mirror-commit smokes flake under load: a clean re-run closes it.
- A smoke-style `part X` console section in the diff → one `grep -n "part X" /tmp/s.log` after the run. Part names come from the diff. An off count gets one corrective grep, then the next suite.
- Policy: fix → a test for the bug, feature → tests for the new behavior, refactor → tests pass, trivial → exempt. A diff that edits a test → one grep of tests/ for the old assertion.
- Long suites (orchestrator, webui) spawn real daemons: one at a time, allow 10 min. Never pipe a suite to `tail`. kanban.test.ts concurrency tests, when the diff touches createTask or allocation: run 3+ times.

## Coverage map (decide once from the diff)
- src/efficiency-analysis.ts, src/analysis-run.ts → tests/efficiency-analysis.test.ts, plus tests/orchestrator.test.ts (part AT2 exercises the real analysis hook).
- src/tools.ts → tests/mcp.test.ts plus tests/extension.test.ts. src/mcp.ts → tests/mcp.test.ts.
- src/orchestrator/*, src/pid.ts → tests/orchestrator.test.ts. Spawn and pipeline context paths → tests/context-symlinks.test.ts.
- src/webui/*, src/kanban.ts, src/hub.ts → tests/webui.test.ts.
- agents/*.md, skills/se-llm-team/SKILL.md → tests/plugin.test.ts, the only suite.
- tests/*.ts → the touched suite.

## Findings (one edit call to cwd SPECS.md, appended to # Notes)
- One edit call, edits[] may carry several disjoint changes: the Open-questions deletion and the Notes append in the same call. Never edit the task body, another task's file, or AGENTS.*.md.
- The spec-by-spec verdict is written exactly once, in this edit's newText, from recorded results and evidence in context. Never state it in text or thinking first.
- Classification, no deliberation: a Notes caveat or a test gap stays a caveat line, only a genuine user question stays open. Open questions, applied mechanically: specs already answer it → delete in the findings edit, never move to Notes. The answer changes direction → finding in Notes. Empty section → delete the header.

## Fixes and state transition (always last)
- Cosmetic defect in the diff: one look, one edit, one commit, the sha in the findings line. The verdict does not change.
- State after kanban_get: pass → to-merge, also after a reviewer fix commit. to-review only for a verdict-changing defect you did not fix. A task parked per its own specs (no runnable precondition) → backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts). to-do re-spawns a developer at once.
1. tool_search("kanban") loads the MCP tools.
2. kanban_get({}): the spawn prompt mandates the re-read, abort when the state no longer matches the start.
3. kanban_set_state({ state }) is the run's last action, nothing follows it.
- Final text is exactly: `Moved #<nn> to <state>.` Nothing else, the findings edit carries the recap.

## Files
- read tool, one file per call, offset/limit for excerpts. Never sed, cat, or awk a file into bash output: a malformed range prints nothing and fails silently.
- cwd SPECS.md is a symlink through the board to the task file in the main checkout. Read and edit through it, never inspect the link chain. Reading the task body or other .kanban files in the main checkout is allowed and expected.
- .kanban files are untracked in the worktree: git diff and git log say nothing about them, grep the worktree directly. Git history answers no code question: the diff plus one producing-site read is the whole evidence.

## Facts that bite
- Split modules keep one-line re-export shims (src/webui.ts → ./webui/index.ts, src/orchestrator.ts → ./orchestrator/index.ts). A shim grep miss is the whole answer, never read the shim or trace the chain.
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep, a bare clone has no node_modules). tests/extension.test.ts compiles them with real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- commitKanban (src/orchestrator/board.ts) never stages the index, so a pathspec-less commit elsewhere cannot fold board content into a mirror commit. A "what rides this commit?" doubt → one grep of the committing function.
- Never pass extracted code through nested shell quoting: write it to a temp file, run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete, and compare runtime exports with a name + `String()` diff.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES holds only doing, reviewing, live-testing, merging, the !working path clears stale files and never moves a task. poll(root, stallMinutes, now, backlogIdleMinutes) takes injectable windows, a dead pid like "999999999" reads dead. A merging fixture writes .pids/merger.slug, or the task requeues to to-merge. The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file, a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` and returns the role capture. compactFinishedLogs must survive unresolvable entries, an unguarded read kills the daemon loop. Poll changes need a poll-driven self-advanced check (AT3 shape).
- Merge flow: the orchestrator rebases the task branch onto the base at merge time, then ff-merges, one rebase per sweep in a serialized lane. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours. One read of the rebase block in pipeline.ts answers ordering and Merger coverage, no spawn.ts trace, no rebase --continue speculation.
