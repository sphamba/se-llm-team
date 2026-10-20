# developer: role guidance

Durable, task-agnostic facts for the developer role. Task-specific findings belong in the task's `# Notes`.

## Contract and budget

- `SPECS.md` is a symlink to the task file. Its `# Specs` is the contract, including the settled Decisions. Read it once. A recorded decision is closed: do not re-derive it in a test plan, in the CSS, or in the commit message.
- Recon budget for one slice: the module you change, the tail of the test file you append to, and the CSS or config anchor you edit. The Specs `Facts` section already names paths and lines. Open those regions with `read` offset/limit, batch a file's questions into one call, and skip the knowledge-base search for code location.
- This role is the implementer. A single slice is faster inline. Spawn a subagent only for independent research, or for a slice the Specs already separate. The pipeline parallelizes at task level.
- Timebox each open design detail to one turn. When the same question appears twice (class vs inline, which variable, empty element), take the first option the acceptance pins can observe, write it in `# Notes`, and edit. Test-first does not require every exact string up front: pin the behavior structurally, get red, implement, then tighten to exact strings copied from the output. Do not hand-compose long expected output.

## Repo and checks

- No build and no typecheck: Node 24 runs `.ts` through type stripping, and the assert suites are the only check. One suite: `node tests/<area>/<file>.test.ts`. Areas: `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus `tests/*.test.ts` and `index.test.ts`. `pnpm test` runs all. Never run two at once (shared `.pids`, ports, fixture HOMEs), and never run the full suite.
- `tests/helpers.ts` serves `tests/orchestrator/*` and `tests/tools.test.ts`. `tests/efficiency-analysis/helpers.ts` is separate. In `tests/orchestrator/*`, imports are `../../src/*.ts` and `../helpers.ts`. Repo root is `join(HERE, "../..")`.
- `src/webui/page.ts` exports one `PAGE` template literal. It interpolates `esc`, `inline`, `md` and the UI helpers as client source, so keep them self-contained and browser-safe. A regex written directly in `PAGE` loses a backslash. Asserts read the built `PAGE`, and a page change reaches the live UI only after a daemon restart.
- Orchestrator map: sweeps, the reviewer cap and `doneCleanup` live in `src/orchestrator/pipeline.ts`. `poll()` lives in `liveness.ts`. Worktree naming is in `src/kanban.ts`. Prompt rendering and spawn logging are in `spawn.ts`.

## Tests

- `complexity: trivial` in the frontmatter overrides test-first: add no test, and record the skip plus the scoped suites in `# Notes`. An acceptance criterion that names `pnpm test` is met by the scoped suites. For feat/fix/refactor: add the pin, run the owning suite, read the first red `Error` line as data (it also prints the actual value), then implement until green. A red suite is first a test or helper written in this run: fix the test before the production code.
- Find the owning suite with one grep for the changed export's name across `tests/`. If no file imports it, append to the suite that already asserts the module's output. Do not hunt for a purpose-built unit file. Model a new test on the nearest sibling part in the same file, located by its `// --- part` marker, and copy its setup line for line. Grep once for planned local names and import lines; a module-level symbol the test imports needs `export` at its declaration.
- A stub emits each snapshot once. Multi-line expected strings use real `\n` escapes. Before pinning prompt wording, grep `tests/` for the current phrase and copy its exact casing, or lowercase both sides. Prefer deterministic interleaving (drive `rescan`, `poll`, `promoteBacklog` with a temp-HOME config) over daemon races. Gate post-spawn asserts on the suite's `waitFor`, and sleep about 50 ms in wait loops so the event loop can reap children.

## CSS for shared renderers

- A shared renderer can feed more than one container. Read each container's rule before you choose a variable, and reset the user-agent default that breaks the intent (for example `th` centers by default). Scope the override to the container that needs it, pin it, and never omit a correctness declaration to shorten the output. One unscoped rule plus one scoped override is cheaper than a fix commit.

## Shell and environment

- Verification shape: capture the exit code in the same command and print output only on failure. Use `if [ $code -ne 0 ]; then printf '%s\n' "$out" | tail -n 25; fi`, or `|| tail -n 25`. A bare `[ $code -ne 0 ] && ...` leaves the command at exit 1 when the suite passes, and that reads as a failure. Never pipe a suite through `head`/`tail` when you need its first `Error` line. Use `tail -n N`, not `tail -N`. `grep -c` exits 1 on zero matches: append `|| true` only where the count is irrelevant.
- Fixture HOME is mandatory for global state: `~/.pi`, `~/.config` and `~/.gnupg` are read-only. Set or delete `XDG_CONFIG_HOME`, add `--no-webui`, and keep fixture boards inert with long `--rescan-seconds`/`--poll-minutes` and probe tasks in `done`. Use `delete process.env.X`, never `= undefined`.
- In a worktree, `.kanban`, `SPECS.md` and `AGENTS.md` are symlinks into the main checkout, and all three are gitignored. Writing through `SPECS.md` edits the main checkout task file, as intended for `# Notes`; never write through `AGENTS.md`. `git status` will never list them: verify an append by reading the file. Never stage or commit board files (git reports paths "beyond a symbolic link"). Fixture repos need `git -c commit.gpgsign=false commit`.
- Shell traps: one argv over 131072 bytes fails with E2BIG. `ls -R` skips hidden directories (use `find`). `find` does not follow a symlinked directory (use a trailing slash or `-L`). Inspect with `read`, not `sed`; do not patch with `sed` (delimiter clashes leave broken syntax), use the edit tool. A scratch script that imports `../src` lives under `tests/`, never `/tmp`. Run `node --check` on a generated script before its first run.

## Edits and bookkeeping

- edit calls take an array of `{oldText, newText}` hunks, never a JSON string. Hunk ranges must not overlap; a failed batch applies nothing. Anchor each hunk on the shortest unique line copied from a read. Append with `cat >> file <<'EOF'`, because the quoted delimiter keeps backticks and `$` literal.
- Task files have `# Summary`, `# Specs` and `# Notes`, and sometimes `# Acceptance`/`# Open questions`. Append under the existing `# Notes`, never create a second heading. Commit messages state only verified facts; match subtask commits by subject, not SHA.
- `.kanban/` is live shared state with concurrent writers. Measure a board file once in the final batch and never poll a file another agent owns. Delete a board file only after the `meta/kanban` mirror advances past it.
- Settle the verdict once: landed-on-main state, blocker states by zero-padded file name, absence greps, and the suite decision. A recorded blocked verdict is final. If an acceptance check fails on a file you may not edit, record the decision in `# Notes` and stop.
