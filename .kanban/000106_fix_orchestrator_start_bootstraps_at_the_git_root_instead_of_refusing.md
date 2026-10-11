---
name: "fix: orchestrator_start bootstraps at the git root instead of refusing"
priority: "critical"
state: "backlog"
worktree: ""
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
