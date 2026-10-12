---
name: "fix: hub lock is global so a restart can hand the production port to a leaked old-code daemon"
priority: "medium"
state: "doing"
worktree: "fix/165-hub-restart-stale-daemon-takeover"
issuer: "#157"
complexity: "moderate"
shortName: "hub-restart-stale-daemon-takeover"
---

# Summary
The hub election lock (~/.pi/agent/se-llm-team-hub.lock, src/hub.ts:64,:82,:121-138) is machine-global and unrestricted: after the hub dies, any webUi-enabled daemon whose checkout contains hub-aware code re-elects, and the winner binds the configured port (4242) and serves the dashboard from its own in-process webui.ts/hub.ts. During the #157 live test the production daemon therefore could not be restarted safely to serve the merged layout. A restart must return the port to a hub running the production checkout's code, or the agreed alternative resolution must hold.

# Specs
# Context

Found in the live test of #157 (merge commit 42b6e50, 2026-10-12). The sibling finding is #164 (the #134 hot reload does not cover src/kanban.ts). This task is the restart/handover half: it is the technical difficulty that stopped the live tester from exercising the merged change on the production dashboard. The fix itself was verified on an isolated fresh daemon, as #157's task file records.

# Observed (live test of #157)

- The production hub on 4242 (pid 3381383, started 13:31:13) predates the merge (42b6e50 at 13:37:07). The live tester did not restart it: a restart hands the port to whichever daemon wins the global election, and leaked daemons from earlier sessions were running with the global webUi config (port 4242), so one of them can bind 4242 with old code before the production daemon returns.
- Correction carried from #157: the earlier claim that a restart kills in-flight role agents is wrong. Role agents are spawned detached and unref'd (src/orchestrator.ts:277-286) and the exit handler SIGKILLs only in-flight git push children (src/orchestrator.ts:1361-1364). The port/handover risk, not agent death, is the restart blocker.

# Mechanism (verified against main in this PM session)

- One machine-global election lock: LOCK_FILE = "se-llm-team-hub.lock" (src/hub.ts:64), hubLockPath() under ~/.pi/agent (src/hub.ts:82), acquireHubLock create-exclusive with stale-pid steal (src/hub.ts:121-138). No port, root or checkout keying.
- Any webUi-enabled daemon runs joinHub (src/hub.ts:327). After HEALTH_FAILS = 2 consecutive /health failures (src/hub.ts:67) it re-runs the election (src/hub.ts:406); the winner binds the configured host/port and serves the UI from its own in-process module set (src/hub.ts:373-390).
- The hub reads board data from disk per request, so an old-code winner shows FRESH boards with OLD UI/API code - the same mixed-state shape as #164.
- Only hub-aware daemons (checkouts that contain hub.ts and the joinHub call) contend. Verified today: the leaked worktree daemons (430991 from .worktrees/feat/98-*, 1694560 fix/46, 1729526 fix/45) and the /tmp scratch daemons from Oct 10-11 run pre-hub code; they tried to bind 4242 once at their own startup and never re-elect, so #157's live-test wording "any of them can win that race" is too broad. The hazard is the class: a hub-aware daemon started from an old worktree checkout without --no-webui. agents/developer.md:19 tells developers to use the flag for smoke daemons, but agents/live-tester.md carries no daemon-start rule and nothing reaps a daemon when its root or worktree disappears, so hub-aware leaks recur.
- Environment check in this PM session: the lock is held by the production daemon (3381383), the registry carries one entry (se-llm-team, main), and about ten leaked daemons from Oct 10-11 still run (pids 430991, 991299, 994782, 1287218, 1542568, 1694560, 1729526, 2389601, several pre-hub). The class recurs even though today's specific leaks cannot re-elect.

# Impact

- The production dashboard cannot be restarted with confidence during a live test or after a hub.ts/config change: the restart window can hand 4242 to an old-code daemon.
- If an old-code daemon wins failover, every dashboard user gets that checkout's webui.ts/hub.ts until someone notices, and nothing in the UI identifies which checkout (pid, root, commit) is serving.

# Relationship to other tasks

- #40 (done) added --no-webui / SE_LLM_TEAM_NO_WEBUI and the agents/developer.md rule. It prevents startup port theft by smoke daemons, not an already-running hub-aware daemon winning the election.
- #164 (backlog) covers the stale-webui hot reload. If it resolves by reload/invalidation, restarting stops being needed for a kanban.ts change, but this hazard remains for hub.ts or config changes and for hub failover. Not a hard dependency; the two tasks can proceed in parallel.

# Candidate directions (not decided; see Open questions)

- Restrict hub candidacy so only a current-code daemon can win: for example only the extension/production checkout may become hub, while worktree and scratch daemons stand down and only register. During a production restart the dashboard is then briefly down instead of served by old code.
- Guard the election with identity: carry each candidate's checkout root and commit in the register/election exchange and refuse (or preempt) a winner that is not the production checkout. Decide what "production" means (a configured hub root, or the checkout the user launched from).
- Hygiene plus procedure: require --no-webui for every non-production daemon (add the rule to agents/live-tester.md and any prompt that starts daemons), reap leaked daemons (board root or worktree gone, old checkout), and document a safe restart (quiesce contenders, restart, verify who serves).
- Diagnosability: expose the serving hub's pid, root and commit (API, page or log) so a stale-code takeover is visible immediately.

# Acceptance

- A production daemon restart returns the configured port to a hub serving the production checkout's code, and a leaked or old-checkout daemon cannot capture it in the restart window (or the agreed alternative resolution holds).
- The chosen resolution is covered by the hub election/failover tests in src/orchestrator.test.ts (parts U/V/W) and that suite passes; src/webui.test.ts if webui.ts changes; src/kanban.test.ts if kanban.ts changes.
- The prompts/docs the resolution touches are updated (at minimum agents/live-tester.md if the hygiene direction is chosen).

# Notes

# Decision
User's answers (2026-10-12): (1) Restrict hub candidacy so only a daemon running the production/current checkout can win the port - during a restart the dashboard is briefly down rather than served by old code; qualifying daemons are any that are not a task worktree. (2) Auto-reap: a daemon whose root is a task worktree whose task is done or gone is reaped automatically (e.g. on the sweep); no stale daemon lingers to steal the port. (3) Surface checkout info: the serving hub surfaces which checkout it runs (root, commit, pid), e.g. in the dashboard footer, so a takeover or stale hub is visible at a glance. (4) The agent-kill concern is moot: role agents are spawned detached and survive restarts.

1. Preferred direction: restrict hub candidacy so only a daemon running the production/current checkout can win port 4242 (during a restart the dashboard is briefly down rather than served by old code), or keep every daemon eligible for failover and rely on hygiene plus a guarded restart procedure? If restricted, which daemons qualify - only the checkout the extension is installed from, or any daemon that is not a task worktree?
2. Should leaked daemons be reaped automatically, and on which trigger (task done, worktree removed, board root missing, daemon older than N minutes)? Or is a documented manual cleanup plus the --no-webui rule for every non-production daemon enough?
3. If an old-code hub stays possible, should the serving hub surface which checkout (root, commit, pid) it runs, so a takeover is visible to the user?

# Implementation (Developer, 2026-10-12)

Commit e423494 on fix/165-hub-restart-stale-daemon-takeover. All three decided parts are in.

- src/kanban.ts: new exported splitWorktreeRoot(root) splits a task worktree root into [main root, worktree name] and returns null for a non-worktree root; one helper serves both the hub candidacy and the self-reap checks. Unit-covered in src/kanban.test.ts.
- src/hub.ts: joinHub computes canHub = !splitWorktreeRoot(opts.root). A worktree-rooted daemon registers and heartbeats with the hub but never races the election, neither at startup (it logs "no hub answering; task worktree checkout stands down (the port is not ours to take)") nor on re-election after HEALTH_FAILS, so during a production restart the dashboard is briefly down instead of served by old code. Non-worktree daemons are unchanged: parts U/V/W of the hub election/failover tests pass as before (their scratch roots are not worktrees).
- src/orchestrator.ts: a worktree-rooted daemon reaps itself when its owner task is done or gone (worktreeTaskEnded reads the main root's board, so the worktree's own .kanban can be gone). Checked at startup and on every sweep, before acquireLock and the lock self-heal, which would recreate a removed worktree's dirs; the reap line goes to stdout only for the same reason. A done task's daemon exits even when doneCleanup kept the worktree for a manual merge, since the daemon serves nothing there.
- src/hub.ts + src/webui.ts: GET /api/hub returns { pid, root, commit } where root is realpath of src/hub.ts's parent (the code checkout this process serves, symlink-resolved) and commit is that checkout's HEAD resolved live per request. The dashboard renders it in a #hub footer (hidden until the first answer, refetched every refresh cycle): "hub pid N · <checkout> · <short commit>". A 404 shows "hub: old hub code (restart needed)", which is the webui-hot-reload mix state (new page, old hub.ts).
- README.md Web dashboard section documents the footer, /api/hub, the candidacy restriction and the self-reap.
- Tests: part Y in src/orchestrator.test.ts covers the stand-down at startup with no hub up, registration once the hub appears, never serving the ui, reap on done, and reap at startup when the task and worktree are gone (asserting no worktree shell is left behind). All five suites pass: kanban, orchestrator, webui, extension, index.

Assumptions made while implementing (confirm or correct):
- A task worktree is any root whose path contains a .worktrees path segment; no configured allow-list of a "production" root exists or is needed.
- A daemon whose task is done exits even when doneCleanup kept the worktree for a manual merge (the daemon serves nothing in that worktree).
- The reap line goes to stdout only (it lands in .kanban/.logs/orchestrator.log via the inherited fd when started by the orchestrator_start tool); no log file write that could recreate a removed worktree's dirs.
- Scratch (/tmp) daemons stay hub-eligible; the --no-webui rules from #40 remain the hygiene layer for them.
