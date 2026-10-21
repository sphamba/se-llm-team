# developer: role guidance

Durable method for the developer role. The spawn prompt owns the numbered steps. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Put task findings in `# Notes`. Report durable method findings in `# Notes`, never in this file or `AGENTS.md`.

## Contract

- Read `SPECS.md` once, fully, and keep it. `# Specs` and `# Acceptance` are the contract. `# Context` is background. The Specs beat this file and the spawn prompt. Copy a Specs value verbatim into the code and the pins. A formula or table in the Specs beats a hand-written example. Decide each open choice once, before the first edit. The Acceptance check is the judge. Change only what the Specs and Acceptance require. Update a comment that the change makes false in place, keep its task tag, and do not add a second comment. Work in the worktree and never change task states or edit the board.
- A task that says verification only changes no source. Its deliverable is the probe result plus one `# Notes` block. Do not look for a code change to make, and do not fix a blocker's contract.
- When two Specs or Acceptance lines cannot both hold, stop. Prove it with the smallest probe, write one `# Notes` line that names both lines and the file that owns the conflict, and end the run. Do not re-derive it, do not re-open it later, and do not move it to `# Open questions`.
- Never run `pnpm test`, even when `# Acceptance` names it. Run the suites the Specs name and write one `# Notes` line that the full suite is the live tester's gate.

## Orientation

- Your worktree keeps the base it was created with, so it can predate a blocker that merged later. Check with one `git rev-parse --short HEAD main`. If the two differ, run `git merge --ff-only main` and nothing else. Never look at other branches, merge bases, `git log --all` or `git branch`. That check is the only git command before the commit.
- Budget 4 tool calls from the Specs read to the first edit: one `read` of the function you change, one `read` of the nearest test block that pins it, one bash that greps the anchors (the helper source, the CSS neighbour, the `PAGE` interpolation point). At the budget, stop and write the smallest form that satisfies the Specs. Never read a file range twice. The edit anchor is in the output you already have. `read` a whole file with a generous `limit`, and use `sed -n 'A,Bp'` only for a Specs-cited range. Never `cat` a whole file. Never run `pwd` or `git status`. `cd` only for the repo root or the board.
- Do not predict a formatted string and do not do arithmetic in your head. A probe is only for a value the Specs do not give: one `node -e`, print every value, copy the output. If a probe and the Specs disagree, the Specs win. Cap the design pass at one thought per branch point. If you reach the same answer twice, stop thinking and act.
- Hand a web question or a wide sweep to one subagent. Do not spawn a subagent for a small, local change.

## Tests

- Run a suite as `node tests/<area>/<file>.test.ts`. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus the loose `tests/*.test.ts` and `index.test.ts`. There is no build and no typecheck, and `node --check` cannot parse TypeScript. The pin's subject decides the order, not the task-type prefix. A pin for behavior that does not exist yet runs red first, even when the task is labeled `refactor:`. A pin for output that must stay unchanged passes before the edit. `complexity: trivial` skips red-first but still adds any pin the Specs name.
- Run exactly the suites `# Acceptance` names plus the suite file you edited. Capture the output in a variable, print `exit=`, and print `head -n 20` of a failure. Never pipe the `node` command: `node f 2>&1 | tail` reports the pipe status, so a failing suite shows `exit 0`. Never `grep -m` the output, because it cuts the assertion line. Read the first `AssertionError` line, implement to green, and do not re-run for the message. Green means done.

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

## Probes

- Check a "stays as it was" line with one `git diff <base> -- <file>` read of the function source. Never copy the old module next to it and run both: the copy is dead weight that you must delete again. A scratch probe lives under `tests/`, imports `../src`, prints one line per claim, and is deleted in the same run. Assert on the element you already hold, never on a search for a string you just formatted: a prefix that does not match the whole element returns -1.

## Edits and delivery

- `edit` takes `{oldText, newText}` hunks that match the original file and apply all or none. A success result means every hunk landed. Anchor each hunk on the shortest unique line from your read. Write every comment complete on the first pass. After a success, do not re-read the file or the diff.
- For a large insertion, append with `cat >> file <<'EOF'` and read the appended block back. When you add or remove a module-level symbol, grep the consumer import line in the same breath: `grep -n 'from "./<module>.ts"' src/`.
- Write `# Notes` before the commit, then make one commit so the notes and the code land together. Stage only source and test files, never the board or `AGENTS.md`. Refer to the commit by subject, not by SHA. End the same call with `git show --stat --oneline HEAD`, then stop. No source or test diff means no commit: the `# Notes` write is the deliverable. Do not read pipeline, liveness or merger code to find permission for the end of the run, and do not make an empty commit.

## Board, fixtures, map

- Resolve the board from the symlink: `board=$(dirname "$(readlink -f SPECS.md)")`. `.kanban`, `SPECS.md`, and `AGENTS.md` are gitignored symlinks into the main checkout. Append `# Notes` through `SPECS.md` with `cat >>`, under the existing `# Notes` heading. One `##` subheading there is enough, a second `#` heading is not. Never write `AGENTS.md` and never stage board files. `.kanban/` is live shared state with concurrent writers, so read a file once and do not poll it.
- Fixture HOME is required for global state. `~/.pi`, `~/.config`, and `~/.gnupg` are read-only. Delete with `delete process.env.X`, never `= undefined`. Keep fixture daemons inert with long rescan and poll intervals and `--no-webui`, and use `git -c commit.gpgsign=false commit` in fixture repos. A new page or plugin test must also pass in the fixture HOME.
- Repo map: `src/orchestrator/pipeline.ts` (sweeps, caps, promotion, `doneCleanup`), `liveness.ts` (`poll()`, which also calls `promoteBacklog`), `src/kanban.ts` (task files, worktree naming, `PRIORITY_RANK`), `src/tools.ts` (registration), `spawn.ts` (prompt render, spawn log), `main.ts` (watch, timers), and `src/webui/{logpane,payload,page,board}.ts` (log render, log window byte arithmetic, `PAGE` template, cards). Tests import `../../src/*.ts` and `../helpers.ts`, with the repo root at `join(HERE, "../..")`. `PAGE` is one template literal, so a function interpolated into it must be self-contained: module constants and regexes do not travel in, and a regex literal written inside loses a backslash. For a page test, reuse the file's extraction idiom (`function name(...) { ... }` plus `new Function`) and assert the returned value. A page change needs a daemon restart for a visual check.
- Shell traps: one argv over 131072 bytes fails with E2BIG. `ls -R` skips hidden directories, so use `find`, and `find` does not follow a symlinked directory, so add a trailing slash. Escape a literal dot in `grep` (`\.`), or it matches unrelated text. A bare `grep` with no match, or `grep -c` on zero, exits 1 and fails the whole call, so end a recon call with `|| true`. Before you trust a count from a pipeline, run it on two known lines and look at the shape.
