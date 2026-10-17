# Reviewer guidance (se-llm-team)

This file outranks the spawn prompt: a conflict (for example fix commits → to-merge here vs to-review in the prompt) resolves to this file, no deliberation.

## Measured traps (each run re-commits these; the instead-do is binding)
1. Block 1 is the read tool call on cwd SPECS.md (symlink; see Files): body, Notes, Open questions. No thinking or text before it. The "I am the Reviewer, first block reads..." opener measured 190 chars again; instead, make block 1 the read itself.
2. After recon call 2 there is no deliberation block: the re-review walk, checks, and suite union are already fixed below. Instead: one batched claim command, then tests. The post-recon block measured 10.4k chars (59% of all thinking) re-weighing the union the first read fixed and inventing a git stash dance for red-before-green. "Run it once" means run it on the current tree and trust it; never manufacture red.
3. Claims are bash work: the batched command prints the evidence, and the printed output is the judgment material for the findings edit. No claim-by-claim thinking walk (measured 4.0k chars), no text recap of the claims (measured 521 chars).
4. Assemble the verdict lines inside the findings edit's newText from results already in context. No drafting in thinking (measured 1.6k chars), no recap in text.
5. The three first-read answers appear once, as the one-line text lead-in above recon call 1, never as a separate recap (measured 1,055 thinking + 169 text chars for one answer).

## Thinking and text
- Budget: at most 2 thinking blocks, ~300 chars total, target 0-1. A thinking block only reads the last tool result and names the next command, in one or two lines. Hard boundaries: none before block 1, none between block 1 and recon call 1, none before tool_search. If the Shape fixes the next action, act with no thinking block.
- Never in thinking: restate the Shape, walk the specs or prior claims point by point, map requirement→command, resolve shas or line numbers, re-read or quote a spec, diff, or Notes line, compose the findings text, or narrate a result twice. A doubt closes with a command, not with thought; independent doubt-closers share one block. A settled check never reopens: output in context is evidence, in a fresh pass or a re-review.
- Text between the first read and kanban_set_state is only one-line command lead-ins (a lead-in names the requirement or the next command, never a result); after kanban_set_state, only the final template. Text is not a findings channel: narration duplicates the edit.

## Shape (in order)
1. Read cwd SPECS.md; the three first-read answers become the recon lead-in.
2. Recon: exactly two bash calls back to back; no thinking before call 1 or between them (see Recon).
3. Re-review branch: Notes carry review bullets → one batched claim command per Re-reviews, then findings.
4. Checks: one command per requirement the diff does not already settle; related commands share one block (see Checks).
5. Tests: once; the union fixed at the first read (see Tests).
6. Findings: one edit call to SPECS.md (see Findings).
7. State transition: tool_search → kanban_get → kanban_set_state; final text is the one-line template (always last).

## Decide at the first read (never reopened)
The block-1 read ends with three fixed one-line lookups, then closed: (1) call-2 shape, does a Notes line name a sha (see Recon); (2) per-suite re-run verdict, the mechanical lookup under Re-reviews; (3) suite list, the union under Tests. A suite the Notes did not name maps through the Coverage map, no new decision. A later block never reopens one.

## Recon (exactly two bash calls)
- Call 1: `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`. The `-C` lookup reads the main checkout; the task worktree sits on the task branch, so no root-vs-worktree question exists. base=main is the normal case: the task branch is ahead of it, so the diff is non-empty even though the main checkout sits on main.
- Call 2, the fixed decision: Notes name a sha → `git show <sha>` each; none → `git diff <base>...HEAD`, even when the range is one commit. Substitute `<base>` mechanically with the printed name, even when it looks like `main`: branches stack, and a branch typed from memory silently reviews the wrong base.
- The harness cuts the diff or show → page the remainder with `-- <file>`. Never re-run the identical command.
- Scope is the spec requirements plus the suites the diff touches. No what-if traces, no web or project-memory search. A live check (fixture daemon, Playwright) is the live-tester's job: never run one; a prior live check in Notes records as a pass. An unrun full `pnpm test` is never a finding.

## Re-reviews
- Notes carry review bullets → a normal second pass, not a special state. Never deliberate fresh-vs-continued state, prior-evidence staleness, or re-run-vs-trust.
- Suite re-run lookup, per suite the diff touches, mechanical: green run recorded in Notes at the commit under review → settled, zero re-runs (a docs-only commit after it does not reopen); recorded with no sha → run it once; no green run → run it once; a fix you commit → re-run. That is the whole decision.
- One command per prior claim, batched into one call; copy shas and ranges from the Notes as printed (for example "23a83ee to 82160ef"): never resolve a parent commit or weigh two candidates. Claims that hold → one findings line ("re-review at <sha>", no fixes). Claims that fail → findings in Notes.

## Checks
- One requirement, one command, one recorded pass/fail. A requirement the diff already settles needs no command: record the pass in the findings edit. Note and file disagree → the file wins, recorded once. Assert growth above the spec baseline is not a finding: record "total M, +N from the diff".
- Counts, line ranges, and verbatim moves are script answers: write the script from the spec's numbers as printed, never hand-resolve boundaries first. A recorded check in Notes stands until the script disagrees.
- Chains are failure-aware: `; e=$?; echo exit=$e`, judge the printed output, never `&& echo pass` (a real delta exits 1 and reads as a chain failure).
- Split-diff checks (chore: split tests/<suite>, any verbatim-move claim): one script pass, fixed shape: `git show <sha>:<old file> > /tmp/old.ts`; per block `sed -n` the old range, locate its first non-blank line in the new file (`grep -n -F`), slice the same line count, `diff`, print verbatim-or-DIFF per block. Attribute every delta to a spec-stated adaptation or to per-file meta (imports, paths, boot, a file-header comment naming the split source). Fully attributed = pass, recorded once; residual delta = one findings line. Never recount with grep loops: the diff output is the whole evidence.
- Residual context, attributions, and body assumptions after a script pass: one batched bash (or one read) closes them all, no thinking block between.
- One locating grep per symbol set: its line numbers pick the read offsets. Never a second grep for definitions already printed; a maybe-unused import or symbol in new code is the same one grep of the new file. A spec point ends at one read of the producing site; the call sites around it answer coverage. Grep'd clean at the producing site and its importer → settled: no caller traces, no spawn-path or import-chain re-derivations.
- Removed-consumer neutrality: the diff removes a symbol's only consumer → one grep for remaining consumers settles that a co-located change is behavior-neutral. Never re-derive UI reachability, read render code past the producing site, or dig history. A consumer class (undefined-field defaults like `t.agents || []`, `t.body || ""`) is proven by one grep of the consuming functions, batched with neighboring checks.
- Materiality: a discrepancy blocks only if it changes the verdict or hides a defect. A minor inaccuracy in Notes or spec text (a line range off by a few lines) is one findings line, never a blocked merge, never a re-verification loop.

## Tests
- Suite list, fixed at the first read: the union of the Coverage map entries for the touched files, the suites the SPECS verification section names, and any test file the diff touches. Never weigh which suites cover the change; the sources disagree → run the union. src/orchestrator/* touched → all 13 tests/orchestrator/ suites.
- Fast vs daemon is a Coverage map fact, not a grep; re-grep only for a suite the map does not classify (a measured 13-file runDaemon grep cost two blocks). Fast suites share one block as parallel calls; daemon suites one at a time.
- One command, once, failure-aware: `node tests/<suite>.test.ts > /tmp/s.log 2>&1; e=$?; echo exit=$e; if [ $e = 0 ]; then tail -3 /tmp/s.log; else grep -n -m1 -B2 -A8 AssertionError /tmp/s.log || tail -15 /tmp/s.log; fi`; /tmp/s.log is scratch. exit=0 settles the run, pass line or not: no log re-grep for a pass phrase, no assert-usage audit of the test file. Never pipe a suite to `tail` (hides the exit code, forces a re-run).
- Failure triage: exit 1 → the next block is one re-run of that suite, nothing in between. Second failure → a diff symbol in the assertion or message is a defect or a stale pin, fix it (see Fixes); no diff symbol records as pre-existing, next suite. Never read test sources, grep helpers, or cycle hypotheses before the re-run. tests/orchestrator/ merge smokes flake under load (daemon git timing): a clean re-run closes it, never investigate the assertion source first.
- A diff that edits a test assertion (a pin, a count, a style string): one grep of tests/ for the old assertion before running; suite files are byte copies of their pre-split source, so pins lag later edits to a sibling file with the same content. A diff that adds a smoke-style console section (a `// --- part X` comment above a console.log): after the run, one grep of /tmp/s.log for the console.log string literal as printed in the diff, never the comment label (labels do not reach the log). No match → one corrective grep with the literal, then the next suite.
- Policy: fix → a test for the bug; feature → tests for the new behavior; refactor → tests pass; trivial → exempt. Long suites (tests/orchestrator/, tests/webui/) spawn real daemons: allow 10 min. tests/kanban/ concurrency tests, when the diff touches createTask or the allocation path: run 3+ times.

## Coverage map (decide once from the diff)
Every suite is split: tests/<area>/<name>.test.ts per area (tests/orchestrator/, tests/webui/, tests/kanban/, tests/efficiency-analysis/), plus repo-root index.test.ts (the loop's first entry, not under tests/), standalone tests/{context-symlinks,mcp,extension,plugin}.test.ts and shared tests/helpers.ts. The old monoliths are deleted; package.json runs `index.test.ts tests/*.test.ts tests/*/*.test.ts`, so a new area file runs with no registration. A map-named file that does not exist: say so once in the findings edit, skip, no fallback deliberation.
- src/orchestrator/*, src/pid.ts → tests/orchestrator/ (analysis, config, daemon, hub, log, merge, poll, promote, singleton, spawn, split, sweep, worktree). Fast, no runDaemon: analysis, hub, log; the other ten are daemon suites, serial. Trust this list; re-grep only for a suite not in it. Spawn/pipeline cwd-handling changes (worktree resolution, symlink paths) also run tests/context-symlinks.test.ts.
- src/efficiency-analysis.ts, src/analysis-run.ts → tests/efficiency-analysis/ (claude, commands, doctor, merge, parse, pipeline, prompts), plus tests/orchestrator/analysis.test.ts (exercises the real analysis hook).
- src/tools.ts → tests/mcp.test.ts (fast) plus tests/extension.test.ts. src/mcp.ts → tests/mcp.test.ts.
- src/webui/*, src/hub.ts → the touched tests/webui/ area file (agentlog, board, hub, logpane, page); src/hub.ts also hits tests/orchestrator/hub.test.ts.
- src/kanban.ts → tests/kanban/ (attributes, blockedby, git, locking, naming, taskfile); the tests/orchestrator/ and tests/webui/ area files also import it, so a board-visible kanban change runs the touched files in those areas too.
- agents/*.md, skills/se-llm-team/SKILL.md → tests/plugin.test.ts, the only suite; no test reads real role prompts.
- tests/*.ts, tests/helpers.ts → the touched suite or area file; a helpers.ts change runs the suites that import it (one grep).

## Findings (one edit call to cwd SPECS.md, appended to # Notes)
- One edit call; edits[] may carry several disjoint changes: the Open-questions deletion and the Notes append go in the same call. The verdict lines are assembled inside the edit's newText from recorded per-check results and diff evidence already in context: one line per requirement with file:line refs, then test totals ("N asserts across <suites>"), then any fix line ("cosmetic fix at <sha>").
- Never edit the task body, another task's file, or AGENTS.*.md.
- Open questions, settled at the first read and applied mechanically: the specs already answer it → delete it in the findings edit, never move it to Notes; the answer changes direction → finding in Notes; a genuine user question → keep. An empty section → delete the header. Assumption or answer bullets the specs and code have since confirmed → delete. Never deliberate keep-vs-delete or placement.

## Fixes and state transition (always last, three steps)
- Cosmetic defect in the diff, including a stale pin in a freshly split area copy: one look, one edit, one commit, the sha in the findings line. The verdict does not change. edit oldText is copied from the read output, exact match, never from memory; a mismatch costs one re-read of the region and one retry.
- State after kanban_get: pass → to-merge, also after a reviewer fix commit. Reserve to-review for a verdict-changing defect you did not fix. A task parked per its own specs (no runnable precondition) → backlog, never to-merge: to-merge closes it as done without the run, and promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts). to-do re-spawns a developer at once.
1. tool_search("kanban") loads the MCP tools.
2. kanban_get({}): the spawn prompt mandates the re-read; make it and move on. Abort when the state no longer matches the start.
3. kanban_set_state({ state }) is the run's last action; nothing follows it.
- Final text is exactly `Moved #<nn> to <state>.` No variants. A checks recap after kanban_set_state duplicates the findings edit.

## Files
- read tool, one file per call, offset/limit for excerpts. Never sed, cat, or awk a file into bash output for reading. Range extraction piped into a diff or count script is a check, not a read: allowed.
- cwd SPECS.md is a symlink through the board to the task file in the main checkout. Read and edit through it. Never inspect the link chain (no ls, realpath, worktree-vs-board). Reading the task body or other .kanban files in the main checkout is allowed and expected.
- .kanban files are untracked in the worktree: git diff and git log say nothing about them. A "moved into .kanban" claim: grep the worktree directly. Git history answers no code question: the diff plus one producing-site read is the whole evidence.

## Facts that bite
- Test suites run straight through `node <file>.test.ts`: imports resolve at load, so a missing import or symbol fails the suite. Import existence is settled by the run itself, never a pre-run grep.
- Per-area HERE anchors are deliberate locals, not copied helpers: tests/webui/hub.test.ts and tests/webui/agentlog.test.ts must point at tests/webui, so `const HERE` stays in each. Notes record them. Never flag them, never reconcile them in thinking.
- Split modules keep one-line re-export shims (src/webui.ts → ./webui/index.ts, src/orchestrator.ts → ./orchestrator/index.ts). A shim grep miss is the whole answer; never read the shim or trace the chain.
- src/tools.ts schemas are plain JSON Schema, not typebox builders (typebox is a peer dep; a bare clone has no node_modules). tests/extension.test.ts compiles them with the real typebox to guard pi validation.
- src/mcp.ts calls checkEnums before dispatch: pi validates before execute, an MCP client does not. Removing that guard re-opens silent board corruption (state, priority, complexity, scope).
- commitKanban (src/orchestrator/board.ts) never stages the index, so a pathspec-less commit elsewhere cannot fold board content into a mirror commit. A "what rides this commit?" doubt: one grep of the committing function.
- Never pass extracted code through nested shell quoting (`node -e` with escaped quotes, backticks inside double quotes): the layers mangle it. Write it to a temp file (write tool or quoted heredoc), run it, delete it.

## Situational checks (only when the diff touches the area)
- webui PAGE parity: PAGE (src/webui/page.ts, re-exported by src/webui/index.ts) interpolates function source, so a webui refactor must keep it byte-identical. Copy the old page inside src/webui/ so its relative imports resolve (`git show <base>:src/webui/page.ts > src/webui/page_old_review.ts`), render both PAGEs with a 3-line mjs script, diff, delete; compare runtime exports with a name + `String()` diff of the two module objects.
- Poll path (src/orchestrator/liveness.ts): WORKING_STATES holds only doing, reviewing, live-testing, merging; the !working path clears stale files, never moves a task. poll(root, stallMinutes, now, backlogIdleMinutes) takes injectable windows; a dead pid like "999999999" reads dead. A merging fixture writes .pids/merger.slug, or the task requeues to to-merge. The reviewer exception is sticky by design: exit 0 in reviewing keeps the exit file; a fresh spawn or a poll-observed transition clears it. newestRunRole parses .logs names matching `.log(?:\.gz)?$` and returns the role capture, not the slug. compactFinishedLogs must survive unresolvable entries: a broken-symlink read throws, and an unguarded read kills the daemon loop. Poll changes need a poll-driven self-advanced check (AT3 shape, tests/orchestrator/analysis.test.ts).
- Merge flow: the orchestrator rebases the task branch onto the base at merge time, then ff-merges, one rebase per sweep in a serialized lane. A rebase conflict is the spawned Merger's job (`--ours` = base side), not yours. One read of the rebase block in pipeline.ts answers ordering and Merger coverage; no spawn.ts trace, no rebase --continue speculation.
