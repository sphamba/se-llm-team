---
name: "feat: to-merge and merging states; orchestrator spawns mergers from to-merge, one at a time"
priority: "critical"
state: "doing"
worktree: "feat/78-to-merge-and"
---

# Summary
Two new task states, to-merge and merging, between live-testing and done. The live-tester sets to-merge when live testing passes; the orchestrator spawns one Merger agent at a time from tasks in to-merge; the merger sets merging, first merges main into the branch (conflicts resolved and tests run in the worktree), then the branch into main, and sets done - or requeues to to-merge when it fails, retried after the idle cooldown.

# Specs
New merge flow: live-testing -> to-merge -> merging -> done (merger sets back to to-merge on failure). User decisions settled: idle-cooldown retries (a failed merge is retried only after the task sat idle in to-merge for the failsafe interval), at most one Merger agent running at a time, main must never sit in a dirty merge conflict state.

Facts (verified at HEAD e4c0358; line numbers rebase on the merged code):
- STATES (src/kanban.ts:4-13, 8 states), TaskState :14, IN_PROGRESS :39 (to-do..live-testing, consumed by listTasks scope filter :116); parseTask :98 falls back unknown state -> "backlog"; kanban_set_state enum auto-extends from STATES (src/index.ts:100/103); orchestrator_status counts dynamically. Nothing else enumerates states.
- mergeDone(root, cfg, task): defers while pidAlive(agentPid(root, slug)) || pidAlive(agentPid(root, "${slug}.merger")); no worktree and no branch -> setWorktree(""), return true; merges the branch into main directly (git(root, ["merge", "--no-edit", branch]), NO merge-main-into-branch step today); success -> worktree remove --force, branch -d, setWorktree(""), log "merged ${branch}"; conflicts -> counter .logs/{slug}.merge-attempts.count, >= 3 -> bump once + log "still conflicts after 3 attempts, left for manual resolution" once, then frozen; else bump, log "merge conflict ... spawning merger (attempt N)", appendNote, spawnAgent(..., "merger", cwd=root, pidName "${slug}.merger").
- rescan done-branch: const merged = !task.worktree || mergeDone(...); on exit + merged -> commitKanban "kanban: done". autoSchedule at the end of the sweep. poll() uses DEAD_TRANSITIONS (doing->to-do, reviewing->to-review, live-testing->done): dead pid -> clear + advance state; being reworked by #95 (unconditional bounce + idle-cooldown respawn).
- spawnAgent (detached, log .logs/${slug}.${role}.log, writePid(root, pidName ?? slug, pid)); pid helpers pidAlive/writePid/clearPid/agentPid; acquireLock (stale-pid steal pattern). Exactly one daemon per project (lock under .kanban/), so an in-daemon merger check suffices.
- agents/live-tester.md: sets state to done "whatever the test result. The pipeline then merges the branch"; reports issues to a PM subagent (failure path unchanged). agents/merger.md: resolves conflicts in the root checkout ("main branch wins unless the task Specs say otherwise"), appends Notes, sets no state, never touches .worktrees.
- Tests: src/orchestrator.test.ts roleStub (transitions Live-tester->done; no Merger branch); full-pipeline asserts "spawned developer/reviewer/live-tester" + "merged feat/1-smoke-test"; Part G merge deferral while agent pid alive; Part K the 3-attempt give-up flow (deadStub merger dies instantly, counter asserts, give-up logged once, counter frozen, stuck task stays done). src/webui.test.ts STATE_NAMES duplicates the 8 states. src/kanban.test.ts: no STATES enumeration.

Changes:
1. STATES gains "to-merge" and "merging" between live-testing and done (10 states; IN_PROGRESS gains both so scope=in-progress and orchestrator_status count them). kanban.test.ts: assert the new states parse and count as in-progress.
2. Orchestrator: replace the merge-on-done path with a to-merge sweep in the per-task sweep: for each task in state to-merge, skip while the task's agent or previous merger pids are alive; spawn a Merger only when no merger is running anywhere: global "merger" pid file (writePid(root, "merger", pid) at spawn, pidAlive(agentPid(root, "merger")) checked before spawn, cleared by the sweep when the task leaves merging). Idle cooldown: a task that re-entered to-merge from a failed merge is retried only after it sat idle in to-merge for cfg.autoScheduleMinutes (5 min default). The orchestrator sets the task to merging when it spawns its merger.
3. Merger flow (agents/merger.md rewrite): on start set merging; merge main into the task's branch in the branch worktree, resolving conflicts there (main branch wins unless the task Specs say otherwise) and running the test suites in the worktree; then merge the branch into main from the root checkout (clean, no conflicts expected on main) and commit; set done; append to Notes what was resolved. When the merge cannot be completed (unresolvable conflict, failing tests), set back to to-merge with a Note. Never leave main in a dirty merge conflict state: abort with git merge --abort in whatever repo is dirty before requeueing. Touch only the task's own worktree, never other worktrees.
4. agents/live-tester.md: set to-merge (not done) when live testing passes; the failure path (report to a PM subagent) is unchanged.
5. DEAD_TRANSITIONS: live-testing->done becomes live-testing->to-merge; add merging->to-merge (dead merger's task requeues, stale pid cleared). Rebase on #95's unconditional-bounce + idle-cooldown poll. The deferral and no-worktree handling move into the to-merge sweep / done handling (a done task with no worktree still gets setWorktree(""); the "kanban: done" mirror commit at done stays).
6. The old 3-attempt cap, the .logs/{slug}.merge-attempts.count counter, and the give-up message are removed (replaced by the cooldown requeue loop).
7. Tests (src/orchestrator.test.ts): roleStub gains a Merger branch (merging->done on success; a failing variant that sets back to to-merge); the full-pipeline assert covers the to-merge sweep spawning the merger and the merge completing; Part K rewritten: conflict -> merger sets back to to-merge -> no respawn before the cooldown elapses -> respawn after; single-merger assert (two tasks in to-merge -> exactly one merger); keep the deferral coverage (Part G).
8. README.md: states list (10), the new merge flow (to-merge sweep, single merger, cooldown), liveness transitions, drop the 3-attempt cap and merge-attempts counter docs.

Acceptance:
- Live testing passes -> task lands in to-merge -> a merger spawns -> merging -> main merged cleanly -> done.
- A failed merge lands back in to-merge and is retried only after the idle cooldown; main is never left mid-merge.
- Never more than one merger process at a time, even with several tasks in to-merge.
- kanban_set_state accepts the new states; scope=in-progress includes them.
- Typecheck and full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Constraints:
- Files: src/kanban.ts, src/orchestrator.ts, src/orchestrator.test.ts, src/kanban.test.ts, agents/live-tester.md, agents/merger.md, README.md.
- The earlier holds (000071, 000074) are satisfied and dropped. HOLD behind #95 (critical, rewrites poll()/DEAD_TRANSITIONS): this task rebases its live-testing->to-merge mapping on #95's unconditional bounce and idle-cooldown respawn, and is sequenced after it. Also behind #87 (to-do, rewrites src/orchestrator.ts + test).
- No src/webui.ts changes in this task: columns render from STATES automatically; accents and spinner are the webui task's.

# Notes
