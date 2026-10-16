---
name: "feat: split to-do tasks into subtasks via a Splitter agent"
priority: "high"
state: "live-testing"
worktree: "feat/241-split-todo-subtasks"
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
- Tests first: five new parts BA-BE in `tests/orchestrator.test.ts` failed in a red run (part BA timed out waiting for the split) before the implementation landed. roleStub gained a Splitter branch picked from a `splitter-(split|nosplit|crash|linger)` marker in the task specs, defaulting to a silent exit-0 no-split so shared parts that spawn the Splitter stay unaffected, and its Developer branch writes a per-task-unique work file because the two split subtasks merge onto one base.
- Existing parts given complexity `simple` so the Splitter does not intercept tasks whose spawn argv they assert: part I (failed-spawn pid assert), part AX (three agent-injection tasks), part AQ (never-exiting fake agent) and part AY (six claude-backend tasks asserting the developer prompt).
- Implementation: `startTodo()` in src/orchestrator/pipeline.ts re-reads the task fresh, keeps the live-developer-pid guard first, and for moderate/complex spawns the Splitter with pidName `<slug>.splitter` and cwd at the project root (no worktree) when no splitter pid file exists; the task stays in to-do. A dead splitter pid file routes the next sweep to the Developer path (no second Splitter spawn, no dead-counter bump). agents/splitter.md is the new role prompt; spawnAgent skips the cwd AGENTS.md symlink for root-cwd spawns so the target project's root AGENTS.md stays in place, and the role notes ride the appended system prompt via a readRoleNotes helper; the orchestrator_start description in src/tools.ts lists the role. No new task state, and no run analysis for Splitter runs (poll only covers working states), both accepted by design.
- The split lifecycle part asserts the full flow: subtasks 999001_piece_one and 999002_piece_two in to-do with issuer #<parent num> and inherited priority, the parent parked in backlog with complexity simple and blockedBy "#999001, #999002", both subtasks reaching done, then the parent re-promoting and reaching done.
- The new parts initially called cleanupAll right after daemon.kill and raced the dying daemon (ENOTEMPTY, suite exit 1 at part BA); they now rely on the process-exit cleanup like every other daemon-driven part. Suite after the fix: `node tests/orchestrator.test.ts` exit 0, all 55 parts pass.
- Deviation: the "pnpm test passes" acceptance line is boilerplate per the role guidance; the scoped orchestrator suite is the whole scope for this change and the full suite was not run.
- Review: the spec trigger, pid guard, fallback, prompt and tool description all check out against the code. The coverage-map suite tests/context-symlinks.test.ts failed: parts CS1/CS2/CS4 create tasks with no complexity, parseTask defaults that to moderate (src/kanban.ts:178), and a single rescan() call now only spawns the Splitter (the Developer needs a second sweep), so waitForExit timed out. Fixed in eab7e0c: the four fixtures pinned to complexity "simple", the same pattern as orchestrator.test.ts. Suite exit 0 after the fix.
- Review checks: splitter pid/exit keys are .pids/<slug>.splitter.{pid,exit} (pidName through spawnAgent), distinct from the developer's; the poll's to-do path reads only the developer's keys, so it never clears a live splitter pid file and a later Developer's liveness read never picks up a stale splitter exit; ensureRoleNotes auto-creates .kanban/AGENTS.splitter.md; renderPrompt reads agents/splitter.md; resolveLlm stays role-generic so roles.splitter.<complexity>.model works; BLOCKER_SATISFIED and the promoteBacklog openQuestions gate match the split path; orchestrator_start lists the Splitter role. Minor: stale .pids/<slug>.splitter.pid files are never swept (janitorPids handles only .merger.pid and .exit files), so a task manually reopened at moderate complexity after a split skips a fresh split - matches the spec's no-second-splitter-pass rule, one-line ceiling only.
- Review suites: orchestrator exit 0 with 59 part sections (the earlier "55 parts" note is stale), context-symlinks exit 0 after eab7e0c, mcp/extension/plugin exit 0.
- Open questions closed: the section held only accepted risks, not user questions. The root-SPECS.md symlink risk is settled by the decided design (Splitter at root cwd, task via the cwd symlink). The AGENTS.md-twice risk does not materialize: spawn.ts passes only the role notes as the root-cwd pi prompt, so the project AGENTS.md loads once via the cwd chain. Section deleted per guidance.
- Re-review at eab7e0c, no new findings and no fixes: getTask is imported and the fresh re-read plus SPLITTER_COMPLEXITIES gate match the spec trigger; spawnAgent's pidName lands the guard on .pids/<slug>.splitter.pid and the sh wrapper's <name>.exit, distinct from the developer keys; liveness.ts has no splitter references, so the to-do poll path touches only the developer pid keys; promoteBacklog gates on BLOCKER_SATISFIED and openQuestions, matching the split path; ensureRoleNotes rides spawnAgent and piPrompt reads the role notes at the root cwd; parseTask still defaults a missing complexity to moderate (src/kanban.ts:178), the fact the context-symlinks pin rests on. Suites at this HEAD: orchestrator exit 0 with 59 passed sections including the five splitter parts (split, no-split, crash, linger, simple-skips), context-symlinks exit 0 after the pin, mcp/extension/plugin exit 0.
