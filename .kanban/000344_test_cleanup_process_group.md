---
name: "test: kill the agent's process group and register the leaked origin remotes"
priority: "low"
state: "backlog"
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
