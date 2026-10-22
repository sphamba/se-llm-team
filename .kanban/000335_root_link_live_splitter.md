---
name: "fix: the root link cleanup must not fire for a live splitter"
priority: "medium"
state: "doing"
worktree: "fix/335-root-link-live-splitter"
issuer: "user"
complexity: "moderate"
shortName: "root-link-live-splitter"
---

# Summary
#332 regressed the splitter: the liveness poll for a to-do task looks up the pid name as the bare slug while the splitter's pid file is <slug>.splitter, so it treats the live splitter as dead and deletes the root SPECS.md link the splitter is reading. split.test.ts is red at d674e44 and at HEAD, green before #332. Pass the root cleanup as an explicit opt-in from the three call sites that know the root-cwd pid is gone.</summary>
<complexity>moderate</complexity>
<priority>critical</priority>
<issuer>#334</issuer>
<specs>## Root cause (verified, deterministic)

`clearContextSymlinks` (src/orchestrator/spawn.ts) lost its `if (!task.worktree) return;` guard in #332, so for a task with no worktree it now derives `cwd` as the project root and deletes the root `SPECS.md` link while it still points at that task's file.

That fires for a `to-do` task from the liveness poll at src/orchestrator/liveness.ts:186. The poll resolves its pid name at liveness.ts:149 as `lane?.pid ?? slug`. A `to-do` task has no lane, so the name is the bare slug, but the splitter's pid file is `<slug>.splitter` (pipeline.ts:155 passes pidName `${slug}.splitter`). The lookup misses, `pidAlive(0)` is false, and the "agent terminated" path clears the link about 1 s after the splitter was spawned.

The splitter reads its task through the root `SPECS.md` link, so it fails, exits 0, and the next sweep takes the dead-splitter decline path (pipeline.ts:158-161) and spawns the Developer directly. The parent never splits into subtasks.

Evidence: `node tests/orchestrator/split.test.ts` is red at d674e44 (#332) and at c7b47c8 (#331+#332), green at 2273595 (the commit before #332). The root link is missing within 300 ms of the spawn while the splitter pid is alive, 3 of 3 observations. The new `clearContextSymlinks(root, fresh)` at pipeline.ts:161 is not the trigger: it runs only after the splitter already failed. #331 is not involved.

## Specs

1. Signature: `clearContextSymlinks(root: string, task: Task, opts?: { rootCwd?: boolean })`. Without `rootCwd`, the function is worktree-only, exactly as before #332: return when `!task.worktree` and never touch the root `SPECS.md`.

2. With `rootCwd: true` and no worktree, keep #332's behaviour: remove `<root>/SPECS.md` only while `readlinkSync` equals `join(".kanban", task.file)`, and never touch `<root>/AGENTS.md` or a real file.

3. Only three call sites pass the flag. Each keys on an exact pid name, never on a state or a path comparison:

| File | Line | Call |
| --- | --- | --- |
| src/orchestrator/liveness.ts | 186 | `clearContextSymlinks(root, task, { rootCwd: pidName === "integration-tester" })` |
| src/orchestrator/liveness.ts | 89 | `bounceDead` uses the same condition, so a killed integration-tester still loses its link |
| src/orchestrator/pipeline.ts | 161 | `{ rootCwd: true }`, reached only after the splitter's pid is gone |

`WORKING_STATES` gives `lane.pid` as `"integration-tester"` for an `integration-testing` task and `"merger"` for `merging`, so the condition can never fire for the merger, for a worktree task, or for a `to-do` task.

4. No other caller passes the flag. Do not reintroduce a state-only or cwd-only fallback: a poll miss on a `to-do` task must be unable to remove a live splitter's link.

## Tests

- `tests/context-symlinks.test.ts` part CS6: the two `clearContextSymlinks(root6, { ...task6, worktree: "" })` calls at lines 244 and 251 would become no-ops. Pass `{ rootCwd: true }` so those assertions keep their meaning.
- Add one regression case to that file: create a `to-do` task, write a live pid for `<slug>.splitter`, point the root `SPECS.md` at the task file, call the form without the flag, and assert the link survives. Then assert the flag form removes it.
- `node tests/orchestrator/split.test.ts` is the regression gate. It must go green.

## Notes

The live orchestrator daemon (pid 57964) started before these merges and holds the pre-#332 code in memory, which is the only reason the splitter still works. Do not restart the daemon as part of this task. Record in `# Notes` that a restart is needed after this merge.</specs>

# Specs


# Notes

Splitter: no split.

This is one contract change. The new `opts.rootCwd` parameter in `clearContextSymlinks` (`src/orchestrator/spawn.ts:142`) must land before the three callers can compile. The call sites in `liveness.ts:89`, `liveness.ts:186`, and `pipeline.ts:161` are three lines on one shared condition. The tests in `tests/context-symlinks.test.ts` and the gate `tests/orchestrator/split.test.ts` cover the same contract. Parallel subtasks would serialize on `spawn.ts` and collide in the same files. Three review, merge, and live-test cycles cost more than this diff.

Guidance for future Splitters: do not split a fix that changes one function signature or one shared predicate. The split regression gate is a single test run. Keep such a task as one unit.

After this merge, restart the orchestrator daemon (pid 57964 at task creation). It holds the pre-#332 code in memory. Do not restart it as part of this task.
