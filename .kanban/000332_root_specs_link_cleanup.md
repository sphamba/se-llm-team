---
name: "fix: clear the root SPECS.md link when a root-cwd agent exits"
priority: "low"
state: "done"
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

## Done
- `clearContextSymlinks` now derives the cwd from the task and falls back to the root; the `!task.worktree` early return is gone. At the root it removes `SPECS.md` only while the link still points at `.kanban/<task.file>`, so a link that a live root-cwd run repointed survives. A worktree keeps the unconditional removal of both links.
- Splitter: `clearContextSymlinks(root, fresh)` sits in the `SPLITTER_COMPLEXITIES` fall-through of the to-do sweep, before `ensureWorktree`, with the import from `./spawn.ts`. The integration-tester needs no change, the two liveness call sites already cover it.
- `tests/context-symlinks.test.ts` part CS6 covers the root exit (link gone, real `AGENTS.md` untouched), the pointer mismatch (the link survives), and the unchanged worktree removal. Red first: `a root-cwd exit removes its SPECS.md link` failed with exit 1.
- A root exit removes only `SPECS.md`, never `AGENTS.md`, because `ensureContextSymlinks` returns early at the root and creates no role-notes link there.

## Acceptance
1. `node tests/context-symlinks.test.ts` exit 0, part CS6 and the updated summary line in the output.
2. `node tests/orchestrator/spawn.test.ts` exit 1, pre-existing: `timeout waiting for the integration task runs to done and folds into the mirror`. Base proof on HEAD 2273595: `git stash push -- src/orchestrator/spawn.ts src/orchestrator/pipeline.ts`, same suite, same wait, same last daemon line (`queued board report`). Not this diff.
3. `node tests/orchestrator/integration.test.ts` exit 0, the integration-tester lane smoke passed.
4. `! grep -q "if (!task.worktree) return;" src/orchestrator/spawn.ts` exit 0.
5. `grep -q 'const cwd = task.worktree ? join(root, ".worktrees", task.worktree) : root;' src/orchestrator/spawn.ts` exit 0.
6. `grep -q "clearContextSymlinks(root, fresh)" src/orchestrator/pipeline.ts` exit 0.
7. Docs unchanged: `grep -rn "SPECS.md" docs/ README.md` finds spawn-time claims only (`docs/agents-and-tools.md:7` "gets only the `SPECS.md` link", `:31` the tool error text), and no sentence says the root keeps the link after a run. `skills/se-llm-team/SKILL.md:19` and `docs/development.md:16` name the root cwd, not the link.

Review of d674e44 (first pass):
- `src/orchestrator/spawn.ts:131`: the cwd is `task.worktree ? join(root, ".worktrees", task.worktree) : root`, and the root path removes only `SPECS.md`, only while `readlinkSync(path) === join(".kanban", task.file)` (`:138`), after the `isSymbolicLink` check (`:135`) and before `rmSync` (`:139`). A worktree keeps the unconditional pair removal. The `!task.worktree` early return is gone from `src`, and Spec 5's functions (`ensureContextSymlinks`, `repointContextSymlink`, `ensureInfoExclude`, `cleanContextPaths`) are untouched.
- `src/orchestrator/pipeline.ts:161`: `clearContextSymlinks(root, fresh)` is the last statement of the `SPLITTER_COMPLEXITIES` fall-through, before `ensureWorktree` (`:163`), with the import on `:7`. The integration-tester needs no new call because `src/orchestrator/liveness.ts:89` and `:186` already clear a task with an empty `worktree`.
- `tests/context-symlinks.test.ts:238`: part CS6 removes the root link and keeps the real `AGENTS.md` (`:243` pins the matching target), keeps a link repointed at another task (`:252`), and still removes both worktree links (`:259`), so the guard and the worktree path are both pinned to behavior, not to a message.
- Docs (Spec 7): `docs/agents-and-tools.md:7` and `:31` are spawn-time claims that stay true, and no sentence says the root keeps the link after a run, so no doc edit was needed.
Tests: exit=0 tests/context-symlinks.test.ts (CS6 in the run, summary line updated) | exit=0 tests/orchestrator/integration.test.ts | exit=1 tests/orchestrator/spawn.test.ts, pre-existing and reproduced on this tree by copying `main`'s `spawn.ts` and `pipeline.ts` over HEAD's: same first line `timeout waiting for the integration task runs to done and folds into the mirror`, same last daemon line `queued board report`, then restored (tree clean).
Note (non-blocking): the guard compares raw link text, so it clears only a relative `.kanban/<file>` target; a hand-made or future absolute-target root link survives. Upgrade path: compare `resolve(dirname(path), readlinkSync(path))` with `join(root, ".kanban", task.file)` the day a spawn writes an absolute target.

## Live test (d674e44, control 2273595)

Driver `/tmp/t332/driver.mjs` and `/tmp/t332/run.sh`. Fixtures, logs, and results are under `/tmp/t332`. The merged tree is the task worktree, the control tree is `git archive 2273595` (the commit before the feature). Scored merged runs: 3 (the first is the smoke run), control runs: 2. Saved agent pids per run: 5, all dead at cleanup. Rows come from `/tmp/t332/results.*.json` through one `node driver.mjs report` call.

| id | claim | expected | actual | control | pass |
| --- | --- | --- | --- | --- | --- |
| C1 | a dead splitter pid makes the sweep remove the root SPECS.md link | link present before the sweep, absent after; real root AGENTS.md untouched | before=link -> .kanban/000001_root_splitter_link.md; after=absent; AGENTS.md=real file | before=link -> .kanban/000001_root_splitter_link.md; after=link -> .kanban/000001_root_splitter_link.md; AGENTS.md=real file | PASS |
| C2 | an integration-tester root run ending removes its own root SPECS.md link | link absent after the poll; task moved to done | before=link -> .kanban/000001_root_integration_link.md; after=absent; state=done | before=link -> .kanban/000001_root_integration_link.md; after=link -> .kanban/000001_root_integration_link.md; state=done | PASS |
| C3 | a root exit keeps a link that another live root-cwd run repointed | link still -> task-b after task-a clears; own pointer clears | repointed=link -> .kanban/task-b.md; after task-a clear=link -> .kanban/task-b.md; after task-b clear=absent | pre-fix removes no root link, so the guard cannot fail there (pre-fix: repointed=link -> .kanban/task-b.md; after task-a clear=link -> .kanban/task-b.md; after task-b clear=link -> .kanban/task-b.md) | PASS |
| C4 | a worktree exit still removes both context links | both links present before, absent after | before: SPECS.md=link -> .kanban/task-a.md; AGENTS.md=link -> .kanban/AGENTS.developer.md; after: SPECS.md=absent; AGENTS.md=absent | worktree path unchanged by this diff (pre-fix: before: SPECS.md=link -> .kanban/task-a.md; AGENTS.md=link -> .kanban/AGENTS.developer.md; after: SPECS.md=absent; AGENTS.md=absent) | PASS |
| C5 | a live root-cwd splitter keeps the root SPECS.md link until its run ends | link -> .kanban/<splitter task> while the splitter pid is alive | link=absent; splitter alive=true | link=link -> .kanban/000001_live_splitter_link.md; splitter alive=true | FAIL |

Finding:
- C5 FAIL, reproduced in the last merged run: with the daemon, a live splitter loses the root `SPECS.md` link. After the splitter spawn, the first poll pass removes the link while the splitter pid is alive (`RESULT C5 FAIL actual="link=absent; splitter alive=true"`). The control keeps it (`link -> .kanban/000001_live_splitter_link.md; splitter alive=true`). Cause from code read: the poll uses the per-task pid name `<slug>` for a `to-do` task (`src/orchestrator/liveness.ts`, `pidName = lane?.pid ?? slug`), the splitter writes `<slug>.splitter.pid`, so the poll reads pid 0, takes the dead-pid path, and with the new root fallback in `clearContextSymlinks` removes the link. Effect: the link does not live for the whole root-cwd run, and the pipeline cleanup at the splitter exit has nothing left to remove. No agent breaks, because root-cwd prompts name the literal `.kanban/<file>` path. This contradicts the Summary intent (clear the link on the root-cwd exit) and the Spec 7 premise that the root link exists during the run, but `spawn.test.ts` part AZ stays green because it does not run the poll.

Assumptions:
- C1 replays the sweep with `rescan(root, cfg, true)` from the merged tree instead of the daemon, because the daemon poll also clears the link for a `to-do` task (C5) and would confound the exit-path proof. A sweep claim may call `rescan` directly.
- C2 and C5 use the real daemon (`node src/orchestrator.ts --root <fixture> --rescan-seconds 1 --poll-minutes 0.01`) with a fake agent set by the `agent` config key, a fixture `HOME` and `XDG_CONFIG_HOME`, and `SE_LLM_TEAM_NO_WEBUI=1`.
- In C2 the root link before the daemon start is written with the production `ensureContextSymlinks(root, root, file, "integration-tester")`, because the integration lane needs the full `to-integration-test` path. The poll log line `agent exited 0, integration-testing -> done` shows the real cleanup trigger.
- C3 and C4 replay `ensureContextSymlinks` and `clearContextSymlinks` in-process. The guard scenario (a second live root run repoints the link) has no deterministic daemon ordering.
- Fixture tasks come from `createTask` and `setState`. The dead lane pid is a node process that exited before its pid file was written.
- C4's control is the same result, because this diff does not change the worktree path.

Not exercised: the unit suite gates in the Specs (the live-test contract forbids them), a real splitter decomposition with a real `pi` agent, the hub and browser (the change touches no served surface), and non-Linux pid liveness.

