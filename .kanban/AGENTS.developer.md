# developer: role guidance

Method and repo facts for the developer role. The spawn prompt owns the numbered steps, the task-type test policy, and the commit rule. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Put task findings in `# Notes` and durable method changes here, never in `AGENTS.md`.

## Contract

- Read `SPECS.md` once, fully, and keep it. `# Specs` and `# Acceptance` are the contract and `# Context` is background. The Specs beat this file and the spawn prompt. A value the Specs give, such as a line number, a table, or a sort order, is given. Do not derive it again from the source and do not open the file a second time.
- Decide each open choice once, before the first edit. The Acceptance check is the judge between two forms. When the evidence contradicts a premise the Specs call proven, spend one command, then act. Do not mine older task files, docs, git history, or a knowledge base for intent. For a mechanical change, the Specs and the code are the only sources.
- Change only what the Specs and the Acceptance require. No extra docs, comments, renames, or hardening. Record an unfixed risk in one `# Notes` line and leave it. Work in the worktree and never change task states or edit the board.

## Orientation

- Budget 6 tool calls from the first read to the first edit. A cosmetic or ordering change is usually one import plus a few lines, so a longer recon costs more than the edit itself. If you pass the budget, stop recon and write the smallest form that satisfies the Specs. When a question needs the web or a wide sweep, hand it to one subagent and keep working.
- Read each named file once with the read tool and a generous `limit`, never with `cat`, `sed`, or `awk`. Grep all anchors in the same call: `grep -n 'PRIORITY_RANK\|function rescan\|for (const task of' src/ tests/`. The one exception is the `cat >>` append in Edits. Do not stack several sections in one `bash` dump, because the output truncates and the tail is lost.
- Read the one function you change and the nearest `// --- part XX` test that pins it. Do not read a whole test suite. For a docs change, one `grep -n '<term>' docs/<file> README.md` gives the paragraph and the table row. Never grep the same doc twice.
- Do no arithmetic in your head and do not predict a formatted string. Write a three-line `node -e` probe that prints every value the Specs require, compare it with the Specs table, and copy the printed values into the code and the pins. For a computed string, such as an SVG path or a label, print the real string and paste it. A derivation you redo twice is a probe you owe.

## Tests

- A suite runs as `node tests/<area>/<file>.test.ts`. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus the loose `tests/*.test.ts`. There is no build and no typecheck, and `node --check` cannot parse TypeScript. `node scripts/test-changed.mjs` maps changed files to suites. Never run `pnpm test`.
- The run list is exactly the suites `# Acceptance` names plus the suite file you edited. Once green, do not add safety suites and do not re-run a suite whose code did not change. A docs-only change runs the suites the Specs name, else none.
- Test-first: append the pin, run the suite, read the first red `Error` line (it prints the actual value), then implement to green. Model the new part on the nearest `// --- part XX` sibling, continue its letter, and copy exact strings from the output only. Guard reads of log or pid files so a missing file fails with your message, not ENOENT. `complexity: trivial` skips red-first but still adds any pin the Specs name.
- A pin exists or it does not: one `grep -rn "<exact string>" tests/` answers it, and empty output is final. Do not widen to `src/`, try near-miss numbers, or read a suite to learn what it asserts. No pin and none named: no test edit.
- A shared literal or an attribute ripples into every exact-output assert. Count the sites with `grep -rn '<literal>' tests/ | wc -l` before the edit, replace all of them in one `perl -pi -e` pass, then count the new literal and compare. Never edit those asserts one by one.
- There is no DOM library. Tests hand-roll element stubs. Extend the stub in the file you touch and give it every property the code path reads: `tagName`, `style`, `innerHTML`, `appendChild`, `children`, and both sibling getters. Do not add a dependency.

## Edits, checks, and delivery

- `edit` takes `{oldText, newText}` hunks that must not overlap, and a failed batch applies nothing. Anchor each hunk on the shortest unique line from your read. Re-read each `newText` before you send it: if old and new text agree on a line, that line does not move. After the batch, read the changed region once and confirm every intended value moved. For a large insertion, append with `cat >> file <<'EOF'` and read the appended block back. After you add a module-level symbol, grep the consumer import line in the same breath: `grep -n 'from "./<module>.ts"' src/`.
- One command runs one suite and prints the output only on failure:

  ```
  out=$(node tests/x.test.ts 2>&1); c=$?
  if [ $c -ne 0 ]; then printf '%s\n' "$out" | tail -n 25; fi
  ```

  Read `$?` immediately. A bare `[ $c -ne 0 ] && ...` leaves the shell at exit 1 and reads as a failure. Never pipe a failing suite through `head` or `tail`. `grep -c` exits 1 on zero matches.
- Write `# Notes` before the commit, then commit once so the notes and the code land together. Name the commit by subject, never by SHA, and confirm with one `git log --oneline -1` or `git show --stat`. Read the staged diff once for imports the edit left unused.

## Board, fixtures, and map

- Resolve the board from the symlink: `board=$(dirname "$(readlink -f SPECS.md)")`. `.kanban`, `SPECS.md`, and `AGENTS.md` are gitignored symlinks into the main checkout. Append `# Notes` through `SPECS.md`, under the existing heading and never as a second heading. Never write `AGENTS.md` and never stage board files. `.kanban/` is live shared state with concurrent writers, so read a file once and do not poll it.
- Fixture HOME is required for global state. `~/.pi`, `~/.config`, and `~/.gnupg` are read-only. Delete with `delete process.env.X`, never `= undefined`. Keep fixture daemons inert with long rescan and poll intervals and `--no-webui`, and use `git -c commit.gpgsign=false commit` in fixture repos. A new page or plugin test must also pass in the fixture HOME.
- Repo map: `src/orchestrator/pipeline.ts` (sweeps, caps, promotion, `doneCleanup`), `liveness.ts` (`poll()`, which also calls `promoteBacklog`), `src/kanban.ts` (task files, worktree naming, `PRIORITY_RANK`), `src/tools.ts` (registration), `spawn.ts` (prompt render, spawn log), `main.ts` (watch, timers), and `src/webui/{logpane,payload,page,board}.ts` (log render, log window byte arithmetic, `PAGE` template, cards). Tests import `../../src/*.ts` and `../helpers.ts`, with the repo root at `join(HERE, "../..")`. `PAGE` is one template literal, so a function interpolated into it must be self-contained: module constants and regexes do not travel in, and a regex literal written inside loses a backslash. For a page test, reuse the file's extraction idiom (`function name(...) { ... }` plus `new Function`) and assert the returned value. A page change needs a daemon restart.
- Shell traps: one argv over 131072 bytes fails with E2BIG. `ls -R` skips hidden directories, so use `find`, and `find` does not follow a symlinked directory, so add a trailing slash. A scratch probe that imports `../src` lives under `tests/` and is deleted after the probe. Before you trust a count from a pipeline, run it on two known lines and look at the shape.
