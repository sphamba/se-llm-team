# developer: role guidance

Durable, task-agnostic facts for the developer role. Task-specific findings belong in the task's `# Notes`.

## Settle once, then act

- Task text can quote stale numbers: trust on-disk state, confirm with one `wc`/`grep`, then act. Settle each design point in one ladder pass, record it in `# Notes`, re-open only on new evidence.
- Run every acceptance check once, batched into one command, before the commit; a passed check is not re-run. Ground unfamiliar names with one search: take symbol names from read output or import lines (a guessed name returns zero matches); an empty knowledge page ends the thread.

## Shared board files have concurrent writers

- `.kanban/` is live shared state: doctor runs in other pipelines rewrite role-notes and board files at any moment. A file that reads differently later is another writer's output, not your regression. Check once for an active writer (`pgrep -f analysis-run`) before editing; if one is live, skip or land your best version without waiting.
- Measure a live shared file once, in the final settle batch, and record value plus hash plus timestamp; a mid-run re-read is throwaway and each one re-opens settled questions. A distill or repair of a shared notes file is done when its acceptance checks pass once: note the outcome in `# Notes` and stop. Never enter wait-poll, re-trim or re-measure loops against a file another agent owns — that race cannot be won. If a spec assigns a notes edit: draft in /tmp, verify claims with one `ls`/`git log` pass, measure with `wc -c` and a bullet-line `grep -c` (never mental arithmetic), trim largest sections first, leave headroom under the doctor's caps, copy in once, re-read changed hunks after each edit batch.

## Repo, build and checks

- No build, no typecheck: `.ts` runs directly through node's type stripping (Node >= 24); the assert suites are the only check. `npm test` (glob loop over `index.test.ts`, `tests/*.test.ts`, `tests/*/*.test.ts`), `npm run test:changed` (change-mapped), or standalone: `node tests/<area>/<file>.test.ts`. Inventory: `docs/development.md`. Never run two suites at once: shared `.pids`, ports, fixture HOMEs. pnpm is pinned via `packageManager`; pnpm on the read-only worktree mount prints `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` — benign, the suite still passes.

## Suite layout and harness

- Shared helpers live in `tests/helpers.ts` (imported by `tests/orchestrator/*` and `tests/tools.test.ts`; webui and efficiency-analysis group files are standalone; efficiency-analysis has its own `helpers.ts`). In `tests/orchestrator/*` and `tests/webui/*`, HERE is that dir: src imports `../../src/*.ts`, helpers `../helpers.ts`, repo root `join(HERE, "../..")`.
- The webui suite is the group files under `tests/webui/` (no `tests/webui.test.ts`); the efficiency-analysis suite is the group files under `tests/efficiency-analysis/` (prompt pins: `doctor.test.ts`, `prompts.test.ts`). Extend the group file whose scenario block covers the change. A `MODULE_NOT_FOUND` path is dead: never re-guess it inside a directory your `ls` listed.
- `src/webui/page.ts`'s PAGE is one template literal served as the client: a regex inside it loses its backslash (write `\\.` for a literal `.`); asserts on served text match the built PAGE, not source bytes; a page.ts edit goes live only after a daemon restart.
- Before adding a test block, grep that file once (fixed-string) for planned local names against its import lines: a reused name or missing import costs a red run and a rename round. New module-level symbols tests import need `export` at declaration. Re-locate test parts by their `// --- part` marker, never by line number.
- Prefer deterministic interleaving over daemon races: drive `rescan`, `poll` and `promoteBacklog` directly with a temp-HOME config (`mkdtempSync`); free a concurrency slot by setting a holder task to a non-counted state; order steps so each assert that reads state precedes the call that mutates it; gate meta/kanban mirror asserts with the suite's waitFor. Wait loops over spawned processes must sleep between checks (~50 ms): a busy spin blocks the event loop, the SIGCHLD reaper never runs, and a zombie keeps pidAlive true.

## When a run goes red

- A test or helper written in this run is the first suspect when its suite fails: re-read it on disk and scratch-print the helper's return before any production-code theory. A comma-joined argv or `[`-list where a prompt string was expected means the helper returned the wrong nesting level (`.at(-1)` grabbed the outer array). The first Error line names the assert file:line: read it and its printed values as data, then act. Grep production code only after the new test code is proven innocent.

## Shell, environment and fixture isolation

- Run discipline: redirect suite output to a file and capture the exit code in the same command (`setsid bash -c 'npm test > /tmp/o 2>&1; echo $? > /tmp/o.exit'`), never pipe through head/tail — the first Error line is the whole red diagnosis. `grep -c` exits 1 on zero matches (append `|| true` in chains, but never guard a check whose result you need: `node --check`, the suite). Kill a fixture daemon by pid from ss/lsof, never `$!` or `pkill -f` (it can match your own bash -c command line, exit 143).
- Fixture HOME is mandatory for global state: `~/.pi`, `~/.config` and `~/.gnupg` are read-only bind mounts, so run global-state tests and smoke daemons on a fixture HOME with `XDG_CONFIG_HOME` set or deleted, plus `--no-webui` — else the daemon reads the global config, binds the production webui port and holds the global hub lock. `process.env.X = undefined` sets the string "undefined" — use `delete process.env.X`. Keep fixture boards inert: long `--rescan-seconds`/`--poll-minutes`, probe tasks in done (backlog auto-promotes and spawns real agents).
- In a task worktree, `.kanban`, `SPECS.md` and `AGENTS.md` are symlinks into the main checkout: writing through them edits it. Never stage or commit board files (git calls these paths "beyond a symbolic link"); board history is `git log meta/kanban -- <file>`. The global `~/.gitconfig` forces `commit.gpgsign=true` (this checkout opts out): fixture repos need `git -c commit.gpgsign=false commit`; a bare commit with unstaged edits fails.
- Shell traps: one argv over 131072 bytes fails with E2BIG; `ls -R` skips hidden dirs — use find; never patch with sed (delimiter clashes leave broken syntax) — use the edit tool; temp scripts that import `../src` live under `tests/`, never /tmp; a name-critical `.ts` fixture outside a package needs a `{"type":"module"}` package.json next to it; run `node --check` (unguarded) on a generated script before its first run.

## Edits and task-file bookkeeping

- edit calls take an array of `{oldText, newText}` hunks, never a JSON string; hunks must not overlap (a failed batch applies nothing — keep batches small); anchor each hunk on the shortest unique line copied verbatim from read output; a truncated line is never an anchor. End-of-file appends go through a heredoc, never a tail-anchored edit. When the spec asks for prose a sibling file already carries, mirror it verbatim with only names swapped.
- Task files carry `# Summary`, `# Specs`, `# Notes` (some add `# Acceptance`/`# Open questions`): append facts under the existing `# Notes` heading (never a second one), assumptions under `# Open questions`. Commit messages state only verified facts — diff old vs new before claiming parity. Board task files are `.kanban/<NNNNNN>_<slug>.md`, zero-padded to 6 digits: look them up by padded glob (unpadded patterns match nothing).

## Verification and blocked tasks

- Settle a blocked or verification-only verdict in one start batch: the landed-on-main pair (`git log --oneline HEAD..main` plus merge-base), the blockers' board state read by zero-padded name, and absence greps for the expected contract across src/tests/docs (empty results are the expected evidence). Match subtask commits by subject, not SHA: worktree SHAs can be rebased before merge, so an `--is-ancestor` check on a quoted SHA can mislead. Deliver one baseline suite run plus the blocker note, then stop: a no-diff verification makes no commit.
- When an acceptance check fails on a file you are prohibited from editing (a doctor-owned notes file, a board file), decide once and report: record the failing value, the root cause and the owning task in `# Notes`, and stop. Never hand-fix a prohibited file, never re-measure to see whether it healed, never re-argue a recorded verdict; the reader needs one clean decision, not the deliberation.
- Run the spec's metrics verbatim: copy the exact `grep`/`wc` pipeline from the Specs instead of substituting your own counting rule, and note in `# Notes` when the metric's counting scope differs from a related rule elsewhere.
