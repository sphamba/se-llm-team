---
name: "test: integration of #344"
priority: "low"
state: "done"
worktree: ""
issuer: "auto"
complexity: "simple"
shortName: "integration-of-344"
---

# Summary
Integration test of the merged base branch after #344.

# Specs
## Own task

Perform integration testing following the merge of #344.

Run the project test script in the root checkout.
Report defects and coverage gaps in `

## Live test

Test-only change: no test file was run. Each row replays the scenario through the production function (`killTree` from `src/pid.ts`) or through the merged test file's own kill form, and the control tree replays the pre-fix form on the same fixture.

# Live test: process group kill and origin remote cleanup

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
- A wrapper that the driver has not reaped shows as a zombie under `pidAlive`, so the wrapper is measured by its `/proc/<pid>/stat` state and by whether `kill(-pid, 0)` still reaches the group.
- The control tree is `HEAD^` (`c4f2e68`) archived with `git archive`: the same fixture with the pre-fix kill form, i.e. trigger-absent for a test-only commit.

Not exercised: acceptance 1-4, which name the three suites (`node tests/orchestrator/*.test.ts`) and their host counts. No `*.test.ts` file was run, per the live-test contract, so the process and directory counts of a full-suite run belong to the test lane. Also not exercised: the 69 stale `/tmp` directories and the pre-existing orphan kill from the housekeeping step.

Observed on the host: `/tmp/orch-smoke-*` read 5 before my first cycle, then 6 and 7, and 0 at the last cycle, while this driver never creates such a path (its fixture base is `/tmp/lt344`). Other lane agents were active during the session, so the Specs' "No other process is running" did not hold for the whole live test. The rows above therefore measure only this driver's own saved pids and fixture paths.

Red proof: the control tree prints the pre-fix single-pid call and leaves the node agent alive with its log still growing (control cell of A2), and leaves both `-origin.git` siblings on disk (control cells of B1 and B2).

Runs: merged x3 (all pass), control x1 (all pass), row disagreements=0.

Verdict: the merged commit behaves as the Specs claim: the group kill takes the agent and no origin is orphaned.


# Open questions`.
Read the full task file of a covered ref when its summary is not enough.
Do not edit code. Do not commit. Do not create a task. Do not change task states.

## Covered tasks

### #344 test: kill the agent's process group and register the leaked origin remotes

> Part AQ of daemon.test.ts kills the agent with a single-pid SIGKILL, but the pid file holds the group-leading sh wrapper that spawn.ts:260 starts detached. The node agent survives every run, reparented to init, so a full suite leaves one fake-agent process behind. Production already kills by group via killTree, so only this test site is wrong. The same task registers the two -origin.git remotes that spawn.test.ts and worktree.test.ts create and never clean.

# Notes
Generated by the orchestrator when #344 was merged to the base branch.
Base: 94f004b4f2ba090954b261c8cb67ea80b7cfd82c. Suites: node per file (39 files). Passed: 39. Failed: 0.
