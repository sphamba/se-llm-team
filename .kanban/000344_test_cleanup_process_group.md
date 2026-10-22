---
name: "test: kill the agent's process group and register the leaked origin remotes"
priority: "low"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "test-cleanup-process-group"
---

# Summary
Part AQ of daemon.test.ts kills the agent with a single-pid SIGKILL, but the pid file holds the group-leading sh wrapper that spawn.ts:260 starts detached. The node agent survives every run, reparented to init, so a full suite leaves one fake-agent process behind. Production already kills by group via killTree, so only this test site is wrong. The same task registers the two -origin.git remotes that spawn.test.ts and worktree.test.ts create and never clean.

# Specs
## Leak 1: one agent process per full-suite run

`tests/orchestrator/daemon.test.ts:60` ends part AQ with `process.kill(agentPidAQ, "SIGKILL")`.

The recorded pid is not the agent. `src/orchestrator/spawn.ts:260` spawns `sh -c '"$@" ; echo $? > exitPath' sh <cfg.agent> <args>` with `detached: true`, and `spawn.ts:271` writes `child.pid`, so the pid file holds the process-group-leading `sh`. A single-pid SIGKILL kills the shell and leaves the node agent running, reparented to init, with its 100 ms timer writing into a log whose directory the test then deletes.

Production is not affected: every real kill goes through `killTree` (`src/pid.ts:109`), which sends `-pid` and takes the whole group. Only this test call site is single-pid. `tests/helpers.ts:264` and `tests/context-symlinks.test.ts:116` already use the group form.

Fix: replace that call with `killTree(agentPidAQ, "SIGKILL")`, imported from `src/pid.ts`, keeping the `try`/`catch` for an already-gone agent. Add one comment line saying the pid is the wrapper's group leader.

Observed cost on this host: 4 orphaned `fake-agent.cjs` processes before the fix, one per full-suite run, plus one created by a single `node tests/orchestrator/daemon.test.ts` run.

## Leak 2: the origin remotes are never registered for cleanup

`tests/orchestrator/spawn.test.ts:17` (`const remoteA = \`${rootA}-origin.git\``) and `tests/orchestrator/worktree.test.ts:221` (`const remoteM = \`${rootM}-origin.git\``) create a sibling bare repo outside the fixture root. Only `rootA` and `rootM` go into `cleaned`, so every run leaves the bare repo behind. 69 such directories, 17 MB, are in `/tmp` now.

Fix: push each remote path into `cleaned` next to its root.

## Housekeeping in the same task

After the fix, kill the orphaned `fake-agent.cjs` processes and remove the stale `/tmp/orch-smoke-*` directories once, and record the before and after counts in `# Notes`. No other process is running.

## Acceptance

1. `pgrep -af "orch-smoke.*fake-agent"` before and after `node tests/orchestrator/daemon.test.ts`: the count does not grow. Record both counts.
2. `node tests/orchestrator/daemon.test.ts` passes.
3. `node tests/orchestrator/spawn.test.ts` passes, and `ls -d /tmp/orch-smoke-*` shows no new path from that run.
4. `node tests/orchestrator/worktree.test.ts` passes, same check.
5. `grep -n 'process.kill(agentPidAQ' tests/orchestrator/daemon.test.ts` finds nothing.

# Notes

## What changed
- `tests/orchestrator/daemon.test.ts`: part AQ ends with `killTree(agentPidAQ, "SIGKILL")`, imported from `src/pid.ts`, plus one comment line that the pid is the wrapper's group leader.
- `tests/orchestrator/spawn.test.ts`: `cleaned.push(remoteA)` after `remoteA` is declared.
- `tests/orchestrator/worktree.test.ts`: `cleaned.push(remoteM)` after `remoteM` is declared.
- Exactly 3 files, no source change.

## Acceptance
1. `pgrep -af '^node /tmp/orch-smoke'` around `node tests/orchestrator/daemon.test.ts`. Before the fix 0 -> 1 (one survivor, `node /tmp/orch-smoke-UVhwkZ/fake-agent.cjs ...`). After the fix 1 -> 1. The literal Specs pattern `pgrep -af "orch-smoke.*fake-agent"` reads 2 -> 3 and 1 -> 1, but it also matches the shell command line itself, so the anchored `^node` form is the count used here.
2. `node tests/orchestrator/daemon.test.ts` exit=0, pass.
3. `node tests/orchestrator/spawn.test.ts` exit=0, pass. `/tmp/orch-smoke-*` 0 -> 0, no new path. `ls -d /tmp/*-origin.git` is empty after the run.
4. `node tests/orchestrator/worktree.test.ts` exit=0, pass. `/tmp/orch-smoke-*` 0 -> 0, and `/tmp/*-origin.git` empty after the run (that path was `/tmp/<rootM>-origin.git` before the fix).
5. `grep -n 'process.kill(agentPidAQ' tests/orchestrator/daemon.test.ts` finds nothing.

## Follow-up
- Housekeeping: orphaned `fake-agent.cjs` 1 -> 0 (one survivor was present at the start of the fix, its `/tmp/orch-smoke-UVhwkZ` already gone, killed). Stale `/tmp/orch-smoke-*` and `*-origin.git` directories 0 -> 0: the host was already clean when this run started, so the 69 directories and 17 MB in the Specs were removed before this worktree existed.
- Leak 2 got no red run: after the first green the suite count was spent, and the Specs record the 69 leftover directories as the evidence.

Review of 94f004b (first pass):
- tests/orchestrator/daemon.test.ts:61 ends part AQ with `killTree(agentPidAQ, "SIGKILL")` under the group-leader comment at :60. The pid comes from the pid file at :37, and src/pid.ts:109 sends `-pid` when the pid leads its group, so the wrapper and the node agent die together.
- tests/orchestrator/spawn.test.ts:18 `cleaned.push(remoteA)`: the bare origin is registered before `git init`, and no writer unregisters it.
- tests/orchestrator/worktree.test.ts:222 `cleaned.push(remoteM)`: the same, so `cleanupAll` now removes both origins.
- Tests: daemon.test.ts exit=0, spawn.test.ts exit=0, worktree.test.ts exit=0, each log ending in a passed line. After each run `^node /tmp/orch-smoke` processes 0, `/tmp/orch-smoke-*` 0, `/tmp/*-origin.git` 0 (0 -> 0 throughout). Acceptance 5: `grep -n 'process.kill(agentPidAQ'` 0 matches.
- Nit: the `try`/`catch` around `killTree` is dead, since killTree returns false on a gone pid (src/pid.ts:122) and never throws. Drop it the next time that block is touched.

## Live test

Test-only change: no test file was run. Each row replays the scenario through the production function (`killTree` from `src/pid.ts`) or through the merged test file's own kill form, and the control tree replays the pre-fix form on the same fixture.

driver: /tmp/lt344/driver.mjs | merged tree: /home/phamba/repos/se-llm-team/.worktrees/test/344-test-cleanup-process-group (94f004b) | control tree: /tmp/lt344/pre-fix ((n/a: archived tree, no git metadata))

| id | claim | expected | actual (merged x3) | control | verdict |
| --- | --- | --- | --- | --- | --- |
| A1 | merged daemon.test.ts kills the AQ agent by process group, not by single pid | killTree(agentPidAQ, "SIGKILL") at tests/orchestrator/daemon.test.ts:61; grep process.kill(agentPidAQ = 0 matches (src/pid.ts:109 sends -pid) | form=killTree at daemon.test.ts:61 "killTree(agentPidAQ, "SIGKILL");"; process.kill(agentPidAQ matches=0<br>form=killTree at daemon.test.ts:61 "killTree(agentPidAQ, "SIGKILL");"; process.kill(agentPidAQ matches=0<br>form=killTree at daemon.test.ts:61 "killTree(agentPidAQ, "SIGKILL");"; process.kill(agentPidAQ matches=0 | form=process.kill at daemon.test.ts:60 "process.kill(agentPidAQ, "SIGKILL");"; process.kill(agentPidAQ matches=1 | PASS |
| A2 | the AQ kill site's form kills the detached node agent under the sh wrapper (no orphan) | wrapper pgrp==pid; after the kill: agentAlive=false, logGrew=false, groupGone=true (spike 135->135) | form=killTree pgrp==pid:true agentAlive=false logGrew=false (194->194) wrapperState=Z groupGone=true<br>form=killTree pgrp==pid:true agentAlive=false logGrew=false (194->194) wrapperState=Z groupGone=true<br>form=killTree pgrp==pid:true agentAlive=false logGrew=false (97->97) wrapperState=Z groupGone=true | form=process.kill pgrp==pid:true agentAlive=true logGrew=true (97->1067) wrapperState=Z groupGone=false | PASS |
| B1 | spawn.test.ts registers rootA's bare origin so the run cleanup removes it | cleaned.push(remoteA) at tests/orchestrator/spawn.test.ts:18; originA exists=false after cleanup, rootA exists=false | registered=true pushLine=18 originAfter=false rootAfter=false<br>registered=true pushLine=18 originAfter=false rootAfter=false<br>registered=true pushLine=18 originAfter=false rootAfter=false | registered=false pushLine=(none) originAfter=true rootAfter=false | PASS |
| B2 | worktree.test.ts registers rootM's bare origin so the run cleanup removes it | cleaned.push(remoteM) at tests/orchestrator/worktree.test.ts:222; originM exists=false after cleanup, rootM exists=false | registered=true pushLine=222 originAfter=false rootAfter=false<br>registered=true pushLine=222 originAfter=false rootAfter=false<br>registered=true pushLine=222 originAfter=false rootAfter=false | registered=false pushLine=(none) originAfter=true rootAfter=false | PASS |
| C1 | the replayed scenario leaks no process or fixture directory on the host | every saved pid gone after cleanup; stale /tmp/orch-smoke-* count unchanged; my fixture base removed | savedPids=2 liveSurvivors=0 [] states=1145128:Z,1145129:gone fixtureRootsLeft=0 staleSmoke=0->0<br>savedPids=2 liveSurvivors=0 [] states=1145186:Z,1145187:gone fixtureRootsLeft=0 staleSmoke=0->0<br>savedPids=2 liveSurvivors=0 [] states=1145262:Z,1145263:gone fixtureRootsLeft=0 staleSmoke=0->0 | savedPids=2 liveSurvivors=0 [] states=1145341:Z,1145342:gone fixtureRootsLeft=0 staleSmoke=0->0 | PASS |


Assumptions:
- The AQ fixture shape is copied from `tests/orchestrator/daemon.test.ts:20-45`: a detached `sh -c '"$@" ; echo $?'` wrapper, a node agent on a 100 ms timer, log and exit file under `.kanban/`, and the pid file holding the wrapper pid.
- `cleaned[]` is a plain path list walked by `cleanupAll` (`tests/helpers.ts:277`), so replaying it as a list is faithful. `tests/helpers.ts` is not imported, because its module body deletes `XDG_CONFIG_HOME`.
- A wrapper that the driver has not reaped shows as a zombie under `pidAlive`, so the wrapper is measured by its `/proc/<pid>/stat` state and by whether any non-zombie member remains in its process group.
- The control tree is `HEAD^` (`c4f2e68`) archived with `git archive`: the same fixture with the pre-fix kill form, i.e. trigger-absent for a test-only commit.

Not exercised: acceptance 1-4, which name the three suites (`node tests/orchestrator/*.test.ts`) and their host counts. No `*.test.ts` file was run, per the live-test contract, so the process and directory counts of a full-suite run belong to the test lane. Also not exercised: the 69 stale `/tmp` directories and the pre-existing orphan kill from the housekeeping step.

Observed on the host: `/tmp/orch-smoke-*` read 5 before my first cycle, then 6 and 7, and 0 at the last cycle, while this driver never creates such a path (its fixture base is `/tmp/lt344`). Other lane agents were active during the session, so the Specs' "No other process is running" did not hold for the whole live test. The rows above therefore measure only this driver's own saved pids and fixture paths.

Red proof: the control tree prints the pre-fix single-pid call and leaves the node agent alive with its log still growing (control cell of A2), and leaves both `-origin.git` siblings on disk (control cells of B1 and B2).

Runs: merged x3 (all pass), control x1 (all pass), row disagreements=0.

Verdict: the merged commit behaves as the Specs claim: the group kill takes the agent and no origin is orphaned.

