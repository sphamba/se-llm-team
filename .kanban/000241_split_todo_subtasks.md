---
name: "feat: split to-do tasks into subtasks via a Splitter agent"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "split-todo-subtasks"
---

# Summary
Add a Splitter agent stage: when a moderate or complex task promotes to-do -> doing, the orchestrator spawns a Splitter that either decomposes the task into subtasks (the parent becomes a simple re-check task blocked by them, back in backlog) or leaves it for the Developer. Splitting only pays when parallel work saves more than the per-subtask pipeline overhead.

# Specs
# Problem
Big tasks run as one Developer run. A moderate or complex task may decompose into independent pieces that would run as parallel lanes, but the pipeline has no way to split a task. Add a Splitter agent stage to the promote path.

# Decided design (user, grill-me interview)

## Trigger
- In `startTodo()` (`src/orchestrator/pipeline.ts:27`, called from the `rescan()` state loop ~line 342): when the task being promoted to-do -> doing has complexity moderate or complex, do NOT `setState(doing)` + spawn the Developer. Instead spawn a Splitter agent for the task; the task stays in state to-do while the Splitter runs.
- trivial and simple tasks keep today's path (straight to Developer).
- The Splitter runs detached like the other agents; the rescan continues. One Splitter per task: pid guard on a splitter-specific pid file `.pids/<slug>.splitter.pid` (reuse `writePid`/`pidAlive`), with exit file `.pids/<slug>.splitter.exit`. Keys stay distinct from the Developer's `.pids/<slug>.pid` / `.pids/<slug>.exit`, so the liveness `working.success` read for a later Developer never picks up a stale splitter exit.
- While the Splitter pid is alive, `rescan()` skips the task: no double-spawn, no early fallback.

## Split path (Splitter decides the task should be split)
The Splitter (kanban tools are available to spawned agents) performs steps 1-4 as one unit, then exits 0. If it cannot complete them, it must leave the task untouched in to-do (the fallback then routes it to a Developer as one piece):
1. Creates the subtasks with `kanban_create` in state to-do:
   - issuer `#<parent num>`, priority inherited from the parent, complexity judged per subtask (trivial to complex).
   - Subtask Specs are complete (no openQuestions) so they promote: each carries its slice of the parent's work.
   - Names use the normal type prefix and a shortName derived from the parent's shortName plus the piece.
2. Rewrites the parent with `kanban_update`: Summary and Specs become the verification scope only (check that the sub-tasks were correctly addressed against the original goal), complexity -> simple.
3. Sets the parent's `blockedBy` to the subtask refs (`kanban_update`, comma-joined `#<num>`; `assertNoBlockCycle` guards cycles).
4. Moves the parent to backlog with `kanban_set_state`.
5. The parent re-promotes through the existing machinery: `promoteBacklog()` gates on blockers satisfied (`BLOCKER_SATISFIED` = done, to-live-test, live-testing), so it re-promotes when every subtask is done or in live-test. At simple complexity the Splitter never re-triggers on it; a Developer runs the re-check; then the normal review -> merge -> live-test pipeline.

## Recursion
- Allowed: a subtask with moderate or complex complexity gets its own Splitter pass when it promotes to-do -> doing.
- The Splitter prompt keeps depth shallow: it splits only when the work genuinely decomposes; every split lowers the scope. The parent re-check at simple complexity terminates chains.

## Splitting cost rule (user decision)
- The Splitter prompt instructs: only split when the work genuinely parallelizes and the pipeline overhead each subtask adds (its own review pass, merge cycle, live test) does not exceed the time and effort saved by parallel work; prefer fewer subtasks when in doubt. No enforced cap and no count rule - the cost judgment is the guidance.

## No-split / failure path
- The Splitter never touches the task state on a no-split task. It appends a no-split note to `# Notes` in SPECS.md (same task-file edit pattern as the Developer) and exits 0.
- The orchestrator's fallback (in the rescan state loop): a to-do task with moderate/complex complexity whose Splitter already ran (splitter pid file present, pid dead) and is still in to-do -> `setState(doing)` + spawn the Developer as today.
- A Splitter that crashes or exits without deciding leaves the task in to-do; the same fallback rescues it. No Splitter respawn, no dead-counter bump.

## Prompt / config
- New default role prompt `agents/splitter.md` (rendered by `renderPrompt`); project override `.kanban/AGENTS.splitter.md` auto-created via `ensureRoleNotes`; the task arrives via the cwd `SPECS.md` symlink.
- Per-role/complexity model config works with no code: `roles.splitter.<complexity>.model` -> `roles.splitter.model` -> global `llm.model` (`resolveLlm` is role-string-generic).
- Update the `orchestrator_start` tool description (`src/tools.ts`) to list the Splitter role.
- No new state: to-do covers the Splitter window; no webui state changes needed.

# Acceptance criteria
- New tests in `tests/orchestrator.test.ts` using the existing patterns (`roleStub()` keyed off the "Splitter agent" prompt, `fixture()` boards, `runDaemon()` with `SE_LLM_TEAM_NO_WEBUI=1`):
  - a moderate to-do task with a splitting stub -> subtasks created in to-do, parent moved to backlog with the subtask refs in blockedBy and complexity simple, and the parent re-promotes once the stubbed subtasks satisfy;
  - a moderate to-do task with a no-split stub -> the orchestrator moves it to doing and spawns the Developer;
  - a simple to-do task -> straight to Developer, no Splitter spawn;
  - a crashed splitter stub (exit 1) leaving the task in to-do -> fallback to doing + Developer;
  - no double-spawn while the Splitter pid is alive.
- `node tests/orchestrator.test.ts` passes.
- `pnpm test` passes.

# Notes
