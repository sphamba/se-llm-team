---
name: "feat: orchestrator merges itself; all agents spawn in their worktrees"
priority: "high"
state: "done"
worktree: ""
issuer: "user"
complexity: "complex"
shortName: "orchestrator-merge-worktree-flow"
blockedBy: ""
---

# Summary
Rework the merge pipeline and the worktree lifecycle. The orchestrator runs the git merges itself and updates the task status on successful agent finish; only the reviewer keeps its state decision. The merger agent only resolves conflicts. All four roles spawn with cwd in the task worktree. The worktree lives until done.

# Specs
## Spawn cwd (spawnAgent and its call sites)
- developer, reviewer: unchanged (cwd = worktree dir).
- merger: spawn with cwd = worktree dir, not root (sweepToMerge).
- live-tester: spawn with cwd = worktree dir, not root (the to-live-test branch of rescan).
- The {{WORKTREE}} prompt placeholder now resolves for merger and live-tester (spawnAgent fills it when cwd is not root).
- A task with no worktree attr keeps today's behavior: to-live-test bounces to to-merge; to-merge with nothing to merge goes done with "nothing to merge".

## Exit-code detection (spawnAgent, poll)
- spawnAgent records the agent's exit code: wrap the agent command (sh -c 'agent ... ; echo $? > <path>') writing <slug>.exit next to the pid file, or an equivalent mechanism.
- poll, pid gone: read the exit file. Exit 0 = successful finish: the orchestrator sets the task state to the role's next state (developer -> to-review, merger -> to-merge, live-tester -> done) and clears the pid and exit file. Non-zero or missing = crash: today's dead-pid bounce (WORKING_STATES bounce, dead marker, cooldown, RESPAWN_CAP).
- The reviewer is the exception: it keeps its own state decision (to-merge or back to to-review) via kanban_set_state, so the orchestrator does nothing on its successful finish (the task has already left reviewing). If it exits 0 with the task still in reviewing, leave it for the PM.
- One exit file per task at a time; the state-move hook removes leftovers (janitorPids can sweep strays).

## to-merge flow (sweepToMerge)
Replace the "always spawn a merger" flow with:
1. Keep the gates: reviewer-armed marker, defer while the task's own agent lives, defer while a global merger agent lives, dead cooldown, per-task idle-cooldown marker, ensureWorktree.
2. Orchestrator merges base into the task branch: git -C <worktreeDir> merge --no-edit main.
   - Success: orchestrator merges the branch into main: git -C <root> merge --no-edit <branch>. Then sync the branch to the merged commit: git -C <worktreeDir> merge --ff-only main (a no-op on a fast-forward; needed when the branch-to-main merge made a merge commit, so the live test runs the merged code). Then set the task to to-live-test. Do not delete the worktree. No merger agent spawns on this path.
   - Failure (conflicts): leave the merge in progress in the worktree (do not abort), write the idle-cooldown attempt marker, set mergerLogSlug, spawn the merger (cwd = worktree dir, pidName "merger"), set the task to merging.
   - If the branch-to-main merge at root fails (rare; main moved between the two steps): git -C <root> merge --abort, write the attempt marker, leave the task in to-merge. The next sweep retries after the idle cooldown.

## merger role (agents/merger.md rewrite)
- The merger only resolves the merge conflicts that the failed orchestrator merge left in its worktree, then git commit to conclude the merge. No state moves at all: the orchestrator sets merging at spawn and moves the task back to to-merge on the merger's successful finish (exit 0).
- It starts no merge itself and runs no test suites (the orchestrator retry and the live test validate). It touches only its worktree. Keep: the open-questions section, and the placeholder set. The kanban_set_state re-read guard line goes (no state moves).

## agent prompts drop the state moves
- agents/developer.md: step 5 (set to-review) dropped; the orchestrator moves the task on the developer's successful finish. The kanban_set_state re-read guard line goes.
- agents/live-tester.md: step 3 (set done) dropped; the orchestrator sets done on the live-tester's successful finish. Step 4 (Notes append) and step 5 (findings reported to the PM subagent, which uses kanban_list and kanban_create) stay.
- agents/reviewer.md: steps 5 and 6 stay (the exception: to-review with fixes, to-merge without). The step-6 prose updates to the new flow (the orchestrator merges; the merger only resolves conflicts).

## merging and liveness (keep)
- merging stays owned by the merger agent's liveness poll. WORKING_STATES still maps merging -> to-merge and live-testing -> to-live-test for the crash bounce. pidName "merger" for merging, slug for the rest. RESPAWN_CAP, dead markers, stall detection, janitorPids, global-merger-pid cleanup, and attempt-marker cleanup for non-merge states: unchanged.
- After the orchestrator moves the task back to to-merge (merger exit 0), the next sweep retries the merge through the existing idle-cooldown marker. If conflicts repeat, the loop stays bounded by the cooldowns and RESPAWN_CAP.

## done (doneCleanup, keep)
- doneCleanup already removes the worktree, deletes the branch, clears the attr, and commits on every done sweep. No change. This stays the only worktree deletion point.

## to-live-test
- Spawn the live-tester in the still-existing worktree. It tests the merged commit there (the branch is synced to main after the ff-only sync). Keep: no code edits, the findings flow. agents/live-tester.md: update the "runs from {{ROOT}} on the merged commit" wording to the worktree.

## Tests (tests/orchestrator.test.ts)
- A (happy pipeline): no merger agent on the clean path; the orchestrator moves the developer's task to to-review and the live-tester's to done (agents no longer set states); no merger pid file appears.
- B/I (dead bounce): a non-zero or missing exit file bounces as today.
- G: the live-tester cwd assert changes from the root to the worktree dir; the done move is the orchestrator's (exit 0), not the agent's; worktree removed at done stays.
- K: the conflict path spawns the merger (cwd = worktree); after the merger commits and exits 0 the orchestrator moves to-merge and the retry succeeds; the requeue + idle-cooldown retry and indexed merger logs stay.
- K2: single-merger serialization and both worktrees cleaned stay.
- AL (merger prompt suite-skip on a clean merge): remove or rework. A clean merge spawns no merger.
- New: the exit-file mechanism (exit 0 recorded, read once, cleared after the state move).
- New: when main moves ahead between the two orchestrator merges, the branch lands on the merge commit (ff-only sync) and the live test runs that commit.
- Fold the #188 test rework (D, spawn-args, renderPrompt, tool asserts) together with these where they touch the same helpers.

## Docs
- README.md: the per-state behavior for to-merge/merging/done (who merges, who moves states, worktree lifetime) and the agent cwd table (merger, live-tester now in the worktree).
- skills/se-llm-team/SKILL.md: description and pipeline text; the orchestrator runs the merges and moves the states on successful agent finish; only the reviewer keeps its state decision; the merger only resolves conflicts.

# Notes
- src/orchestrator/pipeline.ts: sweepToMerge runs the merges itself. git merge --no-edit main in the worktree; on a conflict it leaves the merge in progress, spawns the merger there (cwd = worktree dir, pidName merger, state merging) to resolve and conclude, then retries; then git merge --no-edit <branch> at the root (failure aborts, writes the attempt marker, requeues); then git merge --ff-only main in the worktree so the live test runs the merged code; then to-live-test. No merger spawns on a clean merge.
- src/orchestrator/spawn.ts: spawnAgent records each agent's exit code through the sh wrapper (sh -c "$@" ; echo $? > <exitPath>), exit file .pids/<name>.exit (name = pidName, merger for merging, slug otherwise), cleared before each spawn.
- src/orchestrator/liveness.ts: WORKING_STATES now carries a success target (doing -> to-review, live-testing -> done, merging -> to-merge, reviewing -> null). Exit 0 moves the task after a re-read plus state-match; the reviewer exception leaves a reviewing task for the PM; non-zero or missing keeps the crash bounce. The dead-pid branch consumes the armed reviewer marker itself (bumps <slug>.reviewer-runs on exit 0), fixing an under-count race: the success move phase-aligns the reviewer spawn with the poll tick, so the poll cleared the pid file before the debounced sweep's consumeReviewerRun ran.
- src/pid.ts: killTree kills the sh wrapper's process group when it leads one (detached spawn), else signals a single pid, so hand-written pid files in tests stay safe.
- agents/merger.md rewritten to the conflict-only contract: resolves the in-progress worktree merge with main winning unless the Specs say otherwise, git commit to conclude, never aborts, no state moves, no test suites. agents/developer.md and agents/live-tester.md dropped their kanban_set_state step and end with "finish; the orchestrator moves the task". agents/reviewer.md keeps its state decision, step 6 prose updated to the new flow.
- tests/orchestrator.test.ts reworked: stubs follow the orchestrator-owns-the-state contract (only the reviewer stub writes state, the merger stub concludes the in-progress merge taking main's side); parts A, B, F, G, I, K, K2, AL reworked; new K3 (main moves ahead between the merges: one-shot post-merge hook in the linked worktree, ff-only sync, live test runs the merged commit), K4 (dirty root refuses the root-side merge), AT (direct exit-code-file poll test). The K3 hook must unset GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE before git -C: git exports GIT_DIR into hook env, which overrides -C discovery.
- Docs: README.md Orchestrator and Agents sections rewritten (per-state behavior for to-merge/merging/done, the agent cwd table, state-move ownership, worktree lifetime); skills/se-llm-team/SKILL.md description and pipeline text updated.
- Full suite green: npm test (kanban, orchestrator, webui, extension, index).
- Review (60d6de6): the poll's reviewer-exception path cleared the exit file, so the next pass crash-bounced the pid-less reviewing task to to-review ("agent pid=0 dead without state update"), contradicting the Specs' "leave it for the PM"; the AT test even documented a "re-arming the pid file" mechanism that does not exist. Fixed: the exception path keeps the exit file, making the exception sticky (the next pass re-logs instead of bouncing); a fresh spawn or a state change clears the file. AT now asserts the sticky second pass.
- Review (60d6de6): the old merger prompt refused a detached-HEAD project root; the new sweepToMerge silently dropped that guard. Verified: git merge at a detached HEAD fast-forwards onto a dangling commit no branch carries, so the change landed nowhere and doneCleanup then deleted the branch and worktree (silent loss). Fixed: sweepToMerge requeues a detached root to to-merge with the attempt marker ("root checkout is detached, left in to-merge (PM resolves manually)"); new part K5 covers it.
- Review (60d6de6): README.md rendered the post-table paragraph as a fourth column of the agent cwd table (the paragraph was glued to the Live-tester row); split onto its own line.
- Review note (no change): sweepToMerge hardcodes main for the worktree-side merge (as the Specs mandate) while the root-side `git merge <branch>` targets whatever branch the project root has checked out, normally main. A root parked on a non-main branch lands the change there, not in main; this matches the old merger's base-branch semantics and the to-live-test ancestor gate passes, so it stays as documented behavior.
- Review re-run: all five suites green after the fixes (kanban, orchestrator with new K5 + sticky-exception AT, webui, extension, index).
- Review (this run): specs verified end to end; full suite green twice. Two suspected exit-file misattribution races probed with direct poll() runs and disproven: (1) a stale reviewer exit-0 file surviving into to-live-test and (2) the sticky reviewer-exception exit file surviving a PM rework to to-do. Both states are queue states, not WORKING_STATES keys, so the poll's !working path clears the stale pid + exit files (and the dead streak) with no state move; every working state is entered through spawnAgent, which clears the exit file before the spawn, so no working state can start with a foreign exit code. The false-done / false-advance class is closed by construction.
- Review (this run): accepted logged rare paths, no change: the ff-only sync failure (dirty worktree after a clean worktree-side merge) logs "branch sync to main failed" and still sets to-live-test, so the live test would run the branch tip (the spec defines no failure behavior there); a merger that repeatedly exits 0 without resolving loops at the idle-cooldown rate with the dead counter reset each success, so RESPAWN_CAP bounds only crash streaks, same shape as the old merger's requeue loop; the sticky reviewer-exception exit file re-logs one line per poll pass while the task waits for the PM.
- Review (this run): confirmed doneCleanup byte-identical to main (still the only worktree deletion point); AT asserts the exit-file mechanism (wrapper recording, crash/missing-code bounce, success move, sticky exception); AL asserts the conflict-only merger contract; K3's hook unsets GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE before git -C as the Notes document; K5 covers the detached-root guard.
- Merge (this run): base branch was main both steps. Step 1 (worktree): merge main into feat/187 was already up to date, clean, no conflicts, so test suites skipped per the clean-merge rule. Step 2 (root): merge feat/187 into main fast-forwarded a0e1ec3..60d6de6, clean. No conflicts resolved, no fixes needed. # Open questions empty.

- Live test (this run), merged commit 60d6de6. Environment: a scratch origin, a clone at 60d6de6, an isolated HOME, a role-aware fake-pi agent, and the daemon with --rescan-seconds 1 --poll-minutes 0.05 --no-webui. Thirteen checks passed. One finding was found. Test artifacts are in /tmp/lt187.

| Check | Probe | Observed | Result |
| --- | --- | --- | --- |
| Clean pipeline, no merger | one to-do task | The developer, reviewer and live-tester ran with cwd in the worktree. The log shows "merged into main, set to-live-test" and no merger spawn. Exit 0 moved doing -> to-review and live-testing -> done. doneCleanup removed the worktree and the branch. | PASS |
| Developer exit 3 | one to-do task | The log shows "agent exited 3 without success, doing -> to-do", and the task respawned. | PASS |
| No exit file (killed agent) | one to-do task | The log shows "agent pid=0 dead without state update, doing -> to-do". | PASS |
| Reviewer exception | one to-review task, reviewer exit 0 with no state move | The log shows "reviewer exited 0 with the task still in reviewing; left for the PM". No respawn. The kept exit file made the exception sticky. | PASS |
| Nothing to merge | a to-merge task with no worktree | The log shows "nothing to merge, set done". | PASS |
| Merge conflict | a worktree branch that conflicts with main | The merger spawned with cwd .worktrees/conflict-wt and resolved the merge. The orchestrator then merged the branch into main and the live-tester ran in the worktree. The merger exit 0 moved merging -> to-merge, and the retry merged after the idle cooldown. | PASS |
| Main moves between the merges | a post-merge hook that commits to main during step 1 | The root HEAD is a merge commit with two parents. The live-tester report shows cwdHead == rootHead == that commit, and the branch file and the hook file exist there. | PASS |
| Dirty root | an untracked root file that the branch adds | The log shows "merge into main failed, left in to-merge for the retry". The state stayed to-merge. After the file was removed, the next sweep merged the branch and the task reached done. | PASS |
| Detached root | a detached root checkout | The log shows "root checkout is detached, left in to-merge (PM resolves manually)". The state stayed to-merge and the attempt marker exists. After the root returned to main, the sweep merged the branch and the task reached done. | PASS |
| to-live-test without a worktree | a to-live-test task with no worktree | The log shows "no worktree, moving to to-merge", then "nothing to merge, set done". | PASS |
| One merger project-wide | two conflicted to-merge tasks | The second merger spawned 9.7 s after the first, only after the first merger process was gone. The second task stayed in to-merge while the first merger was alive. | PASS, with finding 1 |
| Agent prompts | all daemon spawn payloads | 29 of 29 payloads match the shipped agents/<role>.md files after the placeholders render. {{WORKTREE}} equals the spawn cwd for all four roles. kanban_set_state is absent from the developer, merger and live-tester payloads and present in the reviewer payload. In the pre-change commit a0e1ec3 it was present in the developer, merger and live-tester files. | PASS |
| Docs | README.md and skills/se-llm-team/SKILL.md | The per-state text, the agent cwd table and the pipeline text match the observed behavior of the checks above. | PASS |

- Finding 1: a false crash bounce of the second task in the merging state.
  - Repro: two conflicted to-merge tasks at the same time.
  - Observed: in one poll pass the poll read the single shared merger exit file for the first task in file order and moved it merging -> to-merge on exit 0. It then read the same file for the second task, found it cleared by the first task's handling, and logged "000012: agent pid=0 dead without state update, merging -> to-merge". The merger of task 000012 had resolved its merge and exited 0. The poll wrote the false death marker .logs/000012.merger.0.dead and increased the dead counter. The later line "000012: run completed, cleared the dead-agent counter" proves the increased counter, and task 000011 has no such line.
  - Effect: a task in a queue of conflicted merges gets a false death record and a false dead cross on its merger run in the web ui. The state result is the same, because the crash bounce and the exit-0 move both target to-merge, so no task is stranded and no work is lost.
  - Cause (read only): the merger pid file and the merger exit file are global (.pids/merger.pid and .pids/merger.exit, spawnAgent pidName "merger"), and the poll maps every task in the merging state to that pair and clears the exit file after the first task. The stall check already uses the getMergerLogSlug() === slug guard, the dead and exit branch does not.
  - Suggested fix: handle a merging task in the poll only when it is the current merger's task, with the same guard, and leave the other merging tasks for the sweep.

- Observations, no task needed: (1) Retry cadence of the root-side failure paths (dirty root, detached root). The first retry waits autoScheduleMinutes, but the later retries run at the rescan cadence, because these paths write no task file and the marker gate uses the task file mtime. Round 3 used autoScheduleMinutes 3 s and rescan 1 s: the failure was at 08:33:02, the first retry at 08:33:05.7, then one retry per second. Effect: one log line and one failing git merge per rescan while the root stays dirty. The Specs sentence "The next sweep retries after the idle cooldown" holds for the first retry only. (2) doneCleanup removes the worktree directory but leaves an empty .worktrees/task/ parent directory for the auto-created task/<num>-<slug> worktrees. Cosmetic.
- Assumptions: the fixture agents are scripts that reproduce the role exit behavior. The one-merger-at-a-time serialization is intended. The fixture used poll 0.05 min, rescan 1 s and autoScheduleMinutes 0.05 min to make the flows fast. No open questions for the user or the client.
- Technical difficulty: an extensionless Node script that uses ESM syntax silently exits 0 on this machine (Node 24) and never runs its body. The first fake-pi did nothing for this reason. A .mjs file works.

- Live test (second run), merged commit 60d6de6. Cause of the second run: the first run finished normally, but the project daemon (pid 4110262) started at 2026-10-12 22:45:40, before this change merged (aabba5d at 2026-10-13 09:45:57). That daemon runs the pre-change code, so it logged "000187_orchestrator_merge_worktree_flow: agent pid=441909 dead without state update, live-testing -> to-live-test" at 2026-10-13T08:50:11.975Z and spawned this run. This run (pid 469098) also got cwd = the project root, not the worktree. So the first run could not move the task to done, and the real board did not exercise the new flow. This run rebuilt the fixture (/tmp/lt187b) and repeated the core checks on the merged code, then restarted the project daemon on the merged code. Test artifacts are in /tmp/lt187b (daemon.out, calls.jsonl, prompt-*.txt).

| Check | Probe | Observed | Result |
| --- | --- | --- | --- |
| Clean pipeline | one to-do task | The developer, the reviewer and the live-tester ran with cwd in the worktree. The log shows "agent exited 0, doing -> to-review" and "agent exited 0, live-testing -> done". It shows "merged into main, set to-live-test" and no merger spawn. doneCleanup removed the worktree and deleted the branch. No merger pid file appeared. | PASS |
| Live test runs the merged commit | the clean probe | The live-tester note has cwdHead == rootHead (a2dbf7f) and dirty is empty. The root main has the developer change. | PASS |
| Merge conflict | a worktree branch that conflicts with main | "git merge --no-edit main failed" (preimage for CONFLICT.txt), then "merge conflicts, merger spawned to resolve them". The merger spawned with cwd .worktrees/conflict-wt. The merger exit 0 moved merging -> to-merge. The retry merged the branch into main and set to-live-test. The live-tester ran in the worktree and exit 0 moved live-testing -> done. doneCleanup removed the worktree and deleted the branch. | PASS |
| Developer exit 3 | one to-do task | The log shows "agent exited 3 without success, doing -> to-do" and a respawn. After 5 failed runs it shows "agent died 5+ times; respawn waits for the idle cooldown (state to-do)". | PASS |
| Agent prompts | the 18 payloads of this run | No payload has an unreplaced placeholder. The worktree path appears in the developer (3), merger (6) and live-tester (4) payloads. kanban_set_state is absent from the developer (0), merger (0) and live-tester (0) payloads, and present in the reviewer payload (1). | PASS |
| Production daemon | the live project daemon | See finding 2. After the restart the daemon is pid 502237, started 2026-10-13T09:11:34.399Z, and it logged "3 in-flight kept" plus "web ui on http://0.0.0.0:4242 (hub for se-llm-team)". The four running agents survived. | PASS after the restart |

- Finding 2 (this run, environment and operation): the pipeline livelocks when a change that touches the orchestrator merges while the daemon that spawned the agents still runs the pre-change code.
  - Evidence: the old daemon (pid 4110262, started 2026-10-12 22:45:40) spawned the #187 merger (pid 441445) and both #187 live-testers with cwd = the project root, so it did not use the new spawn cwd. The first live-tester run ended with agent_settled and aborted:false, and the daemon logged "agent pid=441909 dead without state update, live-testing -> to-live-test". The merged live-tester prompt no longer calls kanban_set_state, and the old daemon has no exit-0 success move, so the task can never reach done while that daemon lives. Every cycle consumes one full agent run. This run hit the same trap: it was spawned at cwd = the project root, and a second run was necessary only because of the old daemon.
  - The loop is now observed on a real task, not only on #187. Developer #189 (pid 463733, spawned at 08:47:06) finished after about 24 minutes, and at 09:11:13 the old daemon logged "000189_merger_poll_misattribution: agent pid=463733 dead without state update, doing -> to-do" and respawned a new developer (pid 502040). The work is preserved in the worktree, but the successful run is discarded. The same trap waits for #188 and #191.
  - Action taken: orchestrator_stop, then orchestrator_start. The daemon now runs the merged code. The in-flight agents survived the restart. Their runs have no exit file (the old daemon writes none), so the new daemon will bounce each in-flight task one last time on its finish. The respawn runs the merged code and can then move the task. This is the expected cost of the stale daemon, not a defect of the merged code. For the next live-tester run: the merged flow is now verified twice (merged commit 60d6de6), so confirm the daemon restart (pid 502237, started 2026-10-13T09:11:34.399Z, "orchestrator started" in .kanban/.logs/orchestrator.log) and append a one-line note. Do not repeat the full matrix unless the code changed.
  - Suggested task: document that the daemon must be restarted after a merge that touches src/orchestrator/ (README or skill), or let the daemon restart itself when the root-side merge changes its own code. The PM decides which one.

- Observations, no task (from the first run, still true): (1) The root-side failure retry paths (dirty root, detached root) retry at the rescan cadence after the first idle-cooldown retry, because these paths write no task file and the marker gate uses the task file mtime. Round 3 measured one failing git merge and one log line per second while the root stayed dirty. (2) doneCleanup removes the worktree directory but leaves an empty .worktrees/task/ parent directory. New observation, no task: a live-tester whose spawn is deferred by a later merger can run in a worktree behind the latest main (first run, task 000011: cwdHead 0f5d5b5, rootHead bf3a188). The worktree holds the merge result of its own task, so this matches the Specs' ff-only-sync wording.

- Assumptions (second run): the fixture agents are scripts that reproduce the role exit behavior. The one-merger-at-a-time serialization is intended. The fixture used pollMinutes 0.05 and rescan 1 s to make the flows fast. No code was edited. The only change outside the fixture was the daemon restart. No open questions for the user or the client.

- Live test (third run), merged commit 60d6de6. Worktree HEAD == main == 60d6de6, unchanged since the second run, so this run did not repeat the full matrix: it re-verified the core flows on the merged commit with a fresh fixture (/tmp/lt187c: scratch origin, isolated HOME, role-aware fake-pi, daemon loading the merged worktree code with `--rescan-seconds 1 --poll-minutes 0.05 --no-webui`), plus the real-board daemon restart.

| Check | Probe | Observed | Result |
| --- | --- | --- | --- |
| Clean pipeline, no merger | one to-do task | Developer, reviewer and live-tester all ran with cwd in the worktree. `agent exited 0, doing -> to-review`, then `merged into main, set to-live-test` with no merger spawn, then `agent exited 0, live-testing -> done`. Live-tester note: cwdHead == rootHead == 99bfba2, dirty empty. doneCleanup removed the worktree, deleted the branch, cleared the worktree attribute. | PASS |
| Exit-code bounce | one to-do task, developer exit 3 | `agent pid=N exited 3 without success, doing -> to-do` on every run. The task stayed to-do and respawned. | PASS |
| Merge conflict | a branch that conflicts with main on README line 1, to-merge task | `git merge --no-edit main failed`, `merge conflicts, merger spawned to resolve them`. The merger ran with cwd `.worktrees/conflict-wt` and resolved main's side. Its exit 0 moved merging -> to-merge. The retry's worktree-side merge created a93764b (parents [d3d8387, 99bfba2]). The root-side merge into main fast-forwarded to it and the ff-only worktree sync was a no-op. The live-tester ran in the worktree with cwdHead == rootHead == a93764b, and its exit 0 moved live-testing -> done. | PASS |
| Prompt placeholders and state moves | the 37 spawn payloads of this run | 0 unreplaced `{{...}}` tokens. The `Worktree:` line equals the spawn cwd for all four roles. `kanban_set_state` is absent from the developer (0/34), merger (0/1) and live-tester (0/2) payloads, and present in the reviewer payload. | PASS |
| Exit-file housekeeping | the fixture `.pids/` after both done moves | Empty: no pid or `.exit` file left after the success move and doneCleanup. | PASS |
| Docs | README.md and skills/se-llm-team/SKILL.md at 60d6de6 | The per-state text (to-merge/merging/to-live-test/done), the exit-code poll line, the worktree lifetime and the four-row agent cwd table match the observed behavior. | PASS |
| Real-board daemon | the project daemon and this run's own spawn | Daemon pid 502237 (started 2026-10-13T09:11:34Z) runs the merged code: it spawned this run (pid 523959) with cwd = this task worktree, not the project root, and with the `sh -c "$@" ; echo $? > .pids/<slug>.exit` wrapper. The two earlier runs were spawned by the pre-change daemon with cwd = the project root and no exit wrapper. | PASS |

- Findings (third run): none new. The prior findings stay tracked: #189 (merger poll misattribution for the second task in merging, doing) and #192 (restart the daemon after a merge that touches src/orchestrator/, backlog). This run serialized one merger at a time, so it did not re-trigger finding 1.

- Assumptions and limits (third run): the fixture agents are scripts that reproduce each role's exit behavior, and the one-merger-at-a-time rule is intended. The last real-board link (this run exits 0 and the daemon reads the exit file to move live-testing -> done) happens after my exit and cannot be observed by me, but it is the same code path the fixture exercised. The full matrix was not repeated because the code did not change. Technical difficulties, test harness only, no task: (1) `pkill -f /tmp/lt187c/fake-pi` matched the test's own shell and killed it (known trap); kill recorded pids only. (2) `$!` after `cd X && nohup node ... &` records the subshell, not node; the real daemon pid was that subshell's child. No open questions for the user or the client.

# Open questions
