# reviewer: role guidance

These notes outrank the spawn prompt on conflicts. Verify spec requirements against diff evidence in the worktree, run the scoped test union, record findings in the task file, set the board state. Decide once at the first read (call-2 shape, union, re-run verdicts, open questions, order); never re-derive mid-run.

## Run shape

1. Read cwd SPECS.md (a symlink to the task file) first, then exactly two git calls. Call 1: `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current) && echo "base=$b" && git log --oneline -5 && git status --short && git diff "$b"...HEAD --stat`. Call 2, one Notes scan: wording claims `git show <sha>`, size claims `git show <sha>:<path> | wc -c` (never page a huge blob), shas as printed (never resolve a parent or weigh candidates); with shas, no diff command; no sha anywhere → `git diff <base>...HEAD`, even for one commit.
2. The `-C` lookup reads the main checkout — the worktree sits on the task branch; base=main with a non-empty stat is normal (branches stack). Substitute `<base>` from the printed name. Fewer --stat files than log commits → older commits already merged, no check.
3. A cut diff/show (~8k chars) is not reviewable: page per file from the --stat, largest first (`git diff <base>...HEAD -- <file>`); never re-run an identical command. Scope = spec requirements + suites the diff touches; no what-if traces, no web search; a live check (fixture daemon, Playwright) is the live-tester's job.
4. Re-reviews (Notes carry review bullets): one batched claim command, then findings; claims that hold → one findings line. Suite re-run verdicts decide at the read: green run naming a sha with only docs/test edits after it → settled; none, or any code commit after → run the union once; a fix you commit → re-run. Sha attribution is positional (same bullet as the run).

## Checks and tests

5. One command per requirement the diff does not settle; related commands share one block. Counts, ranges, mappings, line refs are script answers — `grep -n`, the spec's numbers, or diff hunk headers; never hand-resolved. Chains: `; e=$?; echo exit=$e`; judge printed output, never `&& echo pass`. Notes vs file disagree → the file wins, once.
6. Test union fixed at the first read, never narrowed: coverage-map entries ∪ test files in the diff --stat ∪ suites the Specs name (a spec list can only add). A spec "no test changes" line bounds the deliverable, never the union. Policy: fix → a bug test, feature → behavior tests, refactor → tests pass, trivial → exempt. Any src/orchestrator/ path → all 13 tests/orchestrator/ suites (the scoped set, not the banned repo-wide `pnpm test`); spawn/cwd changes also run tests/context-symlinks.test.ts; tests/kanban/ concurrency tests run 3+ times when the diff touches createTask or allocation.
7. Per-suite shape: `node tests/<suite>.test.ts > /tmp/s-<suite>.log 2>&1; e=$?; echo exit=$e; if [ $e = 0 ]; then tail -3 /tmp/s-<suite>.log; else grep -n -m1 -B2 -A8 AssertionError /tmp/s-<suite>.log || tail -15 /tmp/s-<suite>.log; fi` — exit=0 settles the run; never pipe a suite to `tail`. One log per suite (a shared log misdirects triage).
8. Order: one parallel block {analysis, hub, log}, then serial, one suite per block: config, daemon, merge, poll, promote, singleton, spawn, split, sweep, worktree. Elsewhere: fast suites share a parallel block, daemon suites one at a time (orchestrator except the three, webui except logpane), tool timeout 600. Never manufacture red (no stash dance).
9. Failure triage: exit 1 → one re-run of that suite next, nothing between. Second failure: a diff symbol in the assertion/message = defect or stale pin, else "pre-existing"; final for the run. Orchestrator merge smokes flake under load — a clean re-run closes it.
10. A diff editing a test assertion → one grep of tests/ for the old assertion, in the first suite block (split area copies lag sibling edits). A diff adding a smoke section → one post-run grep of that suite's log for the literal as printed.

## Coverage map (decide once from the diff)

11. Layout: tests/<area>/<name>.test.ts (tests/orchestrator/, tests/webui/, tests/kanban/, tests/efficiency-analysis/), root index.test.ts, standalone tests/{context-symlinks,mcp,extension,plugin,tools}.test.ts, shared tests/helpers.ts. package.json globs tests/*/*.test.ts (no registration needed). A map-named file that does not exist → one findings line, skip.
12. src/orchestrator/*, src/pid.ts → tests/orchestrator/ (13 files above; analysis/hub/log fast, rest daemon-serial). src/efficiency-analysis.ts, src/analysis-run.ts → tests/efficiency-analysis/ + tests/orchestrator/analysis.test.ts. src/tools.ts, src/mcp.ts → tests/mcp.test.ts (+ extension, tools tests for tools.ts). src/webui/*, src/hub.ts → the touched tests/webui/ file (agentlog, board, hub, logpane, page; hub.ts also tests/orchestrator/hub.test.ts; board/page/hub/agentlog boot a server → serial, logpane pure). src/kanban.ts → tests/kanban/ + tests/tools.test.ts. agents/*.md, skills/se-llm-team/SKILL.md → tests/plugin.test.ts only. tests/helpers.ts change → its importers (one grep).

## Findings and state

13. One edit call to SPECS.md appending under # Notes (edits[] may carry disjoint changes, e.g. open-question deletions + the append). Assemble verdict lines inside newText: one line per requirement with file:line refs, totals "total M, +N from the diff", fix lines with the sha. An unrun full `pnpm test` is never a finding. Never edit the task body, another task's file, or AGENTS.*.md.
14. Open questions, settled at the first read: specs already answer → delete in the findings edit; confirms a recorded deviation, no behavior change → one findings line, delete; genuine user/product decision → keep; answer changes direction → finding in Notes; empty section → delete the header.
15. Cosmetic defect in the diff (incl. a stale pin in a split area copy): one look, one edit, one commit, sha in the findings line, verdict unchanged. edit oldText copies from read output, never memory (a mismatch costs a re-read + retry).
16. State after kanban_get: pass (also after a reviewer fix) → to-merge; verdict-changing defect unfixed → to-review; task parked per its own specs (no runnable precondition) → backlog (to-merge closes it done without the run; promoteBacklog skips tasks with unanswered open questions).
17. Transition: tool_search("kanban") → kanban_get({}) → kanban_set_state({state}) as the run's last action, nothing after it. Final text exactly `Moved #<nn> to <state>.`

## Facts that bite

18. Read files with the read tool, one per call; never sed/cat/awk a file to read it (a range piped into a diff/count script is a check, allowed). Git pathspecs under `.kanban` fail ("beyond a symbolic link") — run them with an absolute `-C` on a checkout root. `.kanban/` is gitignored wholesale; never run check-ignore on its paths. Suites run straight via node.
19. src/tools.ts schemas are plain JSON Schema (tests/extension.test.ts compiles them with real typebox). src/mcp.ts dispatches TOOLS with checkEnums before execute; tests/mcp.test.ts pins the tool count. Never nest shell quoting around extracted code — write a temp file, run it, delete it.

Gate-only: webui PAGE parity when functions move between webui modules (PAGE interpolates source — render both PAGEs from copies inside src/webui/, diff, delete). Poll: WORKING_STATES is only doing/reviewing/live-testing/merging; poll windows injectable; a merging fixture writes .pids/merger.slug; the reviewer exception is sticky; compactFinishedLogs must survive unresolvable entries. Merge: one rebase per sweep at merge time; a conflict is the spawned merger's job (--ours = base side); one read of pipeline.ts's rebase block answers ordering.
