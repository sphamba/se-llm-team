# developer: role guidance

Durable, task-agnostic facts for the developer role. Task-specific findings belong in the task's `# Notes`.

## Settle, then act

- `SPECS.md` (a symlink to the task file) is the contract: read its frontmatter and body once. Trust on-disk state over numbers quoted in prose.
- One recon pass, then stop: read each relevant function whole and record the findings (paths, helper signatures, transitions) in `# Notes`. Consult those notes instead of re-reading. If a second deliberation reaches the same open question as the first, take the cheapest reversible option, record it, and act.

## Repo and checks

- No build and no typecheck: Node 24 runs `.ts` directly through type stripping; the assert suites are the only check. Run one suite standalone with `node tests/<area>/<file>.test.ts`. Areas are `tests/kanban`, `tests/orchestrator`, `tests/webui`, `tests/efficiency-analysis`, plus top-level `tests/*.test.ts` and `index.test.ts`. `pnpm test` runs all of them. Never run two suites at once: shared `.pids`, ports and fixture HOMEs.
- `tests/helpers.ts` serves `tests/orchestrator/*` and `tests/tools.test.ts`; `tests/efficiency-analysis/helpers.ts` is separate. In `tests/orchestrator/*`, imports are `../../src/*.ts` and `../helpers.ts`; repo root is `join(HERE, "../..")`.
- `src/webui/page.ts` exports one `PAGE` template literal. A regex inside it loses its backslash. Asserts read the built `PAGE`, and a page.ts change reaches the live UI only after a daemon restart.
- Orchestrator map: sweeps, the reviewer cap and `doneCleanup` live in `src/orchestrator/pipeline.ts`; `poll()` lives in `liveness.ts`; worktree naming in `src/kanban.ts`; prompt rendering and spawn logging in `spawn.ts`.

## Tests

- Complexity `trivial` in the frontmatter overrides the fix test-first rule: add no test, and record the skip plus the scoped suites you ran in `# Notes`. An acceptance criterion that names `pnpm test` is met by those scoped suites. Never run the full suite.
- Model a new test on the nearest sibling part in the same file, located by its `// --- part` marker, and copy its setup line for line. `mkdirSync(kanbanDir(root), { recursive: true })` must precede a board JSON write. Grep the file once for planned local names and import lines; a module-level symbol the test imports needs `export` at declaration.
- A stub emits each snapshot once. Multi-line expected strings use real `\n` escapes. Before writing a prompt-wording pin, grep `tests/` for the current phrase and copy its exact casing, or lowercase both sides.
- Prefer deterministic interleaving (drive `rescan`, `poll`, `promoteBacklog` with a temp-HOME config) over daemon races. Gate post-spawn asserts on the suite's `waitFor`, and sleep about 50 ms in wait loops so the event loop can reap children.
- A suite that goes red is first a test or helper written in this run: read the first `Error` line as data and print the helper's return. Fix the test before the production code, and run only the owning scoped suite.

## Shell and environment

- Verification shape: capture each suite's exit code in the same command, print output only on failure, and use `tail -n N` (not `tail -N`; with multiple files GNU tail fails with "option used in invalid context" and returns 1). Never pipe through `head`/`tail`, because the first `Error` line is the diagnosis. `grep -c` exits 1 on zero matches: append `|| true` in a chain, but never guard a check whose result you need.
- Fixture HOME is mandatory for global state: `~/.pi`, `~/.config` and `~/.gnupg` are read-only. Set or delete `XDG_CONFIG_HOME`, add `--no-webui`, and keep fixture boards inert with long `--rescan-seconds`/`--poll-minutes` and probe tasks in `done`. Use `delete process.env.X`, never `= undefined`.
- In a worktree, `.kanban`, `SPECS.md` and `AGENTS.md` are symlinks into the main checkout; writing through them edits the main checkout. Never stage or commit board files (git reports paths "beyond a symbolic link"). Fixture repos need `git -c commit.gpgsign=false commit`.
- Shell traps: one argv over 131072 bytes fails with E2BIG; `ls -R` skips hidden directories (use `find`); `find` does not follow a symlinked directory (use a trailing slash or `-L`); do not patch with `sed` (delimiter clashes leave broken syntax) use the edit tool; a scratch script that imports `../src` lives under `tests/`, never `/tmp`; run `node --check` on a generated script before its first run.

## Edits and bookkeeping

- edit calls take an array of `{oldText, newText}` hunks, never a JSON string. Hunk ranges must not overlap; a failed batch applies nothing. Anchor each hunk on the shortest unique line copied from a read. Append at end of file with a heredoc.
- Task files have `# Summary`, `# Specs` and `# Notes`, and sometimes `# Acceptance`/`# Open questions`. Append facts under the existing `# Notes`, never create a second heading. Commit messages state only verified facts; match subtask commits by subject, not SHA.
- `.kanban/` is live shared state with concurrent writers. Measure a board file once in the final batch and never poll a file another agent owns. Delete a board file only after the `meta/kanban` mirror advances past it.
- Settle the verdict once: landed-on-main state, blocker states by zero-padded file name, absence greps, and the suite decision. A recorded blocked verdict is final. If an acceptance check fails on a file you may not edit, record the decision in `# Notes` and stop.
