---
name: "fix: stop root-cwd agents from editing another task through the shared SPECS.md link"
priority: "high"
state: "to-live-test"
worktree: "fix/313-root-specs-pointer"
issuer: "#305"
complexity: "simple"
shortName: "root-specs-pointer"
---

# Summary
The root SPECS.md is one shared symlink, re-pointed by every root-cwd spawn. Splitters and the integration-tester both run at the root and can overlap, so the later spawn steals the link. A task-file write or a kanban call through it can land on another task. Pass the literal `.kanban/<file>` path in the prompt and use it for every read, write and kanban call.

# Specs
## Problem

`ensureContextSymlinks` (`src/orchestrator/spawn.ts:51`) re-points one root `SPECS.md` symlink at every root-cwd spawn. Two roles run at the project root:

- The Splitter (`src/orchestrator/pipeline.ts:152`, cwd = root). It writes its no-split note and its decomposition through SPECS.md (`agents/splitter.md:3`, `:13`) and omits the `file` argument of the kanban tools, which resolve through the same link.
- The integration-tester (`src/orchestrator/pipeline.ts:339`, cwd = root). It appends `# Notes` and `# Open questions` through SPECS.md (`agents/integration-tester.md:3`, `:9`).

Splitters run per task and can overlap the integration lane. The later spawn steals the link from the running agent.

Evidence from #305's integration run: the root link moved from `.kanban/000305_integration_of_303.md` to `.kanban/000308_scope_covered_summaries.md` at 13:53:03 local, during the run. That tester noticed and used the literal path. A task-file write or a kanban call through the link lands on another task.

## Fix

1. `renderPrompt` (`src/orchestrator/spawn.ts:14`) takes the task file and a root-cwd flag. For a root-cwd run it prepends one line before the role text:

   "Task file: `.kanban/<file>` in this checkout. The root `SPECS.md` is a shared link that another root-cwd spawn can re-point at any time. Read and write the task file only through `.kanban/<file>`, and pass `<file>` as the `file` argument of every kanban_* call."

2. `spawnAgent` passes `task.file` and `cwd === root` to `renderPrompt`.
3. Worktree runs keep today's prompt. One task per worktree, so their SPECS.md cannot move.
4. Keep the symlink itself. Do not change the worktree, the merger, the developer, the reviewer or the live-tester behavior.

## Tests

In `tests/orchestrator/spawn.test.ts`:

- The splitter prompt holds the literal `.kanban/<file>` path and the "shared link" sentence.
- A developer prompt (worktree cwd) does not hold that line.
- The existing link assertions stay green.

Run `node tests/orchestrator/spawn.test.ts`.

## Out of scope

- No per-run cwd, no clone or symlink farm.
- No change to `ensureContextSymlinks`, the role files or the board state machine.
- No cleanup of the old link.

# Notes

## literal task path in the root-cwd prompt

- `renderPrompt` takes two new optional arguments, `taskFile` and `rootCwd`, so the existing 3-argument call sites in `merge.test.ts` and `context-symlinks.test.ts` stay unchanged. A root-cwd run gets one line prepended: the Specs sentence verbatim, with `.kanban/<file>` and `<file>` substituted. A worktree run renders the same prompt as before.
- `spawnAgent` passes `task.file` and `cwd === root`. The `file` argument of every `kanban_*` call now needs no link.
- Pin in `tests/orchestrator/spawn.test.ts` (new closing part): the splitter prompt holds the literal path, the shared-link sentence and the kanban `file` argument. A developer prompt holds no shared-link line and equals today's prompt. Ran red before the fix with the same assertions, green after.
- `node tests/orchestrator/spawn.test.ts` exits 0 and prints `root-cwd prompt task path passed`.
- The suite was red in three earlier runs at base commit `edf27f2`, before my test edit too: part A timed out on "the integration task runs to done and folds into the mirror". Those runs overlapped other suite runs and stale `/tmp/orch-smoke-*/fake-agent.cjs` processes were alive. The last solo run passed every part, so the timeouts were load flakiness, not a code fault.
- The worktree base was one commit behind `main`; `git merge --ff-only main` brought in `edf27f2` (`fix: end the integration lane at done on every lane end`), which part A depends on.

Review of 84a0c8c (first pass):
- `src/orchestrator/spawn.ts:19` prepends the Specs sentence verbatim for a root-cwd run with the literal `.kanban/<file>` and the bare `<file>`; `src/orchestrator/spawn.ts:233` passes `task.file` and `cwd === root`, the same flag the piPrompt branch at `:227` already uses.
- Only `src/orchestrator/pipeline.ts:152` (splitter) and `:339` (integration-tester) spawn with cwd = root, so the merger, developer, reviewer and live-tester prompts keep today's text (Specs 4).
- The kanban `file` argument is a bare name (`src/tools.ts:89`), resolved through `kanbanDir` (`src/kanban.ts:235`), so the prompt's "pass `<file>`" instruction matches the tool contract.
- `tests/orchestrator/spawn.test.ts:586` asserts the literal path, the shared-link sentence, the kanban `file` argument, and an unchanged worktree prompt.
- Tests: `node tests/orchestrator/spawn.test.ts` exit=1 at HEAD, and exit=1 again with both changed files reverted to main: part A times out on "the integration task runs to done and folds into the mirror", so the red predates this diff and the new closing part never executes; an isolated probe of `renderPrompt` with the same arguments returns the exact line for the splitter and the integration-tester and the 3-argument prompt for a worktree cwd.
- Non-blocking: part A is red on main by the sweep, not by load, so the `# Notes` "load flakiness" reading is wrong: one sweep that moves two tasks to done issues one whole-board commit, and the identical-tree guard in `commitKanban` (`src/orchestrator/board.ts:60`) then drops the second `kanban: done <file>` subject (proved with a two-file `commitKanban` probe); the upgrade is to assert one settled mirror head or to commit per file, in a separate task.
- Non-blocking: the new assertions sit last, after part A, so a part A timeout hides them; moving that block to the top of the file keeps it runnable.

# Open questions
- Assumption: the root-cwd flag is exactly `cwd === root`, so only the splitter and the integration-tester take the new line (Specs 2 and 3).
