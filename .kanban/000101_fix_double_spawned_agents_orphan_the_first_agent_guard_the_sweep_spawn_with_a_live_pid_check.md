---
name: "fix: double-spawned agents orphan the first agent; guard the sweep spawn with a live-pid check"
priority: "high"
state: "done"
worktree: ""
---

# Summary
Two scans seconds apart both spawned a developer for the same to-do task; the second writePid overwrote the first, leaving two live agents editing the same worktree. Guard every sweep spawn with a live-pid deferral like mergeDone's merger check.

# Specs
FINDING (orchestrator.log, 2026-10-11): after two manual to-do promotions and a poke, the sweep spawned developer pid=3742261 for 000077 at 12:57:11 and pid=3742713 for the same task at 12:57:15; likewise pid=3742272 then pid=3742801 for 000078 at 12:57:11 and 12:57:17. The second spawnAgent's writePid(root, slug, pid) overwrote the first pair's pid file, so the first agents kept running untracked. All four processes were verified alive afterwards, writing four developer logs (000077 .developer.1/.2, 000078 .developer.0/.1) into two shared worktrees - duplicate agents editing the same files.

ROOT CAUSE: the sweep spawns from the state attribute only. Two triggers (the 500ms-debounced fs.watch on the promoted task file and the poke/interval scan) can both pass between the read of the state and the agent's first state edit. The spawn path has no live-agent guard.

FIX:
1. Before spawning a developer/reviewer/live-tester in the sweep, skip while pidAlive(agentPid(root, slug)) - the same deferral pattern mergeDone uses for agent/merger pids. The state edit to doing alone is not a guard; the live-pid check is.
2. Set the state attribute before spawning (read-set-spawn ordering) so a second sweep sees doing and skips; keep the live-pid check as the belt.
3. Orphan recovery (one-time, manual or startup): on scan, when a task's agent pid file names a live process but the task was re-spawned (per-run logs newer than the pid file), leave as is - do not auto-kill; the fix prevents new orphans only.
4. Tests: src/orchestrator.test.ts - a sweep pass with a live pid file for the task does not spawn a second agent; set-before-spawn ordering asserted via the mirror/argv log.

Acceptance: two rapid sweep passes spawn at most one agent per task; the pid file always names the single live agent; full suite green: node src/orchestrator.test.ts, node src/kanban.test.ts, node src/webui.test.ts.

Constraints:
- Files: src/orchestrator.ts, src/orchestrator.test.ts.
- HOLD behind #78 (doing on feat/78-to-merge-and, dirtying src/orchestrator.ts + test) and #77 (doing on feat/77-webui-board-ordering, not dirtying these files but active). Rebase on the merged code.

# Notes
- Guarded the sweep spawns with a live-pid check: startTodo skips when pidAlive(agentPid(root, slug)), and the to-review and to-live-test branches defer their spawn the same way. The reviewer-run marker is still consumed before the check, so approved runs keep counting.
- Set the state attribute before spawnAgent for all three roles: doing, reviewing, live-testing. A second sweep reads the new state. The live-pid check stays the belt.
- No orphan auto-kill: spec item 3 leaves a re-spawned task with a live pid alone, so the fix prevents new orphans only.
- New test part AB in src/orchestrator.test.ts: a lingering developer stub records the state it reads at startup. The test rewrites the live task to to-do, then asserts one spawn only, an untouched pid file, and a second spawn only after the first agent dies. Negative control: with src/orchestrator.ts stashed, part AB fails with "no second developer while the first agent pid is alive: 2 !== 1".
- Suites green: node src/kanban.test.ts, node src/webui.test.ts, node src/orchestrator.test.ts (19 passed lines, exit 0). Commit 5d1abc8 on fix/101-double-spawned-agents. #77 and #78 are done and merged at the base (HEAD == main).
- Reviewer pass on commit 5d1abc8: no fixes needed. All four sweep spawn sites were checked. startTodo, the to-review branch and the to-live-test branch now defer while pidAlive(agentPid(root, slug)) and set the state before the spawn. sweepToMerge already had the task-pid and merger-pid deferrals and it is unchanged. The reviewer-run marker is consumed before the deferral, so approved runs still count. updateAttrs re-reads the file and patches only the changed key, so the repeated ensureWorktree calls in a deferred sweep cannot clobber a concurrent state change by the live agent.
- The negative control was reproduced in a scratch copy of this worktree with main's src/orchestrator.ts: part AB fails with "no second developer while the first agent pid is alive" (2 !== 1). With the fix, the full orchestrator suite prints its 19 pass lines and exits 0. src/kanban.test.ts and src/webui.test.ts pass.
- Orphan recovery stays absent by design, per spec item 3. PID reuse stays an accepted limit.
- Live test (2026-10-11), run from the worktree with the repo as a user runs it. Suites: node src/kanban.test.ts -> all assertions passed, exit 0. node src/webui.test.ts -> all assertions passed, exit 0. node src/orchestrator.test.ts -> all 19 smoke parts passed (final line: '+ double-spawn live-pid guard smoke passed'), exit 0.
- Live test, independent scratch project (git repo + .kanban + lingering stub agent, daemon started as `node src/orchestrator.ts --root <scratch> --rescan-seconds 1 --poll-minutes 0.05`): no second spawn while the first agent pid is alive. For each of the three guarded sites, the task was rewritten back to its pre-spawn state (to-do, to-review, to-live-test) while the agent still ran. Result after 3.5s: exactly one developer, one reviewer, one live-tester. The pid file stayed on the first agent. The state attribute already read doing / reviewing / live-testing at agent startup. All 7 checks passed.
- Negative control on the same scratch harness with main's src/orchestrator.ts (checked out to a scratch worktree, not edited): all three sites double-spawned (developer 2, reviewer 2, live-tester 2), exit 1. This confirms the fix is what prevents the twin spawn.
- No issues found. No orphan auto-kill was exercised because spec item 3 states the fix prevents new orphans only. No open questions.
