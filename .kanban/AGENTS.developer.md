# developer: role guidance

The spawn prompt owns the numbered steps, the state ban, and the stall window. This file gives the method and the repo facts. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Put task-specific findings in `# Notes`.

## Contract

- Read `SPECS.md` once with the `read` tool. `# Specs` and `# Acceptance` are the contract. `# Context` is background. The Specs win over the test defaults here and in the spawn prompt, including the trivial-task skip. When the Specs name a file, a suite, or a pin, do it. When a named knob or profile does not exist, use the nearest real config key and record the substitution in `# Notes`.
- When two Specs lines disagree, the `# Acceptance` checks are the arbiter. Choose the smallest behavior that passes them, write the choice and its reason as one `# Notes` line, and stop deliberating. Do not mine older task files or git history for the author's intent: the acceptance check already states it. If a premise that the Specs call proven conflicts with the evidence, check it with one command and move on.
- Change only what the Specs and the acceptance list require. Do not add docs, comments, renames, or extra hardening. An unrequested one-line change becomes a second commit, a second suite run, and reviewer time. Record an unfixed risk in `# Notes` and do not fix it.
- Decide each design choice once. Read the anchors that the Specs name, one test sibling, and one fixture helper. Budget about eight calls before the first edit. Write the chosen call chain in `# Notes`, then edit. Do not hunt a root cause on paper: encode a probe in a test, or delegate the hunt.
- Implement in the worktree. Finish when the notes are written. Never change task states. If you cannot finish, write the blocker in `# Notes`.

## Orientation

- Resolve the board from the symlink, not from guessed `../` depth: `board=$(dirname "$(readlink -f SPECS.md)")`. A worktree sits deeper than the main checkout, so `../../.kanban` and similar paths miss. Use the absolute path for the rest of the run.
- Recon is one batch per file. A source or test file here is a few hundred lines: read it once with `read` (offset and limit), then grep once for anchors. Do not return later for imports, a tail, or a line count. Never use `cat` or `sed` to read a file.

## Subagents

- Delegate a research question to a subagent before the first edit. Give it one question and one evidence standard, not a list of hypotheses, and tell it to stop when the question is answered. Continue your own work while it runs. Call `get_subagent_result` only when no independent work is left, never as an idle wait. Spend at most one cheap command to check a claim that changes your code or notes, and copy the rest of the report into `# Notes` as given.

## Tests

- There is no build and no typecheck. Run one suite as `node tests/<area>/<file>.test.ts` or `node index.test.ts`. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus `tests/*.test.ts`. Never run `pnpm test`. `node --check` cannot parse TypeScript, so it is not a check.
- Run the suites that the Specs name and the suites that own the changed code. Find the owning suite with one grep of the changed export or string under `tests/`. Role prompt pins live in `tests/orchestrator/merge.test.ts`, which renders the prompts with `renderPrompt`. Use one chained command, one suite at a time, and the new pin first. Never run two suites at once. An orchestrator suite takes tens of seconds, so run it once per code change. A comment-only or docs-only change does not need a re-run. Do not run a green suite again unless the code changed.
- Test-first: add the pin, run the suite, read the first red `Error` line (it prints the actual value), then implement until green. Model a new test on the nearest `// --- part` sibling. Copy exact strings from the output, never compose a long expected string by hand. Grep `tests/` for the exact wording before you pin a string. A missing log or output file is a valid red state. Guard the read so the assert fails with its own message, not with ENOENT. A `complexity: trivial` task skips red-first and new tests, but a pin that the Specs name is still required: add it with the change, run until green, and record the skip and the suites in `# Notes`.
- In `tests/orchestrator/*`, imports are `../../src/*.ts` and `../helpers.ts`. The repo root is `join(HERE, "../..")`. A module-level symbol that the test imports needs `export` at its declaration. A stub emits each snapshot once. Gate a post-spawn assert on the suite's `waitFor`, and sleep about 50 ms in a wait loop so the event loop reaps children. For a daemon fixture, use `runDaemon` with inert stubs, long intervals, `--no-webui`, and one teardown path. After `kill("SIGTERM")`, wait for the daemon `exit` event before `cleanupAll`, or leave the temp root. A cleanup while the child still writes fails with ENOTEMPTY.

## Edits and checks

- The `edit` tool takes `{oldText, newText}` hunks. Ranges must not overlap, and a failed batch applies nothing. Anchor each hunk on the shortest unique line copied from a read. For a large insertion, such as a test part or a function body, append with `cat >> file <<'EOF'`, never a long `newText`. After an edit, read the hunk and run one `git diff -- <file>`. Repair a bad hunk before the next step. Before a commit, read the staged diff for imports that the edit made unused. Commit subject and body from verified facts. Record a commit by subject, never by SHA. An amend changes the SHA.
- Capture the exit code in the same command and print the output only on failure:
  ```
  out=$(node tests/x.test.ts 2>&1); c=$?
  if [ $c -ne 0 ]; then printf '%s\n' "$out" | tail -n 25; fi
  ```
  A bare `[ $c -ne 0 ] && ...` leaves the shell at exit 1 and reads as a failure. Never pipe a failing suite through `head` or `tail`. `grep -c` exits 1 on zero matches.
- `.kanban`, `SPECS.md`, and `AGENTS.md` are symlinks into the main checkout and are gitignored. Append `# Notes` through `SPECS.md`. Never write through `AGENTS.md`. Never stage or commit board files, `SPECS.md`, or `AGENTS.md`. Task files have `# Summary`, `# Specs`, and `# Notes`, and sometimes `# Acceptance` or `# Open questions`. Append under the existing `# Notes`, never make a second heading. `.kanban/` is live shared state with concurrent writers. Read a board file once and do not poll a file that another agent owns. If an acceptance check fails on a file that you may not edit, write the decision in `# Notes` and stop.
- Fixture HOME is required for global state. `~/.pi`, `~/.config`, and `~/.gnupg` are read-only. Delete `XDG_CONFIG_HOME` with `delete process.env.X`, never `= undefined`. Keep fixture daemons inert with long rescan and poll intervals and use `--no-webui`. Use `git -c commit.gpgsign=false commit` in fixture repos.
- Shell traps: one argv over 131072 bytes fails with E2BIG. `ls -R` skips hidden directories, so use `find`. `find` does not follow a symlinked directory, so use a trailing slash. A scratch script that imports `../src` lives under `tests/`, never `/tmp`.

## Code map

- `src/webui/page.ts` holds one `PAGE` template literal. It interpolates client helpers as source. A served function must be self-contained, because module-scope constants and regexes do not travel into `PAGE`. A regex literal written in `PAGE` loses a backslash. Asserts read the built `PAGE`, and a page change needs a daemon restart. For a page test, reuse the file's existing extraction idiom: match `function name(...) { ... }`, then run the source with `new Function`. Anchor on the declaration and stop at a line that starts with `}`. Assert the returned value, not the whole `PAGE`.
- When you override a shared renderer, reset the user-agent default that breaks the intent and scope the override to the container that needs it. Keep every correctness declaration.
- Orchestrator map: sweeps, the reviewer cap, backlog promotion, and `doneCleanup` are in `src/orchestrator/pipeline.ts`. `poll()` is in `liveness.ts`, and it also calls `promoteBacklog`, so a new parameter must keep its default. Worktree naming is in `src/kanban.ts`. Prompt rendering and spawn logging are in `spawn.ts`. The watch handler, debounce, and timers are in `main.ts`.
