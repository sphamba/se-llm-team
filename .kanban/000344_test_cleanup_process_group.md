---
name: "test: kill the agent's process group and register the leaked origin remotes"
priority: "low"
state: "live-testing"
worktree: "test/344-test-cleanup-process-group"
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

