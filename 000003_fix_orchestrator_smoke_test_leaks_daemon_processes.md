---
name: "fix: orchestrator smoke test leaks daemon processes"
priority: "low"
state: "live-testing"
worktree: "fix/orchestrator-smoke-test-leaks-daemon-processes"
---

# Summary
src/orchestrator.test.ts leaves spawned daemon processes alive after the test ends. More than 10 `node src/orchestrator.ts --root /tmp/orch-smoke-*` processes linger. The test must clean up every process it spawns, also on failure.

# Specs
# Need

Running src/orchestrator.test.ts leaks daemon processes. Verified with ps: pids 208731, 211468, 213029, 216545, 218981, 243221, 245912 all run `node src/orchestrator.ts --root /tmp/orch-smoke-* --rescan-seconds 1 --poll-minutes 0.05` long after their test runs ended. One (pid 527983) even runs the daemon from inside an old task worktree: /home/phamba/repos/se-llm-team/.worktrees/fix/poll-respawns-finished-agents-because-agent-state-updates-never-reach-the-main-board/src/orchestrator.ts with root /tmp/orch-smoke-BJpMJG.

# Required behavior

1. The smoke test kills every daemon process it spawns before it exits, and every agent the daemons spawned.
2. Cleanup must also happen when the test fails or is interrupted (for example process.on("exit") plus explicit child kill calls, same pattern the daemon itself uses for its lock).
3. Do not change what the test asserts. Do not change the daemon code for this task.

# Constraints

- Minimal diff, only src/orchestrator.test.ts (and housekeeping for the leaked processes).
- No new dependencies.

# Acceptance criteria

- `node src/orchestrator.test.ts` passes.
- After the test finishes, `ps aux | grep orch-smoke` shows no processes started by that run.
- The already leaked processes are killed (housekeeping, part of this task).

# Notes

## 2026-10-24, developer

Root cause: `src/orchestrator.test.ts` killed its daemons only on the happy path (`daemon.kill("SIGTERM")` after the assertions). A failed assert, a `waitFor` timeout (which called `process.exit(1)` without killing anything), or an interrupt left the daemons running. Agents spawned detached by the daemons survive a daemon kill, so they needed their own cleanup path.

Fix (only src/orchestrator.test.ts, 49 insertions, 7 deletions):

- Every daemon is registered in a `daemons` list at spawn.
- `killAll()` SIGKILLs all registered daemons, then kills every agent the daemons spawned, read from each root's `.pids/` pidfiles. Each pid is killed only if `/proc/<pid>/cmdline` still references the root, so a recycled pid never takes an unrelated process down.
- Cleanup hooks: `process.on("exit")` runs `killAll()` plus the existing fixture-dir removal, so failed asserts and unhandled rejections clean up (verified: the exit event fires on both). Explicit SIGINT/SIGTERM handlers do the same and exit 130/143, since the default signal action skips exit handlers.
- `waitFor`'s timeout path now calls `killAll()` instead of only removing the fixture dirs.
- Assertions and daemon code unchanged.

Verification: `node src/orchestrator.test.ts` passes; after it finishes `ps aux | grep orch-smoke` and `/tmp/orch-smoke-*` show nothing from that run. A deliberately broken copy (failed assert) exits 1 with no leftovers. SIGTERM mid-run exits 143 with no leftovers, confirmed with an instrumented copy showing the handler firing and killing the daemon. Agents in the smoke test are stubs that exit instantly, so the pidfile sweep is a no-op there by design.

Housekeeping: killed the leaked daemons listed in the task (all already gone except pid 527983, which ran from the old poll-respawns worktree) and removed the stale `/tmp/orch-smoke-*` roots. Daemons seen during verification from the other task worktrees (orchestrator-start-tool-throws, commit-kanban-tasks) were concurrent live runs of the old test there, not mine, and were left alone. Pid 420117 is the repo's real orchestrator daemon (root se-llm-team), not a leak.

Note: one earlier verification round appeared to leak pid 627243, but that was a flaw in my own test command (`cd X && node test & TESTPID=$!` made `$!` the subshell pid, so the SIGTERM never reached node, which was still running mid-test when checked). Not a code bug; later rounds with correct pid capture were clean.

## 2026-10-24, reviewer

One fix committed (030dae9): `agentPids()` in src/orchestrator.test.ts read the pidfiles from `root/.pids`, but the daemon writes them to `kanbanDir(root)/.pids` = `root/.kanban/.pids`. The catch swallowed the ENOENT, so the agent sweep returned `[]` every time and was dead code. That violated required behavior 1 (kill every agent the daemons spawned). Fixed by reading `join(kanbanDir(root), ".pids")` (2 lines, kanbanDir already imported).

Verification of the fix: ran the same instrumented check against HEAD and against the fix. In the check a fake long-running agent is planted with a pidfile in the daemon's real pidfile dir before the exit hook fires. HEAD let the fake agent survive (confirmed the bug is load-bearing); the fixed version kills it. `node src/orchestrator.test.ts` passes (exit 0), `ps aux | grep orch-smoke` and `/tmp/orch-smoke-*` show nothing after the run. Failed-assert path spot-checked: exits 1 with no leftovers. Everything else in the diff reviewed and correct: daemons registered at spawn, SIGKILL before the agent sweep (no respawn race), cmdline guard also covers pid 0, exit and SIGINT/SIGTERM hooks idempotent, assertions unchanged, daemon code untouched, no new dependencies.

Housekeeping re-checked: no orch-smoke processes and no `/tmp/orch-smoke-*` roots remain. Only the repo's real orchestrator daemon (pid 420117, root se-llm-team) runs, as the developer noted.

## 2026-10-10, reviewer (second round)

Re-reviewed both commits (be34bfb, 030dae9) against the Specs. No new fixes needed; set the task to to-live-test.

- Code check: `agentPids` reads `kanbanDir(root)/.pids` = `root/.kanban/.pids`, the same directory where the daemon's `writePid` writes agent pids. The 030dae9 fix is correct.
- Code check: the exit hook, the SIGINT/SIGTERM handlers, and the `waitFor` timeout path all run `killAll()`. All handlers are synchronous, so they work inside `process.on("exit")`, and they are idempotent.
- Instrumented check at HEAD: planted a fake long-running agent (cmdline contains the fixture root) with a pidfile in the daemon's real pidfile dir `root/.kanban/.pids`. The test passed (exit 0), and after the run the fake agent was dead, the daemons were killed, and all fixture roots were removed. This confirms the agent sweep is load-bearing.
- Ran `node src/orchestrator.test.ts`: passes (exit 0). After the run, no orch-smoke processes and no `/tmp/orch-smoke-*` roots from this run. One daemon (pid 677888) was seen mid-check, but it belonged to the concurrent test run in the role-agents-edit worktree, which was still in progress; it exited normally and was left alone.
- Assertions unchanged, daemon code untouched, no new dependencies.
