# developer: role guidance

Durable method for the developer role. The spawn prompt owns the numbered steps, the task-type test policy, and the commit rule. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Put task findings in `# Notes`. Report durable method findings in `# Notes`, never in this file or `AGENTS.md`.

## Contract

- Read `SPECS.md` once, fully, and keep it. `# Specs` and `# Acceptance` are the contract. `# Context` is background. The Specs beat this file and the spawn prompt.
- A value the Specs give is given: copy it verbatim into the code and the pins. A formula or table in the Specs beats a hand-written example. If two Specs statements conflict, apply the tie-break once, pin the result, and write one `# Notes` line. Do not probe or re-derive to settle it, and do not move a settled value to `# Open questions`. A resolved assumption is a Notes line, not an Open question.
- Decide each open choice once, before the first edit. The Acceptance check is the judge. Change only what the Specs and Acceptance require. A comment the change makes false is part of the change: update it in place, keep its task tag, and do not add a second comment. Record an unfixed risk in one `# Notes` line. Work in the worktree and never change task states or edit the board.

## Orientation

- Skip the orientation call. The cwd is your worktree and the spawn names it, so `pwd`, `git status --short`, and `git log` change no decision. Check git only when you build the commit.
- Budget 6 tool calls from the first read to the first edit. A cosmetic or ordering change is usually one import plus a few lines, so longer recon costs more than the edit. At the budget, stop and write the smallest form that satisfies the Specs. Hand a web question or a wide sweep to one subagent.
- Read a whole file with `read` and a generous `limit`. Read a Specs-cited range with `sed -n 'A,Bp'`. Keep each `bash` read to at most two small ranges. Never `cat` a whole file. Grep all anchors in one call.
- Read the one function you change and the nearest test block that pins it. Do not read a whole suite. For a CSS rule pin, read the nearest CSS assertion block once and reuse its extraction helper. Do not grep for sibling assertions.
- Do no arithmetic in your head and do not predict a formatted string. A probe is only for a value the Specs do not give: one `node -e`, print every value, copy the output. If a probe and the Specs disagree, the Specs win. If two consecutive thoughts reach the same answer, stop thinking and edit.

## Tests

- Run a suite as `node tests/<area>/<file>.test.ts`. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus the loose `tests/*.test.ts` and `index.test.ts`. There is no build and no typecheck, and `node --check` cannot parse TypeScript. `node scripts/test-changed.mjs` maps changed files to suites. Never run `pnpm test`, which is the live tester's job. Run exactly the suites `# Acceptance` names plus the suite file you edited, and do not re-run a suite whose code did not change.
- For a fix or a feature, update the pin and run it red before the code change. For a refactor, make the pin pass before you touch the code. `complexity: trivial` skips red-first but still adds any pin the Specs name. The red run is one command that captures the output, prints `exit=`, and prints the first 20 lines of the failure:

  ```
  out=$(node tests/a.test.ts 2>&1); c=$?
  printf 'exit=%s\n' "$c"
  printf '%s\n' "$out" | head -n 20
  ```

  Never pipe the `node` command itself. `node f 2>&1 | tail -n 5` reports the pipe status, so the tool shows `exit 0` on a failing suite and drops the assertion message. `head` on a captured variable is safe. Read the first `AssertionError` or `Error` line, then implement to green. Do not re-run the suite to see the message.
- A pin exists or it does not: one `grep -rn "<exact string>" tests/` answers it, and empty output is final. Do not widen to `src/`, try near-miss numbers, or read a suite to learn what it asserts. No pin and none named: no test edit. A shared literal or attribute ripples into every exact-output assert: count the sites with `grep -rn '<literal>' tests/ | wc -l`, replace all in one `perl -pi -e` pass, then count the new literal and compare.
- There is no DOM library. Tests hand-roll element stubs. Extend the stub in the file you touch and give it every property the code path reads: `tagName`, `style`, `innerHTML`, `appendChild`, `children`, and both sibling getters. Do not add a dependency.

## Edits and delivery

- `edit` takes `{oldText, newText}` hunks. The hunks are independent, match the original file, and apply all or none. A success result means every hunk landed. A failed result applies nothing, so re-read only then. Anchor each hunk on the shortest unique line from your read. The test is the only audit: do not re-read the file or the diff after a successful edit, and do not audit a successful command twice.
- For a large insertion, append with `cat >> file <<'EOF'` and read the appended block back. When you add or remove a module-level symbol, grep the consumer import line in the same breath: `grep -n 'from "./<module>.ts"' src/`.
- One command runs the named suites and prints output only on failure:

  ```
  fail=0
  for f in tests/a.test.ts tests/b.test.ts; do
    out=$(node "$f" 2>&1); c=$?
    printf '%s exit=%s\n' "$f" "$c"
    if [ $c -ne 0 ]; then printf '%s\n' "$out" | tail -n 25; fail=1; fi
  done
  exit $fail
  ```

  Read `$?` immediately. Do not leave the shell at exit 1 from a bare `[ ... ]` test. `grep -c` exits 1 on zero matches.
- Write `# Notes` before the commit, then make one commit so the notes and the code land together. Stage only source and test files. Refer to the commit by subject, not by SHA. End the same call with `git show --stat --oneline HEAD`, then stop. Green means done: do not grep other suites, re-read the edited function, or hedge about untested consumers. A suite the Specs say needs no change is settled.

## Board, fixtures, and map

- Resolve the board from the symlink: `board=$(dirname "$(readlink -f SPECS.md)")`. `.kanban`, `SPECS.md`, and `AGENTS.md` are gitignored symlinks into the main checkout. Append `# Notes` through `SPECS.md` with `cat >>`, under the existing heading, never as a second heading. The write follows the symlink, so no board path is needed for notes. Never write `AGENTS.md` and never stage board files. `.kanban/` is live shared state with concurrent writers, so read a file once and do not poll it.
- Fixture HOME is required for global state. `~/.pi`, `~/.config`, and `~/.gnupg` are read-only. Delete with `delete process.env.X`, never `= undefined`. Keep fixture daemons inert with long rescan and poll intervals and `--no-webui`, and use `git -c commit.gpgsign=false commit` in fixture repos. A new page or plugin test must also pass in the fixture HOME.
- Repo map: `src/orchestrator/pipeline.ts` (sweeps, caps, promotion, `doneCleanup`), `liveness.ts` (`poll()`, which also calls `promoteBacklog`), `src/kanban.ts` (task files, worktree naming, `PRIORITY_RANK`), `src/tools.ts` (registration), `spawn.ts` (prompt render, spawn log), `main.ts` (watch, timers), and `src/webui/{logpane,payload,page,board}.ts` (log render, log window byte arithmetic, `PAGE` template, cards). Tests import `../../src/*.ts` and `../helpers.ts`, with the repo root at `join(HERE, "../..")`. `PAGE` is one template literal, so a function interpolated into it must be self-contained: module constants and regexes do not travel in, and a regex literal written inside loses a backslash. For a page test, reuse the file's extraction idiom (`function name(...) { ... }` plus `new Function`) and assert the returned value. A page change needs a daemon restart for a visual check.
- Shell traps: one argv over 131072 bytes fails with E2BIG. `ls -R` skips hidden directories, so use `find`, and `find` does not follow a symlinked directory, so add a trailing slash. A scratch probe that imports `../src` lives under `tests/` and is deleted after the probe. Escape a literal dot in `grep` (`\.`), or it matches unrelated text. Before you trust a count from a pipeline, run it on two known lines and look at the shape.
