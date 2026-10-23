---
name: "fix: refuse to spawn the orchestrator when .git is not writable"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "git-writable-preflight"
---

# Summary
`orchestrator_start` and the daemon must refuse to start when the resolved git dirs are not writable, before the lock or any board write, and exit 1 with a clear message.

# Specs
# Context

`orchestrator_start` forks the daemon and returns "Orchestrator starting" immediately (`src/tools.ts:239-260`). The daemon writes `.kanban/.logs`, `.kanban/.pids`, acquires the lock and bootstraps the board before its first git write (`src/orchestrator/main.ts:89-95`). Nothing checks that `.git` is writable. With a read-only `.git`, the daemon starts, agents spawn (their logs and pids live under `.kanban`), but every worktree add, mirror commit, rebase/merge and done cleanup fails later. The user wants the spawn to fail fast.

`.git` is a directory in a main checkout and a file in a linked worktree. The write targets are `git rev-parse --absolute-git-dir` (per-worktree index and HEAD) and `git rev-parse --git-common-dir` (objects, refs and config). A probe of `join(root, ".git")` is wrong for a worktree.

# Implementation

1. Add `gitWritableError(root: string): string | null` to `src/kanban.ts`, directly after `isLinkedWorktree` (around `src/kanban.ts:107`). Reuse the existing imports; add no dependency.
   - Resolve both dirs with `execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })` and the same call with `--git-common-dir`. Make a relative result absolute with `join(root, out)`, and dedupe the two paths (a main checkout resolves both to `<root>/.git`).
   - If git resolution throws (not a git repo, git missing), return `null`. Keep the existing git-less behavior: `orchestrator_start` already refuses a non-git root via `resolveRoot`, and the daemon stays git-less.
   - For each resolved dir, write an empty probe file at `join(dir, `.orchestrator-write-probe-${process.pid}`)` and unlink it. On any error return `"${dir} (${code ?? message})"`, for example `/repo/.git (EACCES)`. Return `null` when both probes succeed.
   - Do not probe `join(root, ".git")`; it is a file in a linked worktree. Do not probe `objects` or `refs` separately.

2. In `src/tools.ts` `orchestrator_start` (around `src/tools.ts:239-256`), after the `pid && pidAlive(pid)` early return and before the `.logs`/`.pids` `mkdirSync` and `openSync`, call `gitWritableError(root)`. If it returns a reason, return `ok(`Cannot start the orchestrator: .git is not writable at ${reason}`)` and do not spawn, do not create `.kanban` dirs. Keep the "already running" response first so an idempotent start of a healthy daemon still reports it. Add one sentence to the tool description: it refuses to start when the git directory is not writable.

3. In `src/orchestrator/main.ts` `main`, after `reapIfTaskEnded()` (so a finished worktree daemon still reaps with exit 0) and before `loadConfig` and `acquireLock` (around `src/orchestrator/main.ts:83-90`), call `gitWritableError(root)`. On a reason, write `Cannot start the orchestrator: .git is not writable at ${reason}\n` to `process.stderr`, set `process.exitCode = 1`, and return. Do not load config, acquire the lock, create `.kanban` dirs, bootstrap the board, start the web UI or spawn any agent.

# Tests

- `tests/kanban/git.test.ts`: after the existing mutation checks, assert `gitWritableError(gitRoot) === null`; then `chmodSync(join(gitRoot, ".git"), 0o555)` and assert the result is a string naming `join(gitRoot, ".git")` and containing `EACCES`. Restore `0o755` in a `finally` before `rmSync`.
- Add one linked-worktree case: `git worktree add` a sibling path, get its `--absolute-git-dir`, chmod that per-worktree dir `0o555`, assert the reason names it, restore. This pins that `join(root, ".git")` is not used. Keep the fixture cleanup correct.
- `tests/mcp.test.ts`: after the existing spawn-stub `orchestrator_start` test, chmod the test root's `.git` to `0o555`, reset `globalThis.__spawnCalls`, call `TOOLS.orchestrator_start.run({}, { cwd: root, defaultAgent: "claude" })`, assert `__spawnCalls.length === 0` and the text matches `^Cannot start the orchestrator: \.git is not writable at .*\.git \(EACCES\)$`. Restore `0o755` in a `finally` before the final `rmSync`.
- `tests/orchestrator/singleton.test.ts`: new part C2. `fixture()`, chmod `.git` `0o555`, spawn `node src/orchestrator.ts --root <root>` with `SE_LLM_TEAM_NO_WEBUI=1`, capture stdout and stderr, race the exit against a 10 s timeout. Assert exit code `1`, the output contains the pinned message and the `.git` path, and `!existsSync(kanbanDir(root))` (no lock, `.logs` or board mirror writes). Restore `0o755` in a `finally`. Kill on timeout.
- `pnpm test` exits 0.

# Acceptance

- `pnpm test` exits 0.
- With a read-only `.git` in a temp fixture, `orchestrator_start` returns the refusal text, starts no process, and creates no `.kanban` dirs.
- A direct `node src/orchestrator.ts --root <fixture>` exits `1` with the same message and leaves no `.kanban` dir.
- A writable repo (main checkout or linked worktree) starts exactly as today.
- An already-running daemon still gets the "Orchestrator already running" response even if `.git` is read-only.
- `gitWritableError` returns `null` for a writable linked worktree and names the per-worktree dir when it is read-only.
- No README or docs change; no new dependency.

# Constraints

- Change only `src/kanban.ts`, `src/tools.ts`, `src/orchestrator/main.ts`, `tests/kanban/git.test.ts`, `tests/mcp.test.ts`, `tests/orchestrator/singleton.test.ts`.
- Do not add a per-agent spawn check; startup only, per the user's decision.
- Do not change the non-git tolerance of the daemon or the existing `Cannot start the orchestrator: ...` error style for an unwritable `.kanban`.
- Pin the exact message prefix `Cannot start the orchestrator: .git is not writable at `; the reason is `<path> (<code>)`.
- Keep the probe file out of git's way and remove it on success.

# Notes

- Why a temp-file write instead of `access(W_OK)`: `access` can report writable on a read-only mount, for root, or when only metadata permissions are checked; a real write catches EACCES, EROFS and ENOSPC.
- Why both layers: the tool preflight gives the PM a visible refusal and prevents the fork; the daemon preflight covers direct starts and a `.git` that changes between the tool check and the daemon start. Both call one helper.
- Why not every agent spawn: the user chose startup only. A mid-run read-only flip still fails at the first git write; that is out of scope.
- The daemon check runs after the worktree self-reap, so a finished worktree daemon still exits 0 instead of 1.

# Notes
## What changed
- `src/kanban.ts`: `gitWritableError(root)` resolves `--absolute-git-dir` and `--git-common-dir`, dedupes them, and returns `<dir> (<code>)` when an empty probe file cannot be written and unlinked. Null for a writable repo or a root git cannot resolve.
- `src/tools.ts`: `orchestrator_start` refuses after the already-running check and before the `.logs`/`.pids` mkdir/open. One description sentence added.
- `src/orchestrator/main.ts`: refuses after `reapIfTaskEnded()` and before `loadConfig` and `acquireLock`, with stderr message and `process.exitCode = 1`.
- `tests/kanban/git.test.ts`: main-checkout and linked-worktree refusal cases, both restored to `0o755` in `finally`.
- `tests/mcp.test.ts`: read-only `.git` spawns nothing, message pinned, plus the already-running reply stays first under a read-only `.git`.
- `tests/orchestrator/singleton.test.ts`: part C2, direct daemon start exits 1 and leaves no `.kanban` dir.

## Acceptance
- red before the source edit: `node tests/kanban/git.test.ts` exit=1 (missing export), `node tests/mcp.test.ts` exit=1 (spawn recorded), `node tests/orchestrator/singleton.test.ts` exit=1 (no exit within 10 s).
- green after the edit: `tests/kanban/git.test.ts` exit=0, `tests/mcp.test.ts` exit=0, `tests/orchestrator/singleton.test.ts` exit=0.
- caller suites green: `tests/tools.test.ts` exit=0, `tests/orchestrator/daemon.test.ts` exit=0, `tests/orchestrator/hub.test.ts` exit=0, `tests/orchestrator/worktree.test.ts` exit=0.
- Substitution: the Specs `pnpm test` line ran as those suites, not the aggregate script (write run).
- pre-commit `git diff --stat`: 6 files, 113 insertions, 8 deletions, no probe file and 0 leftover fixture daemons (`find`, anchored `pgrep`).
- commit `fix: refuse an orchestrator start when the git dir is not writable`: `git show --stat --oneline HEAD` shows the same 6 files and `git status --short` is clean after it.

## Live test: git-writable-preflight (merged d97d0ee)

- Tree: `/home/phamba/repos/se-llm-team/.worktrees/fix/356-git-writable-preflight`
- Driver: `/tmp/356-git-writable-preflight/driver.mjs`, wrapper: `/tmp/356-git-writable-preflight/run.sh`
- Runs: merged 3 (labels merged-1, merged-2, merged-3), control 1 (tree `/tmp/356-git-writable-preflight-pre`)
- Assumptions:
  - Every fixture is a fresh temp repo (`git init -b main`, local `user.name`/`user.email`, `commit.gpgsign false`), `HOME` points at a fixture dir so no global config is read, and `SE_LLM_TEAM_NO_WEBUI=1`.
  - The user-facing surface for `orchestrator_start` is the stdio MCP server (`node src/mcp.ts`, cwd = fixture); the pi extension calls the same `TOOLS.orchestrator_start` handler.
  - uid 1000 (not root), so `chmod 0o555` on the git dir yields a real EACCES without a read-only mount.
  - "no process started" = a `pgrep -af` scoped to the fixture root returns 0 and `.kanban`/`.kanban/.logs` are absent.
  - The already-running stand-in is a live `sleep 30` pid in `.kanban/.orchestrator.lock`.
  - Control cells carry per-run pids and fixture paths; the driver normalizes them to `pid N`, `$R` and `$T`.
  - Rows 3, 4, 5, 8 are guards: both trees show the same value, as Specs expects (unchanged behaviour).
  - No `*.test.ts` file and no suite was run; these are live runs of the merged code.
- Not exercised: the pi extension host (`index.ts`); a `.git` that turns read-only mid-run (out of scope per Specs); the web UI (not part of this change).

| # | Claim | Expected | Observed | Verdict | Control |
| --- | --- | --- | --- | --- | --- |
| 1 | read-only .git: orchestrator_start refuses and creates no .kanban | text=refusal kanban=absent logs=absent | text=refusal kanban=absent logs=absent | green | text=start kanban=present logs=present |
| 2 | the refusal is the pinned message and starts no daemon process | msg=exact procs=0 | msg=exact procs=0 | green | msg="Orchestrator starting (pid N), log: $R/.kanban/.logs/orchestrator.lo" procs=1 |
| 3 | already running still wins under a read-only .git (guard) | text=already procs=0 | text=already procs=0 | green | text=already procs=0 |
| 4 | a writable main checkout starts as today (guard) | text=start lock=present procs=1 | text=start lock=present procs=1 | green | text=start lock=present procs=1 |
| 5 | a writable linked worktree starts as today (guard) | text=start | text=start | green | text=start |
| 6 | gitWritableError: null on a writable linked worktree, names the per-worktree dir when read-only | writable=null readonly=names-wt-dir | writable=null readonly=names-wt-dir | green | writable=noexport readonly=noexport |
| 7 | a direct daemon start on a read-only .git exits 1 with the message and no .kanban | exit=1 msg=exact kanban=absent | exit=1 msg=exact kanban=absent | green | exit=alive msg="[$T] orchestrator started (root=$R, agent=pi, ba" kanban=present |
| 8 | a direct daemon start on a writable repo stays alive as today (guard) | exit=alive lock=present | exit=alive lock=present | green | exit=alive lock=present |
| 9 | the commit touches only the six allowed files: no README, docs or dependency change | files=src/kanban.ts,src/orchestrator/main.ts,src/tools.ts,tests/kanban/git.test.ts,tests/mcp.test.ts,tests/orchestrator/singleton.test.ts | files=src/kanban.ts,src/orchestrator/main.ts,src/tools.ts,tests/kanban/git.test.ts,tests/mcp.test.ts,tests/orchestrator/singleton.test.ts | green | files=(n/a: not a repo) |
| 10 | the orchestrator_start tool description states the refusal | desc=present | desc=present | green | desc=absent |

Verdict: green: 10/10 rows match the frozen expected cells across 3 merged runs
