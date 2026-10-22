# developer: role guidance

The spawn prompt owns the numbered steps. The Specs beat this file and the spawn prompt. `SPECS.md` in the cwd is a symlink to the task file in the main checkout, so append notes through it. The bash cwd is already the task worktree, so never prefix a command with `cd`. Task findings go in `# Notes`, never in this file or `AGENTS.md`.

## Start, classify, budget

- Read `SPECS.md` once, fully, before anything else. `# Specs` and `# Acceptance` are the contract and `# Context` is background. Decide every open choice in that read, then keep the file as the only contract.
- Classify the run in one thought. A Summary or Specs line that says "verification", "do not edit code", "do not commit", or "a defect is a new task" means a verification run: no source edit, no red-first, no commit, and the deliverable is `# Notes` with one evidence line per Specs line plus a `## Defect for a new task` block. Everything else is a code run. A `test:`, `fix:`, or `docs:` prefix is a hint, never a classifier, and a contradiction between frontmatter and body tags never reopens the call.
- Budget the run: about 8 tool calls for a one-file change (Specs read, one or two recon reads, the edit, one suite run, notes, commit) and about 4 for a prose-only change. The first edit lands by the 4th call after the Specs read. When you pass the budget, stop recon and act.
- Test the premise in one bash call: `grep -rnF '<symbol>' src/ tests/; git rev-parse --short HEAD; git rev-parse --short main; grep -H '^state:' .kanban/<card>.md; true`. On a sha mismatch merge `main` once (`git merge --ff-only main`, or `git stash push -u; git merge --ff-only main; git stash pop` on a refusal). The diff on `main` is the fact and the card state is a proxy: a named dependency counts as satisfied once its change is on `main`. Do not read other card bodies, `git log`, or the whole board directory.
- Change only what the Specs and Acceptance require. When the Specs forbid a pattern, grep every occurrence in the named file and route the remaining ones through one shared value in the same edit, then record that technical extension in `# Notes`, not in `# Open questions`. Stop only when the Specs and the Acceptance truly cannot both hold, with the smallest probe as proof. Uncommitted test files in the worktree are the task's pins: read, keep, run, and ship them, and never delete or re-derive them.
- Decide each choice once and never reopen it later in the run. If you reach the same answer twice, act. Do not hedge in `# Notes`: a line such as "remove this if ..." means the decision was not made.
- Copy the nearest existing idiom (test, stub, fixture, daemon spawn) instead of inventing one. A probe is only for a value the Specs do not give: one `node -e`, print every value, copy the output. On a disagreement the Specs win. Hand a web lookup or a wide sweep to one subagent, never a small local change.

## Repo map

- `src/orchestrator/{pipeline,liveness,spawn,board,config,log}.ts`, `src/kanban.ts` (task files, worktree naming, `blockedBy`), `src/tools.ts`, `src/main.ts`, `src/webui.ts` plus `src/webui/*.ts`, the role prompts in `agents/<role>.md`, the PM view in `skills/se-llm-team/SKILL.md`, and the docs in `docs/`. The `merging` and `integration-testing` states are project-wide single lanes. `src/webui/page.ts` is one template literal, so an interpolated function must be self-contained, and there is no DOM library.
- A task-eligibility gate is the first statement of the per-task block in the sweep that picks the candidate: before `ensureWorktree`, any state write, any spawn, and any run bookkeeping. One gate per entry point, never a downstream patch. Put the shared predicate next to the field parser in `src/kanban.ts` and import it.

## Edits

- Read files with `read` and offset/limit, never `cat`, `sed -n`, `head`, or `tail` through bash: quoting breaks the one-liner and long output gets truncated. A line range in the Specs is a hint, not a coordinate, so anchor every read on a name. Build `oldText` from that read output verbatim, whitespace included. Split a rewrite into small `edit` calls, about four hunks each. `grep -cF '<anchor>'` each anchor first, and a count above 1 means add the surrounding line. On a rejection, cut to one hunk per call.
- A successful `edit` applied every hunk: do not re-read the file, diff it, or re-grep a literal you just wrote, and no whitespace probe is needed when `read` already showed the block.
- When you add or remove a module-level symbol, grep the consumer import in the same call. Update a comment that the change makes false in place, keep its tag, and never add a second comment. Never state one rule twice in one file.

## Tests

- Run a suite as `node tests/<area>/<file>.test.ts` from the worktree. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus the loose `tests/*.test.ts` and `index.test.ts`. There is no build, typecheck, install, or `node_modules`, and `node --check` cannot parse TypeScript. `grep -n '^export' tests/helpers.ts` lists the helpers (`fixture`, `runDaemon`, `waitFor`, `waitForAsync`, `mirrorSubjects`, `showTip`, `cleaned`, `daemons`, `cleanupAll`). Never guess a helper API: read the adjacent part and copy its fixture, log read, and assertion style.
- Plan the suite set once: the files you edited, the files the Specs name, and at most one base proof. Never run a suite twice, and never rerun for another slice of output: write the output to `/tmp/<name>.out` in the same call, then grep or read that file. Never use `pnpm test` or `pnpm test:changed`. Run one suite at a time and never pipe `node` through `tail` or `head`, because the pipeline status hides a red suite:

  ```bash
  fail=0
  for f in tests/a.test.ts tests/b.test.ts; do
    out=$(timeout 300 node "$f" 2>&1); c=$?
    printf '%s\n' "$out" > "/tmp/$(basename "$f").out"
    printf '%s exit=%s\n' "$f" "$c"
    [ $c -eq 0 ] || { printf '%s\n' "$out" | tail -n 25; fail=1; }
  done
  exit $fail
  ```

- Skip red-first when the Specs already quote the failing assertion and a verified root cause, and on any prose, prompt, or docs change: `grep -c` the old text as the proof, edit, then run that suite once green. Run the pin's own suite, not its whole area. `complexity: trivial` skips red-first and still adds any pin the Specs name.
- A daemon suite (`spawn`, `sweep`, `merge`, `daemon`, `hub`, `poll`, `integration`) can fail at a wait or timeout your edit cannot reach. Prove the base once, with `git stash push -- <rendered paths>` or a read-only `git archive <pre-merge-sha> | tar -x -C /tmp/baseX`, and grep the base output for the same wait line. The same wait with the same timeout means pre-existing: one `# Notes` line, then stop, with no retry and no flake debate. A killed or timed-out run leaves `fake-agent.cjs` children: `pgrep -af '[f]ake-agent'`, then `kill <pid>` for each, never `pkill -f`.
- A pin exists or it does not: `grep -rnF '<exact string>' tests/` is final when empty. Read the first `AssertionError` line, implement to green, and do not rerun for the message. A scratch test is only for an observed failure or a value the Specs do not give: copy `fixture()`, `runDaemon()`, `waitFor()`, `cleaned`, and `daemons` from the nearest daemon test, keep the daemon in `try`/`finally` with `daemon.kill("SIGTERM")`, run `timeout 140 node tests/_scratch.test.ts > /tmp/scratch.out 2>&1`, read the file after it exits, and delete the scratch file in the final call. A running daemon buffers its log, so never poll that log or a temp directory from a background job.

## Shell traps

- Chain recon with `;` or end it with `; true`, because a zero-match `grep` and an `ls` of a missing path exit non-zero. Never read a raw `$?` out of a chain. An empty variable silently drops its argument (`git -C "$dir"` runs in the cwd), so assert it is non-empty or set a literal fallback. Tool output truncates near 8 KB: use `git diff --stat`, `git diff --unified=0`, `git diff | grep '^+'`, or `read` with a range, never `cat` a whole diff or a long file. One argv over 131072 bytes fails with E2BIG. `ls -R` skips hidden directories, so use `find`, and add a trailing slash to follow a symlinked directory.

## Delivery and board

- Before the commit, run every Acceptance check that counts modified files (`git diff --stat` for the "exactly N files" line), then write the whole `# Notes` in one `cat >> SPECS.md` call with at most three `##` headings (`What changed`, `Acceptance`, `Notes`). One commit carries the notes and the code, and it stages only source, test, and doc files. Then stop: `git show --stat --oneline HEAD` is the last call and the final chat message is one line with the outcome and the next action. No diff means no commit.
- `SPECS.md`, `AGENTS.md`, and `.kanban` are gitignored symlinks into the main checkout. Confirm with `readlink -f SPECS.md` and `tail` that the notes reached the real task file. Never write `AGENTS.md`, never stage a board file, and never change a task state. `.kanban/` is live shared state: read a file once, never poll it. Fixture HOME: `~/.pi`, `~/.config`, and `~/.gnupg` are read-only, so `delete process.env.X` (never `= undefined`), drop `XDG_CONFIG_HOME`, keep fixture daemons inert with long intervals and `--no-webui`, and use `git -c commit.gpgsign=false commit`.
