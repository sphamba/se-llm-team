---
name: "fix: refuse to spawn the orchestrator when .git is not writable"
priority: "medium"
state: "backlog"
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
