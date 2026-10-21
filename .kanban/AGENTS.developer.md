# developer: role guidance

Method and repo facts for the developer role. The spawn prompt owns the numbered steps, the task-type test policy, and the commit rule. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Put task findings in `# Notes`. Put durable method changes here, never in `AGENTS.md`.

## Contract

- Read `SPECS.md` once, fully, and keep it. `# Specs` and `# Acceptance` are the contract, and `# Context` is background. The Specs beat this file and the spawn prompt.
- A value the Specs give (a line number, a table row, a path, a sort order) is given. Copy it verbatim into the code and the pins. Do not derive it again, do not reconcile it with your own calculation, and do not open the file again. If the code contradicts a value the Specs call proven, spend one command, then act.
- Decide each open choice once, before the first edit. The Acceptance check is the judge. Do not mine older task files, docs, git history, or a knowledge base for intent. Change only what the Specs and Acceptance require. A comment that the change makes false is part of the change. No other docs, comments, renames, or hardening. Record an unfixed risk in one `# Notes` line and leave it. Work in the worktree and never change task states or edit the board.

## Orientation

- Budget 6 tool calls from the first read to the first edit. A cosmetic or ordering change is usually one import plus a few lines, so longer recon costs more than the edit. At the budget, stop and write the smallest form that satisfies the Specs. When a question needs the web or a wide sweep, hand it to one subagent and keep working.
- Read a whole file with the read tool and a generous `limit`. Read a Specs-cited line range with `sed -n 'A,Bp'`. Keep each `bash` read short: at most two small ranges, because a large dump truncates and loses the tail. Never `cat` a whole file to read it. Grep all anchors in one call: `grep -n 'PRIORITY_RANK\|function rescan\|for (const task of' src/ tests/`.
- Read the one function you change and the nearest `// --- part XX` test that pins it. Do not read a whole suite. For a docs change, one `grep -n '<term>' docs/<file> README.md` gives the paragraph and the table row. Never grep the same doc twice.
- Do no arithmetic in your head and do not predict a formatted string. A probe is for a value the Specs do not give. Write one `node -e` probe, print every needed value, and copy the output. For a computed string, print the real string and paste it. If a probe and the Specs disagree, stop and trust the Specs, or record the conflict in `# Notes`. Never run the same derivation twice.

## Tests

- A suite runs as `node tests/<area>/<file>.test.ts`. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus the loose `tests/*.test.ts`. There is no build and no typecheck, and `node --check` cannot parse TypeScript. `node scripts/test-changed.mjs` maps changed files to suites. Never run `pnpm test`. Run exactly the suites `# Acceptance` names plus the suite file you edited, and do not re-run a suite whose code did not change.
- For a fix or a feature, write or update the pin and run it red before the code change. For a refactor, make the pin pass before you touch the code. Read the first red `Error` line (it prints the actual value), then implement to green. Model the new part on the nearest `// --- part XX` sibling and copy exact strings from the output. `complexity: trivial` skips red-first but still adds any pin the Specs name.
- A pin exists or it does not: one `grep -rn "<exact string>" tests/` answers it, and empty output is final. Do not widen to `src/`, try near-miss numbers, or read a suite to learn what it asserts. No pin and none named: no test edit.
- A shared literal or an attribute ripples into every exact-output assert. Count the sites with `grep -rn '<literal>' tests/ | wc -l`, replace all in one `perl -pi -e` pass, then count the new literal and compare. Do not edit those asserts one by one.
- There is no DOM library. Tests hand-roll element stubs. Extend the stub in the file you touch and give it every property the code path reads: `tagName`, `style`, `innerHTML`, `appendChild`, `children`, and both sibling getters. Do not add a dependency.

## Edits, checks, and delivery

- `edit` takes `{oldText, newText}` hunks. The hunks are independent, match the original file, and apply all or none. A success result means every hunk landed. A failed result applies nothing, so re-read only then. Anchor each hunk on the shortest unique line from your read, and confirm that old and new text differ on every line you intend to move. Let the test be the only audit of an edit. Do not grep or re-read to confirm a successful edit, and do not audit a successful command twice.
- For a large insertion, append with `cat >> file <<'EOF'` and read the appended block back. When you add or remove a module-level symbol, grep the consumer import line in the same breath: `grep -n 'from "./<module>.ts"' src/`. Do not read a diff for unused imports unless you changed a symbol.
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

  Read `$?` immediately. Do not leave the shell at exit 1 from a bare `[ ... ]` test. Never pipe a failing suite through `head`. `grep -c` exits 1 on zero matches.
- Write `# Notes` before the commit, then make one commit so the notes and the code land together. Stage only source and test files. Refer to the commit by subject, not by SHA. End the same call with `git show --stat --oneline HEAD`, then stop. Do not inspect the diff again unless the stats show a missing or extra file.

## Board, fixtures, and map

- Resolve the board from the symlink: `board=$(dirname "$(readlink -f SPECS.md)")`. `.kanban`, `SPECS.md`, and `AGENTS.md` are gitignored symlinks into the main checkout. Append `# Notes` through `SPECS.md` with `cat >>`, under the existing heading, never as a second heading. The write follows the symlink, so no board path is needed for notes. Never write `AGENTS.md` and never stage board files. `.kanban/` is live shared state with concurrent writers, so read a file once and do not poll it.
- Fixture HOME is required for global state. `~/.pi`, `~/.config`, and `~/.gnupg` are read-only. Delete with `delete process.env.X`, never `= undefined`. Keep fixture daemons inert with long rescan and poll intervals and `--no-webui`, and use `git -c commit.gpgsign=false commit` in fixture repos. A new page or plugin test must also pass in the fixture HOME.
- Repo map: `src/orchestrator/pipeline.ts` (sweeps, caps, promotion, `doneCleanup`), `liveness.ts` (`poll()`, which also calls `promoteBacklog`), `src/kanban.ts` (task files, worktree naming, `PRIORITY_RANK`), `src/tools.ts` (registration), `spawn.ts` (prompt render, spawn log), `main.ts` (watch, timers), and `src/webui/{logpane,payload,page,board}.ts` (log render, log window byte arithmetic, `PAGE` template, cards). Tests import `../../src/*.ts` and `../helpers.ts`, with the repo root at `join(HERE, "../..")`. `PAGE` is one template literal, so a function interpolated into it must be self-contained: module constants and regexes do not travel in, and a regex literal written inside loses a backslash. For a page test, reuse the file's extraction idiom (`function name(...) { ... }` plus `new Function`) and assert the returned value. A page change needs a daemon restart.
- Shell traps: one argv over 131072 bytes fails with E2BIG. `ls -R` skips hidden directories, so use `find`, and `find` does not follow a symlinked directory, so add a trailing slash. A scratch probe that imports `../src` lives under `tests/` and is deleted after the probe. Escape a literal dot in `grep` (`\.`), or it matches unrelated text. Before you trust a count from a pipeline, run it on two known lines and look at the shape.
