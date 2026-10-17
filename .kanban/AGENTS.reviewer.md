# Reviewer guidance (se-llm-team)

## Shape (in order)
1. Block 1: read cwd SPECS.md (symlink; see Files): body, Notes, Open questions. No thinking block before it, ever: act, do not announce. Decide the recon scope during this read.
2. Recon: exactly two bash calls back to back; no thinking block before call 1 or between them (see Recon); the scope is decided at the block-1 read, once, and never revisited.
3. Checks: one command per requirement the diff does not already settle; related commands share one block, one-line lead-in each (a lead-in names the requirement, never a result).
4. Tests: once; the suite list is the union named under Tests. A suite may share the last check's block; a test lead-in names only the suite.
5. Findings: one edit call to SPECS.md (see Findings).
6. State transition: tool_search → kanban_get → kanban_set_state; final text is the one-line template.

## Thinking and text (largest measured waste)
- Budget: at most 2 thinking blocks, ~300 chars total, target 0-1. Measured runs: 6, 9, 3, 9, 7, 5.
- Hard boundaries: no thinking before block 1, none between block 1 and recon call 1 (the scope decision lives in the read), none before tool_search. A thinking block only reads the last tool result and names the next command, in one or two lines. If the Shape fixes the next action, act with no thinking block.
- Never in thinking: restate the Shape or re-derive the role rules, walk the Specs point by point, map requirement→command, weigh suite selection (the Tests union rule answers it), resolve line numbers, ranges, offsets, or count deltas, confirm or validate what a command's output already shows, quote spec or diff code, trace data flow, races, counters, or import chains, compose the findings text, or narrate a result twice.
- A doubt never closes in thinking or text: the next block holds the command that answers it, executed now, and independent doubt-closers share that one batched block (see Checks). No hand-traced resolutions, hand-computed values, or re-derived answers.
- A settled check never reopens: output in context is evidence, in a fresh pass or a re-review.
- Text: between recon and the findings edit, only one-line command lead-ins; after kanban_set_state, only the final template.

## Re-reviews
- A task in reviewing with review bullets in Notes is a second pass: a normal cycle. Never deliberate fresh-vs-continued state or prior-evidence staleness; verify each prior claim with the usual one command per requirement.
- Claims that hold: one findings line ("re-review at <sha>", no fixes). Claims that fail: findings in Notes.

## Recon (exactly two bash calls)
- Call 1: `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`. The `-C` lookup reads the main checkout; the task worktree sits on the task branch, so no root-vs-worktree question exists.
- Call 2 is the scope command, decided at the block-1 read, never revisited, never a thinking block: Notes name commit(s) → `git show <sha>` each; Notes name none → `git diff <base>...HEAD`. One commit in a one-commit range → the range diff, full stop: never weigh show-vs-diff or range equivalence, the Notes read already answered it. Substitute `<name-from-base=...>` mechanically with the printed name, even when it looks like `main`: branches stack, and a branch typed from memory silently reviews the wrong base.
- The harness cuts the diff or show → page the remainder per cut file with `git diff <base>...HEAD -- <file>` or `git show <sha> -- <file>`. Never re-run the identical command.
- Scope is the spec requirements plus the suites the diff touches. No what-if traces, no web or project-memory search. A live check (fixture daemon, Playwright) is the live-tester's job: never run one; a prior live check in Notes records as a pass. An unrun full `pnpm test` is never a finding. No Coverage-map area for a touched file → say so once in the findings edit, skip.

## Checks
- One requirement, one command, one recorded pass/fail. A requirement the diff already settles needs no command: record the pass in the findings edit. Note and file disagree → the file wins, recorded once.
- Counts, line ranges, and verbatim moves are script answers, never thinking answers. A spec names a count, a range, or a verbatim claim → one temp script (or `grep -c`) prints the number or the diff, and that output is the only evidence. Write the script from the spec's numbers as printed: never hand-resolve true boundaries first (spec range vs hunk arithmetic); a few-line offset surfaces in the diff as attributed deltas, and materiality handles it. A count above the spec's baseline (assert growth) is not a finding: the diff attributes the delta (+N lines), record "total M, +N from the diff", never re-derive the arithmetic in thinking. A recorded check in Notes stands until the script disagrees.
- Split-diff checks (chore: split tests/<suite>, any verbatim-move claim): one script pass extracts the old range, diffs it against the new file, and counts assert lines on both sides. Then attribute every delta to a spec-stated adaptation (import paths, added assertions, moved fixture or setup lines). Fully attributed = pass, recorded once; residual delta = one findings line. Never recount with grep loops, never re-verify the move block by block: the diff output is the whole evidence, and a settled count never reopens.
- Residual delta context, attributions, and body assumptions after a script pass: one batched bash (or one read) closes them all, no thinking block between. Never spread them over inspect → think → read → think.
- One locating grep per symbol set: its line numbers pick the read offsets. Never a second grep for definitions already printed. A maybe-unused import or symbol in new code is the same one grep of the new file. A spec point ends at one read of the producing site; the call sites around it answer coverage. A symbol grep'd clean at its producing site and its importer is settled: no caller traces, no spawn-path or import-chain re-derivations (see Facts that bite).
- Removed-consumer neutrality: the diff removes a symbol's only consumer → one grep for remaining consumers settles that a co-located change to the symbol is behavior-neutral. Never re-derive UI reachability, read render code past the producing site, or dig history. A consumer class (undefined-field defaults like `t.agents || []`, `t.body || ""`) is proven by one grep of the consuming functions, batched with neighboring checks.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. A minor inaccuracy in Notes or spec text (a line range off by a few lines) is one findings line, never a blocked merge, never a re-verification loop.

## Tests
- Suite list, decided once: the union of the Coverage map entries for the touched files, the suites the SPECS verification section names, and any test file the diff itself touches. The union is mechanical; never weigh which suites cover the change. The sources disagree → run the union, never deliberate.
- One command, once: `node tests/<suite>.test.ts > /tmp/s.log 2>&1; echo exit=$?; tail -3 /tmp/s.log`; /tmp/s.log is scratch. exit=0 settles the run, pass line or not: no log re-grep for a pass phrase, no assert-usage audit of the test file.
- Failure triage: exit 1 → the next block is one re-run of that suite, nothing in between. exit 0 → environmental flake, one findings line, next suite. Second failure → one read of the failing assertion; a failure outside the diff (no diff symbol in the assertion or message) records as pre-existing, next suite. Never read test sources, grep helpers, or cycle hypotheses before the re-run.
- orchestrator.test.ts mirror-commit smokes flake under load (daemon git timing): a clean re-run closes it; never investigate the assertion source first.
- A diff that adds a smoke-style `part X` console section: close the check with one `grep -n "part X" /tmp/s.log` after the run. Part names come from the diff, never from memory or a task note; an off count gets one corrective grep, then the next suite, never a recount loop.
- Policy: fix → a test for the bug; feature → tests for the new behavior; refactor → tests pass; trivial → exempt. A diff that edits a test: one grep of tests/ for the old assertion.
- Long suites (orchestrator, webui) spawn real daemons: one at a time, allow 10 min. Never pipe a suite to `tail` (hides the exit code, forces a re-run). tests/kanban/ concurrency tests, when the diff touches createTask or the allocation path: run 3+ times.

## Coverage map (decide once from the diff)
The suite is mid-split: area dirs (tests/webui/, tests/kanban/, tests/efficiency-analysis/) sit next to the old monoliths (tests/webui.test.ts, tests/orchestrator.test.ts), which still run the same scenarios.
- src/efficiency-analysis.ts, src/analysis-run.ts → tests/efficiency-analysis/ (parse, pipeline, merge, prompts, doctor, claude, commands), plus tests/orchestrator.test.ts (part AT2 exercises the real analysis hook).
- src/tools.ts → tests/mcp.test.ts (fast) plus tests/extension.test.ts. src/mcp.ts → tests/mcp.test.ts.
- src/orchestrator/*, src/pid.ts → tests/orchestrator.test.ts; spawn and pipeline context paths → tests/context-symlinks.test.ts.
- src/webui/*, src/hub.ts → the tests/webui/ area file the diff's area names (board, hub, logpane, page, agentlog).
- src/kanban.ts → tests/kanban/ (attributes, blockedby, git, locking, naming, taskfile); the webui area files also import it, so a board-visible kanban change runs the touched tests/webui/ file too.
- agents/*.md, skills/se-llm-team/SKILL.md → tests/plugin.test.ts, the only suite; no test reads real role prompts.
- tests/*.ts → the touched suite or area file.

## Findings (one edit call to cwd SPECS.md, appended to # Notes)
- One edit call; edits[] may carry several disjoint changes: the Open-questions deletion and the Notes append go in the same call.
- The spec-by-spec verdict is written exactly once, in this edit's newText, assembled from recorded per-check results and diff evidence already in context. Drafting it in thinking or recapping results in text is the same duplication: never.
- Never edit the task body, another task's file, or AGENTS.*.md.
- Open questions, settled at the first read and applied mechanically in every later pass: the specs already answer it → delete it in the findings edit, never move it to Notes; the answer changes direction → finding in Notes; a genuine user question → keep. An empty section → delete the header. Assumption or answer bullets the specs and code have since confirmed are the same case: delete them in this edit; a "state the big assumptions" spec counts as answered once the findings line records the confirmation, so deleting the section un-ships nothing. Never deliberate keep-vs-delete or Open-questions-vs-Notes placement.

## Fixes and state transition (always last, three steps)
- Cosmetic defect in the diff: one look, one edit, one commit, the sha in the findings line. The verdict does not change.
- State after kanban_get: pass → to-merge, also after a reviewer fix commit. Reserve to-review for a verdict-changing defect you did not fix. A task parked per its own specs (no runnable precondition) → backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts). to-do re-spawns a developer at once.
1. tool_search("kanban") loads the MCP tools.
2. kanban_get({}): the spawn prompt mandates the re-read; make it and move on. Abort when the state no longer matches the start.
3. kanban_set_state({ state }) is the run's last action; nothing follows it.
- Final text is exactly: `Moved #<nn> to <state>.` A checks recap after kanban_set_state duplicates the findings edit verbatim; the spawn prompt asks for no summary.

## Files
- read tool, one file per call, offset/limit for excerpts. Never sed, cat, or awk a file into bash output for reading: use read; a malformed range prints nothing and fails silently. Range extraction piped into a diff or count script is a check, not a read: allowed.
- cwd SPECS.md is a symlink through the board to the task file in the main checkout. Read and edit through it. Never inspect the link chain (no ls, realpath, worktree-vs-board). Reading the task body or other .kanban files in the main checkout is allowed and expected.
- .kanban files are untracked in the worktree: git diff and git log say nothing about them. A "moved into .kanban" claim: grep the worktree directly. Git history answers no code question: the diff plus one producing-site read is the whole evidence.

## Facts that bite
- Split modules keep one-line re-export shims (src/webui.ts → ./webui/index.ts, src/orchestrator.ts → ./orchestrator/index.ts). A shim grep miss is the whole answer; never read the shim or trace the chain.
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- commitKanban (src/orchestrator/board.ts) never stages the index, so a pathspec-less commit elsewhere cannot fold board content into a mirror commit. A "what rides this commit?" doubt: one grep of the committing function.
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the layers mangle it. Write it to a temp file (write tool or quoted heredoc), run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete; compare runtime exports with a name + `String()` diff of the two module objects.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES holds only doing, reviewing, live-testing, merging; the !working path clears stale files, never moves a task. poll(root, stallMinutes, now, backlogIdleMinutes) takes injectable windows; a dead pid like "999999999" reads dead. A merging fixture writes .pids/merger.slug, or the task requeues to to-merge. The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file; a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` and returns the role capture, not the slug. compactFinishedLogs must survive unresolvable entries: a broken-symlink read throws, and an unguarded read kills the daemon loop. Poll changes need a poll-driven self-advanced check (AT3 shape).
- Merge flow: the orchestrator rebases the task branch onto the base at merge time, then ff-merges, one rebase per sweep in a serialized lane. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours. The rebase block in pipeline.ts shows the full order, and the Merger spawn sits after a hygiene pass in the same sweep. One read answers ordering and Merger coverage; no spawn.ts trace, no rebase --continue speculation.
