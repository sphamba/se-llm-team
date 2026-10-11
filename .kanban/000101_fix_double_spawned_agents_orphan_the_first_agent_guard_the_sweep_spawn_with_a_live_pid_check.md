---
name: "fix: double-spawned agents orphan the first agent; guard the sweep spawn with a live-pid check"
priority: "high"
state: "backlog"
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
