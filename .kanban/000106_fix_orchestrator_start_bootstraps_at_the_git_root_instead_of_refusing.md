---
name: "fix: orchestrator_start bootstraps at the git root instead of refusing"
priority: "critical"
state: "to-merge"
worktree: "fix/106-orchestrator-start-bootstraps"
---

# Summary
The orchestrator_start tool refuses ("No .kanban board in this project") when the working directory has no .kanban, even though the daemon itself self-creates everything at startup. Resolve the git root from the working directory and spawn the orchestrator there, so a repo without .kanban bootstraps automatically and a subdirectory of a repo that has a board reuses the root board.

# Specs
User decisions (settled 2026-10-11 via structured dialog): resolve the git root; non-git directories still refuse, with a clear message; scope is the pi tool only (index.ts).

Facts (verified 2026-10-11 by an explorer):
- The refusal is index.ts:141 in orchestrator_start's execute: `if (!existsSync(board(ctx))) return text("No ${board(ctx)} board in this project")` where board(ctx) = kanbanDir(ctx.cwd) = {ctx.cwd}/.kanban (index.ts:16). The spawn is at index.ts:146: spawn(process.execPath, [join(extDir, "src", "orchestrator.ts"), "--root", ctx.cwd], {detached: true, stdio: ["ignore", log, log]}).
- The daemon needs nothing pre-existing: acquireLock (src/orchestrator.ts:841-843) runs mkdirSync(kanbanDir(root), {recursive: true}) and writes .kanban/.orchestrator.lock; main() creates .kanban/.logs and .kanban/.pids; bootstrapBoard (:569) seeds the board ref from origin/meta/kanban on fresh clones; the first board commit happens automatically on the first task create (commitKanban :252, plumbing onto refs/heads/meta/kanban, worktree untouched).
- orchestrator_status/stop/poke (index.ts:227-246) read the daemon pid from the lock under board(ctx) - the same kanbanDir(ctx.cwd).

Changes (index.ts only):
1. Add a small shared helper, e.g. resolveRoot(cwd): run `git -C <cwd> rev-parse --show-toplevel`; on success return {root: <trimmed toplevel>}; on failure return a not-git marker. Use it in ALL FOUR tools that touch the board path - orchestrator_start, orchestrator_status, orchestrator_stop, orchestrator_poke - so a session started from a subdirectory resolves the same git root everywhere.
2. orchestrator_start: replace the existsSync guard with the resolution. Git root found: spawn with --root set to the resolved root (not ctx.cwd) - the daemon then bootstraps .kanban at the repo root itself (mkdirs, seed, first board commit on first task). No mkdir needed in the tool.
3. Not a git repository: still refuse, with a clear message naming the real problem, e.g. "Not a git repository: agents cannot run without git (worktrees, branches, board commits). No orchestrator started." Keep the existing message style; do not spawn.
4. Git repo WITH .kanban at the root: behavior preserved - the resolved root is the same board the daemon already manages; starting from a subdirectory of such a repo now works instead of refusing.
5. Tests: extract the resolution into an exported helper and unit-test it (temp git repo via git init, temp plain dir): root found, not-git marker returned; if the tools are testable, one assert that orchestrator_start on a fresh temp git repo spawns with --root = the temp repo. Extend the existing test file that fits (src/orchestrator.test.ts has the temp-dir fixture pattern, :14-16).

Acceptance:
- orchestrator_start on a git repo without .kanban boots the daemon at the repo root; the board comes up empty and usable.
- orchestrator_start/status/stop/poke from a subdirectory all resolve the repo root's board and lock.
- A non-git directory refuses with the clear message; nothing spawns.
- node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts green.

Constraints:
- Files: index.ts (+ its test). No src/ changes; the daemon already self-creates.
- Normal case unchanged: pi launched at the repo root resolves the same root as today.

# Notes
- Committed e763866 on fix/106-orchestrator-start-bootstraps (index.ts, new index.test.ts).
- index.ts: exported resolveRoot(cwd) runs `git -C <cwd> rev-parse --show-toplevel` (stderr piped, output trimmed) and returns {root} or {root: null}. orchestrator_start returns the specified refusal text when no root exists, otherwise spawns `--root <root>`. orchestrator_status/poke/stop resolve the same root, falling back to ctx.cwd when there is no git root, so their behavior in a non-git directory is unchanged.
- The mkdir of .kanban/.logs and .pids stays, because the log fd must exist before the spawn and the daemon creates those dirs only after it starts. It is wrapped in try/catch so an unusable .kanban path (for example a dangling symlink) returns "Cannot start the orchestrator: ..." instead of throwing. The removed existsSync guard used to cover that case.
- kanban_* tools and the session board watcher still use ctx.cwd. The specs scope the root resolution to the four orchestrator tools, so a session in a subdirectory still gets a subdirectory board from kanban_create.
- New index.test.ts (root, next to index.ts) tests resolveRoot (git root, subdirectory, plain dir), orchestrator_start from a subdirectory (stubbed spawn records ["--root", <repo>]), the non-git refusal, the unusable .kanban path, and status/poke/stop from a subdirectory against the root board and lock. It stubs @earendil-works/pi-ai, typebox and node:child_process with node:module registerHooks, because pi loads index.ts with jiti and plain node cannot resolve the pi packages. A separate file was chosen over extending src/orchestrator.test.ts so the hooks never leak into that suite, and the specs constrain the change to index.ts plus its test.
- Verified green: node index.test.ts, node src/kanban.test.ts, SE_LLM_TEAM_NO_WEBUI=1 node src/orchestrator.test.ts, node src/webui.test.ts.
- Known limit, conformant with the spec's prescribed command: --show-toplevel inside a linked git worktree resolves the worktree root, not the main checkout (git-common-dir would be the main root). Orchestrated worktrees have .kanban symlinked to the main board, so the lock dedupes there. A follow-up task could fold worktrees into the main root if the PM wants that.
- Not changed on purpose: README Checks still lists only src/kanban.test.ts (pre-existing staleness), and orchestrator_wait still uses ctx.cwd (the specs name exactly four tools).

## 2026-10-11, reviewer
- No fixes made. Commit e763866 matches the Specs: resolveRoot is exported and used by all four orchestrator tools, the refusal text is exact, and the spawn passes --root <resolved root>.
- All suites green: node index.test.ts, node src/kanban.test.ts, SE_LLM_TEAM_NO_WEBUI=1 node src/orchestrator.test.ts (exit 0), node src/webui.test.ts.
- End-to-end check with the real tool, no stubs (pi packages resolved from the pi install), in a throwaway git repo: orchestrator_start spawned the daemon at the repo root, and the daemon wrote .kanban/.orchestrator.lock and .kanban/.logs/orchestrator.log with root=<repo>. A separate daemon run on a fresh git root booted an empty board, and the first createTask mirrored "kanban: create ..." onto refs/heads/meta/kanban. Test daemons were stopped and temp dirs removed.
- The daemon uses no process.cwd(), so the spawn cwd is irrelevant. The root comes only from --root.
- waitForBoardCommits resolves git-common-dir itself, so orchestrator_wait works from a subdirectory although it still passes ctx.cwd. The four-tool scope holds.
- .worktrees/.../.kanban is a symlink to the main board, so the linked-worktree caveat in the earlier Notes is correct for orchestrated worktrees.
- The kept mkdir of .logs/.pids is not the board mkdir that Specs item 2 excludes, because openSync of the log needs .logs before the spawn. Accepted.
- The non-git assertion in index.test.ts assumes that the temp dir is not inside a git repo (true on a normal tmpdir). Not a product defect.
- index.test.ts is absent from README Checks, but that matches the existing staleness (orchestrator.test.ts and webui.test.ts are also absent). The Specs constrain the change to index.ts plus its test, so no README edit was made.
- Known limits already noted above stand and do not block: kanban_* tools stay on ctx.cwd (spec-scoped), and linked worktrees resolve to the worktree root.

## 2026-10-11, live-tester
- No fixes made. Result: PASS. Live test exercised the real spawned daemon (no spawn stub), from the worktree /home/phamba/repos/se-llm-team/.worktrees/fix/106-orchestrator-start-bootstraps at commit e763866.
- Flow 1 (bootstrap): throwaway git repo with no .kanban, orchestrator_start called from sub/dir. Returned "Orchestrator starting (pid N), log: <repo>/.kanban/.logs/orchestrator.log". The daemon created .kanban at the repo root (lock, .logs, .pids); no .kanban appeared in sub/dir. A createTask at the root made refs/heads/meta/kanban appear, so the board is empty and usable.
- Flow 2 (subdirectory resolves the root board and lock): orchestrator_status from sub/dir returned running (pid N); board: {} against the root lock, then the root board after the task. orchestrator_poke from sub/dir wrote <repo>/.kanban/.poke. orchestrator_stop from sub/dir sent SIGTERM to the root pid and the daemon exited. A restart at the repo root spawned a fresh daemon and status from the root returned board: {"backlog":1}, matching the pre-change normal case.
- Flow 3 (non-git refuses): orchestrator_start in a plain temp dir returned exactly "Not a git repository: agents cannot run without git (worktrees, branches, board commits). No orchestrator started." and created no .kanban.
- Unit suites green: node index.test.ts, node src/kanban.test.ts, node src/webui.test.ts, and SE_LLM_TEAM_NO_WEBUI=1 node src/orchestrator.test.ts (exit 0).
- Residual risk, no task raised because the Specs scope it and the reviewer already accepted it: a session in a subdirectory now boots the orchestrator on the root board, but kanban_create still writes to ctx.cwd/.kanban, so tasks created from that subdirectory go to a different board than the daemon watches. The old refusal at least made the mismatch visible. Same shape as the linked-worktree limit: --show-toplevel in a linked worktree resolves the worktree root, not the main checkout.