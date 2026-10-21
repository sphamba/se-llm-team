# developer: role guidance

Durable method for the developer role. The spawn prompt owns the numbered steps. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Put task findings in `# Notes`. Report durable method findings in `# Notes`, never in this file or `AGENTS.md`.

## Contract

- Read `SPECS.md` once, fully, and keep it. `# Specs` and `# Acceptance` are the contract; `# Context` is background. The Specs beat this file and the spawn prompt. Copy a Specs value verbatim into the code and the pins. Decide each open choice once, before the first edit. Change only what the Specs and Acceptance require. Update a comment that the change makes false in place, keep its task tag, and do not add a second comment. Work in the worktree and never change task states or edit the board.
- A verification-only task changes no source. Its deliverable is the probe result plus one `# Notes` block. Do not look for a code change to make, and do not fix a blocker's contract.
- When two Specs or Acceptance lines cannot both hold, stop. Prove it with the smallest probe, write one `# Notes` line that names both lines and the file that owns the conflict, and end the run. Do not re-derive it later and do not move it to `# Open questions`.
- Never run `pnpm test`, even when `# Acceptance` names it. It is a shell loop over every suite and it takes minutes. Run the suites the Specs name and write one `# Notes` line that the full suite is the live tester's gate.

## Orientation

- Your worktree keeps the base it was created with, so it can predate a blocker that merged later. Compare the two shas with separate calls: `git rev-parse --short HEAD` and `git rev-parse --short main`. `--short` takes one revision only, so `git rev-parse --short HEAD main` dies with `fatal: Needed a single revision`. On a mismatch run `git merge --ff-only main`, and nothing else. Never inspect other branches, merge bases, or `git log --all`.
- Budget 4 tool calls from the Specs read to the first edit: one `read` of the file you change, one `read` of the suite that pins it, one bash that greps the anchors (the helper source, the CSS neighbour, the `PAGE` interpolation point). At the budget, stop and write the smallest form that satisfies the Specs. `read` a whole file with a generous `limit`, and use `sed -n 'A,Bp'` only for a Specs-cited range. Never read a range twice: the edit anchor is in output you already hold. Never `cat` a whole file, and never run `pwd` or `git status`. `cd` only for the repo root or the board.
- Cap the design pass at one thought per branch point: if you reach the same answer twice, stop thinking and act. For a test harness, stub, fixture, daemon, or spawn, copy the idiom from the nearest existing test that already does that job; do not enumerate alternatives for a mechanism the repo has. A probe is only for a value the Specs do not give: one `node -e`, print every value, copy the output. If a probe and the Specs disagree, the Specs win.
- Hand a web question or a wide sweep to one subagent. Do not spawn a subagent for a small, local change.
- Repo map: `src/orchestrator/pipeline.ts` (sweeps, caps, promotion, `doneCleanup`), `liveness.ts` (`poll()`, which also calls `promoteBacklog`), `src/kanban.ts` (task files, worktree naming, `PRIORITY_RANK`), `src/tools.ts` (registration), `spawn.ts` (prompt render, spawn log), `main.ts` (watch, timers), and `src/webui/{logpane,payload,page,board}.ts` (log render, log window byte arithmetic, `PAGE` template, cards). Tests import `../../src/*.ts` and `../helpers.ts`, with the repo root at `join(HERE, "../..")`. `tests/helpers.ts` exports `fixture()` (a git repo in a temp dir) and `roleStub`. `PAGE` is one template literal, so a function interpolated into it must be self-contained: module constants and regexes do not travel in, and a regex literal written inside loses a backslash. For a page test, reuse the file's extraction idiom (`function name(...) { ... }` plus `new Function`) and assert the returned value. A page change needs a daemon restart for a visual check.

## Edits

- Split a rewrite across small `edit` calls, about four hunks each. A call applies all hunks or none, so one bad hunk discards the whole payload. Never put a hunk in a batch when an earlier hunk in that same batch creates its anchor: the tool matches the original file, not the file after the earlier hunk. Never swap `oldText` and `newText`. When a hunk is rejected, cut the payload on the retry instead of resending the same shape, and narrow to one hunk per call until it lands.
- Anchor each hunk on the shortest unique line from your read. Whitespace must match exactly, and the indentation in the read output is already exact, so do not spend a call on `cat -A` to re-check tab depth. Write every comment complete on the first pass. After a success result every hunk landed: do not re-read the file and do not run `git diff` over it again.
- For a large insertion, append with `cat >> file <<'EOF'` and read the appended block back. When you add or remove a module-level symbol, grep the consumer import line in the same breath: `grep -n 'from "./<module>.ts"' src/`.

## Tests

- Run a suite as `node tests/<area>/<file>.test.ts`. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus the loose `tests/*.test.ts` and `index.test.ts`. There is no build and no typecheck, and `node --check` cannot parse TypeScript. The pin's subject decides the order, not the task-type prefix: a pin for behavior that does not exist yet runs red first, even under a `refactor:` name, and a pin for output that must stay unchanged passes before the edit. `complexity: trivial` skips red-first but still adds any pin the Specs name.
- Run exactly the suites `# Acceptance` names plus the suite file you edited, in one call. Capture the output in a variable and print `exit=`. Never pipe the `node` command, because `node f 2>&1 | tail` reports the pipe status and a failing suite shows `exit 0`. Never `grep -m` the output, because it cuts the assertion line. Read the first `AssertionError` line, implement to green, and do not re-run for the message. Green means done.

  ```
  fail=0
  for f in tests/a.test.ts tests/b.test.ts; do
    out=$(node "$f" 2>&1); c=$?
    printf '%s exit=%s\n' "$f" "$c"
    if [ $c -ne 0 ]; then printf '%s\n' "$out" | tail -n 25; fail=1; fi
  done
  exit $fail
  ```

- A pin exists or it does not: `grep -rnF '<exact string>' tests/` answers it, and empty output is final. Do not widen to `src/` or read a suite to learn what it asserts. No pin and none named: no test edit. A shared literal ripples into every exact-output assert: count the sites with `grep -rn '<literal>' tests/ | wc -l`, replace all in one `perl -pi -e` pass, then count the new literal and compare.
- There is no DOM library. Tests hand-roll element stubs. Extend the stub in the file you touch and give it every property the code path reads: `tagName`, `style`, `innerHTML`, `appendChild`, `children`, and both sibling getters. Do not add a dependency.

## Shell traps

- Chain recon reads with `;`, not `&&`, or put the step that can fail last. One failing probe at the head of an `&&` chain throws away every read behind it and costs a second identical call. A bare `grep` with no match exits 1 and fails the whole call, so end a recon call with `; true`, and grep the bare symbol name, not a guessed declaration form: `grep -n 'export const fixture'` misses `export function fixture`.
- One argv over 131072 bytes fails with E2BIG. `ls -R` skips hidden directories, so use `find`, and `find` does not follow a symlinked directory, so add a trailing slash. Escape a literal dot in `grep` (`\.`), or it matches unrelated text. Before you trust a count from a pipeline, run it on two known lines and look at the shape.

## Delivery and board

- Write `# Notes` before the commit, then make one commit so the notes and the code land together. Stage only source, test, and doc files, never the board or `AGENTS.md`. Refer to the commit by subject, not by SHA. End the same call with `git show --stat --oneline HEAD`, then stop. No source or test diff means no commit: the `# Notes` write is the deliverable. Do not read pipeline, liveness, or merger code to find permission for the end of the run, and do not make an empty commit.
- Resolve the board from the symlink: `board=$(dirname "$(readlink -f SPECS.md)")`. `.kanban`, `SPECS.md`, and `AGENTS.md` are gitignored symlinks into the main checkout. Append `# Notes` through `SPECS.md` with `cat >>`, under the existing `# Notes` heading; one `##` subheading there is enough, a second `#` heading is not. Never write `AGENTS.md`, and never stage board files. `.kanban/` is live shared state with concurrent writers, so read a file once and do not poll it. Fixture HOME is required for global state: `~/.pi`, `~/.config`, and `~/.gnupg` are read-only, delete with `delete process.env.X` and never `= undefined`, keep fixture daemons inert with long rescan and poll intervals and `--no-webui`, and use `git -c commit.gpgsign=false commit` in fixture repos. A new page or plugin test must also pass in the fixture HOME.
