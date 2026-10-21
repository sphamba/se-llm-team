---
name: "fix: clear the root SPECS.md link when a root-cwd agent exits"
priority: "low"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "root-specs-link-cleanup"
---

# Summary
clearContextSymlinks never runs for a root-cwd agent, so the root checkout keeps a SPECS.md symlink to a finished task. Make the cleanup fall back to the root and remove the link only while it still points at the exiting run's task file. Cover the splitter, which liveness never sees.

# Specs
## Need

`ensureContextSymlinks` points `<cwd>/SPECS.md` at `.kanban/<task file>` for every spawn, the root included. `clearContextSymlinks` (`src/orchestrator/spawn.ts:129-141`) takes it away again on agent exit, but it early-returns on `!task.worktree`, so a root-cwd run leaves the link behind.

Two roles run at the root: the splitter (`src/orchestrator/pipeline.ts:155`) and the integration-tester (`pipeline.ts:347`). Neither has a worktree. So the root checkout keeps a `SPECS.md` symlink to whatever task last ran there. Right now it points at `.kanban/000328_integration_of_323.md`, a finished task. Anyone who reads `SPECS.md` at the root sees stale task content.

The link is a convenience only. Root-cwd prompts already name the literal `.kanban/<file>` path and warn that the root link is shared (`src/orchestrator/spawn.ts:18-21`, #313), so removing it breaks no agent.

The user decided: clear it on every root-cwd exit, the same way a worktree is cleared.

## Specs

1. `clearContextSymlinks` in `src/orchestrator/spawn.ts`: derive the cwd from the task, falling back to the root.
   ```ts
   const cwd = task.worktree ? join(root, ".worktrees", task.worktree) : root;
   ```
   Delete the `if (!task.worktree) return;` line. Keep the existing `lstatSync(path).isSymbolicLink()` condition, so a real file is never removed.

2. Guard the shared root link. One root-cwd run can repoint the link while another root-cwd run is still alive (#313), so remove it only while it still points at the exiting run's task file:
   ```ts
   if (!task.worktree && (name !== "SPECS.md" || readlinkSync(path) !== join(".kanban", task.file))) continue;
   ```
   Place it after the `isSymbolicLink` check and before `rmSync`. `readlinkSync` is already imported. A worktree keeps today's unconditional removal.

3. The integration-tester is already covered by the two existing call sites (`src/orchestrator/liveness.ts:89` and `:186`), because `integration-testing` maps to that role and the task has an empty `worktree`.

4. The splitter is not covered: its task stays in `to-do`, which is no working state, so liveness never sees its pid. Add the cleanup where the pipeline sees the dead splitter pid, in the `if (SPLITTER_COMPLEXITIES.has(...))` block of `src/orchestrator/pipeline.ts` (around line 150-162): in the `entry.pid === 0` fall-through branch that follows "a dead splitter pid file means the Splitter ran and left the task in to-do", call `clearContextSymlinks(root, fresh);` before falling through to `ensureWorktree`. Add the import from `./spawn.ts` if it is missing.

5. Do not touch `ensureContextSymlinks`, `repointContextSymlink`, `ensureInfoExclude`, `cleanContextPaths`, or `stripContextSymlinks`. Another task owns the realpath guard.

6. Add a regression part to `tests/context-symlinks.test.ts`, after part CS5. Name it `// --- part CS6: a root-cwd run leaves no SPECS.md link behind ---`. Cover:
   - a fixture at the root with a real `AGENTS.md`; `ensureContextSymlinks(root, root, file, "integration-tester")` then `clearContextSymlinks(root, task)` with `task.worktree === ""`: `SPECS.md` is gone, `AGENTS.md` is still the real file.
   - the pointer-match guard: point the link at another task file, call `clearContextSymlinks` for a task with no worktree, and assert the link survives.
   - the worktree case is unchanged: links in `.worktrees/<branch>` are removed.

7. Check `docs/` for a claim that the root keeps a `SPECS.md` link after a run (`grep -rn "SPECS.md" docs/ README.md`). Update only a sentence that becomes false. Report the rest in `# Notes`, do not rewrite it.

## Acceptance

Run from the task worktree. Every command must exit 0.

1. `node tests/context-symlinks.test.ts`, with part CS6 in the output.
2. `node tests/orchestrator/spawn.test.ts`. Part AZ asserts that the root `SPECS.md` link exists during the run, so it must stay green. If it fails because of this cleanup, report the failing assertion in `# Notes` instead of weakening it.
3. `node tests/orchestrator/integration.test.ts`, the integration-tester spawn lane.
4. `! grep -q "if (!task.worktree) return;" src/orchestrator/spawn.ts`
5. `grep -q 'const cwd = task.worktree ? join(root, ".worktrees", task.worktree) : root;' src/orchestrator/spawn.ts`
6. `grep -q "clearContextSymlinks(root, fresh)" src/orchestrator/pipeline.ts`

# Notes
