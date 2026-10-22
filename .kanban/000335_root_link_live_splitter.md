---
name: "fix: the root link cleanup must not fire for a live splitter"
priority: "medium"
state: "done"
worktree: ""
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

## What changed

- `clearContextSymlinks` (`src/orchestrator/spawn.ts:143`) takes `opts?: { rootCwd?: boolean }` and returns early when the task has no worktree and the flag is absent, so the worktree-only behaviour of pre-#332 is back. With `rootCwd: true` and no worktree, #332's behaviour stays: only a root `SPECS.md` whose `readlinkSync` equals `join(".kanban", task.file)`, never `AGENTS.md`, never a real file.
- `src/orchestrator/pipeline.ts:161` passes `{ rootCwd: true }`. It is reached only when the splitter pid file exists and its pid is dead (the dead-splitter decline path).
- `src/orchestrator/liveness.ts:89` (`bounceDead`) and `:186` (the poll's terminated-run path) pass `{ rootCwd: pidName === "integration-tester" }`. The splitter and the integration-tester are the only root-cwd spawns (`pipeline.ts:155` and `:349`); the merger runs in the task worktree.
- No other caller passes the flag. A `to-do` task has no lane, so `pidName` is the bare slug and the condition is false.

## Acceptance

- Tests (`tests/context-symlinks.test.ts`): the two CS6 no-worktree calls now pass `{ rootCwd: true }`, so their assertions keep their meaning. New part CS7 creates a `to-do` task, writes a live `<slug>.splitter` pid, points the root `SPECS.md` at the task file, calls the form without the flag and asserts the link survives, then asserts the flag form removes it.
- Red first: at c7b47c8 part CS7 fails with `ENOENT: no such file or directory, readlink '<root>/SPECS.md'` at the unflagged call (the bug, reproduced). After the fix it passes.
- `node tests/context-symlinks.test.ts` exit=0 (parts CS1-CS7). `node tests/orchestrator/split.test.ts` exit=0, the regression gate is green.
- Modified files: 4 (`src/orchestrator/spawn.ts`, `src/orchestrator/liveness.ts`, `src/orchestrator/pipeline.ts`, `tests/context-symlinks.test.ts`).

## Follow-up

- The live orchestrator daemon (pid 57964 at task creation) started before #332 and #335 merged and holds the pre-#332 code in memory, which is why the splitter still works there. Restart it after this merge. It was not restarted in this task, as the Specs require.

Review of 9d7fc83 (first pass):

- `src/orchestrator/spawn.ts:143-144`: the new `opts?: { rootCwd?: boolean }` and `if (!task.worktree && !opts?.rootCwd) return;` restore the pre-#332 guard (`git show 2273595:src/orchestrator/spawn.ts:130` is the same `if (!task.worktree) return;`). The root branch keeps the `SPECS.md`-only and `readlinkSync === join(".kanban", task.file)` conditions from #332.
- `src/orchestrator/pipeline.ts:161`: `{ rootCwd: true }` sits on the dead-splitter decline path, after the `${slug}.splitter` pid check at `:150`. The splitter (`:155`) and the integration-tester (`:349`) are the only root-cwd spawns, so no other root run loses its link.
- `src/orchestrator/liveness.ts:89` and `:186`: `{ rootCwd: pidName === "integration-tester" }`, and both `bounceDead` callers (`:159`, `:236`) pass the poll's `pidName`. `LANES` (`liveness.ts:29-30`) gives `merger` for `merging`, and a to-do task has no lane, so `pidName` is the bare slug and the flag is false. `rg -n 'clearContextSymlinks' src tests` shows no other caller passes the flag.
- `tests/context-symlinks.test.ts:263-273`: part CS7 writes a live `<slug>.splitter` pid, asserts the unflagged call keeps the root link and the flagged call removes it; the two CS6 no-worktree calls at `:244` and `:251` pass `{ rootCwd: true }` and keep their meaning.
- Tests: `tests/context-symlinks.test.ts` exit=0 (parts CS1-CS7), `tests/orchestrator/split.test.ts` exit=0 (the regression gate named in the Acceptance note).

## Live test

Claim table was frozen before the first run. Each expected value comes from the merged code path, not from the Specs prose. Control tree is c7b47c8 (the parent commit, which has none of this fix).

| id | claim | expected | control | merged (3 runs) |
| --- | --- | --- | --- | --- |
| C1 | a to-do moderate task with a live <slug>.splitter pid keeps the root SPECS.md link through poll() | present | absent | present PASS |
| C2 | poll() on an integration-testing task whose integration-tester pid is dead removes the root SPECS.md link | absent | absent | absent PASS |
| C5 | the C2 poll leaves a real root AGENTS.md file in place | present | present | present PASS |
| C3 | poll() on a merging task whose merger pid is dead keeps the root SPECS.md link (flag false for the merger) | present | absent | present PASS |
| C4 | rescan() on a to-do moderate task with a dead <slug>.splitter pid removes the root SPECS.md link (dead-splitter decline path) | absent | absent | absent PASS |

The control run fails C1, C3 and passes the other rows. So the fix changes exactly the two behaviors in C1 and C3, and keeps C2, C4 and C5.

### Evidence

- C1 is the reported regression. A `to-do` task with a live `<slug>.splitter` pid keeps `<root>/SPECS.md` pointing at `.kanban/000001_splitter_live.md` after `poll()`, and the task stays `to-do`. On the control tree the same call removes the link while the splitter pid is alive. 3 of 3 merged runs.
- C2: a dead `integration-tester` pid on an `integration-testing` task still removes the root `SPECS.md` link, so the opt-in keeps the #332 cleanup.
- C3: a dead `merger` pid on a `merging` task keeps the root link, because the merger runs in the task worktree. The control tree removes it.
- C4: `rescan()` on a `to-do` moderate task with a dead `<slug>.splitter` pid removes the root link, then spawns the Developer (the task reaches `doing`). The dead-splitter decline path still cleans up.
- C5: the real root `AGENTS.md` file survives the C2 poll.
- Saved pids: 6 in total from the 3 merged runs (the dead-pid probe and the fake Developer of each rescan). `kill -0` fails for all 6 of them. Fixture roots and logs are under `/tmp/root-link-335`.

### Assumptions

- The daemon lane was not run. The trigger is the poll's pid-name lookup, so the driver called the production `poll()` and `rescan()` in-process on a fixture board, as the role guidance allows when the timers, the pid lifecycle and the CLI are not part of the claim.
- The fixture splitter pid is the driver's own live pid, written as a bare pid. `pidEntry` reads the bare form and the `<pid> <disc>` form the same way, so the alive branch is the same.
- The fixture tasks have `worktree: ""`. The root-link branch runs only for a task without a worktree. A real `integration-testing` task that carries a worktree never touches the root link, so that combination was not exercised.
- A fake agent that exits 0 replaces the real splitter and the Developer. Splitter prompt text, the split outcome and a real Developer run were not exercised, and this task does not change them.
- Nothing was restarted. The daemon that runs now (pid 57964 at task creation) holds the pre-#332 code in memory, so restart it for this fix to take effect, as the Specs say.

### Result

No findings. Every flow ran, and all 5 checks passed on 3 of 3 merged runs. No open user/client questions.
