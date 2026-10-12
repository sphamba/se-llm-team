---
name: "fix: hub lock is global so a restart can hand the production port to a leaked old-code daemon"
priority: "medium"
state: "done"
worktree: ""
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

# Review (Reviewer, 2026-10-12)

- All three decided parts are in and match the user's answers: candidacy restriction (canHub = !splitWorktreeRoot(opts.root) in joinHub; a worktree daemon stands down at startup and never re-elects after HEALTH_FAILS, but still registers and heartbeats), self-reap (worktreeTaskEnded reads the main root's board, checked at startup and on every sweep before acquireLock and the lock self-heal), and the hub identity (GET /api/hub -> { pid, root, commit }, #hub footer, 404 -> "hub: old hub code (restart needed)").
- The branch was based on b5e551c, which predates the #164/#166 merges into main. Merging main into the branch conflicted in 3 files (hub.ts, orchestrator.ts, webui.test.ts; import blocks and the hub.ts header). Resolved in merge commit fa7f502 per repo convention: combined import lists, CODE_ROOT kept next to DEFAULT_WEBUI_PATH, main's module-graph hot reload intact. /api/hub sits in hub.ts's static route (hub.ts is never hot-reloaded), so the 404 mix-state display works as designed together with #164.
- Verified the recorded assumptions against the code: main() resolves --root with path.resolve, which normalizes trailing separators, so splitWorktreeRoot cannot mis-split a passed root; the reap check runs before loadConfig/bootstrapBoard/acquireLock and writes via process.stdout.write only, so no removed-worktree dirs are recreated; scratch (/tmp) daemons stay hub-eligible, which matches user answer (1). No new silent assumption found.
- No fixes to the developer's code were needed; the only commit is the merge. Full suite passes on the merged result (kanban, orchestrator, webui, extension, index; exit 0).

# Merge (Merger, 2026-10-12)

- Step 1 (base into the branch): the project root had main checked out at 7ecec18. main was already an ancestor of the branch head fa7f502, because the reviewer's merge commit fa7f502 had already brought main in. git merge main reported "Already up to date". No conflicts, so the test suites did not run again in the worktree.
- Step 2 (branch into the base): the project root still had main checked out at 7ecec18, and the root was clean. git merge --no-edit fix/165-hub-restart-stale-daemon-takeover fast-forwarded main 7ecec18 -> fa7f502. No conflicts. main now carries the fix commit e423494 and the review merge fa7f502: splitWorktreeRoot in src/kanban.ts, the worktree candidacy stand-down and GET /api/hub in src/hub.ts, the worktree self-reap in src/orchestrator.ts, the hub footer in src/webui.ts, the README.md section, and the test additions in src/kanban.test.ts, src/orchestrator.test.ts and src/webui.test.ts.
- No conflicts appeared in either step, so no suite re-run was needed; the reviewer's full-suite pass on fa7f502 stands, and the live test runs on the merged commit next.

## 2026-10-12, live-tester

Result: the merged change's own flows PASS. Two findings forwarded as a new-task request to the Project manager. The unit suites were not run.

Setup: scratch clone of the merged checkout fa7f502 at /tmp/t165/repo with the real meta/kanban mirror ref removed, an isolated HOME, webUi on 127.0.0.1:4488, SE_LLM_TEAM_HUB_HEALTH_MS=500. Daemon roots: the clone (production shape), a git worktree .worktrees/probe at the merged code, and a git worktree .worktrees/old-probe at 7ecec18 (hub-aware code from before this fix). Both probe owner tasks stayed alive with live sleep pids in .kanban/.pids. No daemon touched the real board and no real agent ran.

Verified flows (new code, all PASS):

1. Stand-down at startup with no hub: the .worktrees/probe daemon logged "no hub answering; task worktree checkout stands down (the port is not ours to take)", took no hub lock, and 4488 had no listener.
2. Registration with a live hub: after the clone daemon became the hub ("web ui on http://127.0.0.1:4488 (hub for repo)"), the worktree daemon logged "registered probe with the hub at http://127.0.0.1:4488" and both roots appeared in the registry and in /api/projects.
3. Restart window: after the hub (pid 3856361) was killed, 4488 had no listener and no /health answer for 5 s (10 health ticks at 500 ms). The worktree daemon did not bind. A restarted clone daemon (pid 3857453) became the hub again, and the port served the production root and commit.
4. Self-reap on done: 0.8 s after the owner task moved to done in the main board, the worktree daemon wrote "task worktree daemon reaped: task done or gone (/tmp/t165/repo/.worktrees/probe)" and exited.
5. Self-reap at startup: with the task gone (worktree present, and then worktree removed) the daemon exited with code 0, and no .kanban or worktree directory was created or re-created.
6. Hub identity: GET /api/hub answered {"pid":3857453,"root":"/tmp/t165/repo","commit":"fa7f5023b3328c47357981ae9097ec7f617de22d"}. Real Chromium showed the visible footer "hub pid 3857453 · /tmp/t165/repo · fa7f502".
7. Mix-state display: on the production dashboard at 4242 (old hub code with the new hot-reloaded webui.ts, read-only GETs) GET /api/hub is 404 and the footer shows "hub: old hub code (restart needed)".

Findings:

1. Medium: a leaked hub-aware worktree daemon from a pre-#165 checkout still captures the port in the restart window. The candidacy restriction and the self-reap run inside the daemon's own code, so a pre-existing daemon with old code ignores both. Test: the .worktrees/old-probe daemon (7ecec18, pid 3861108) registered with the new-code hub. After that hub was killed, the old daemon bound 4488 within 3 s (/health 200, /api/hub 404, hub lock held by 3861108). A restarted production daemon (fa7f502, pid 3861738) could only register with the old-code hub ("registered repo with the hub") and the port never returned to the production code. This is the leaked-daemon class that the Mechanism section names, so the acceptance "a leaked or old-checkout daemon cannot capture it in the restart window" is not met for pre-existing leaks. New task requested.
2. Low: candidacy detection is path-based. A new-code daemon rooted at a git worktree outside .worktrees (/tmp/t165/wt-outside) treated itself as production and bound 4488 ("web ui on http://127.0.0.1:4488 (hub for wt-outside)"). The orchestrator always creates task worktrees under .worktrees, so the real-world impact is small. This confirms the developer's recorded assumption and contradicts the decision wording "any daemon that is not a task worktree". New task requested to confirm or correct the rule.

Assumptions made while designing the usage tests:

- The scratch clone at the merged commit is equivalent to the project root checkout. A hand-made git worktree with a live sleep pid for its owner task models a daemon started in a task worktree, as prior live tests did.
- A pre-fix hub-aware daemon is represented by the 7ecec18 worktree, the main merge base before this fix.
- SE_LLM_TEAM_HUB_HEALTH_MS=500 changes the poll cadence only, not the election logic.
- Read-only GETs to the production dashboard (4242) are safe and do not touch the real board.
- Finding 2 uses a worktree layout that the orchestrator never creates.

Observed behaviour that contradicts the task's stated assumptions: none beyond finding 1 (the restart guarantee) and finding 2 (the consequence of the path rule). All other recorded assumptions hold against the running system.

Technical note for the next live test: a bare clone of the repo carries refs/heads/meta/kanban, so the fixture daemon bootstraps the real board and spawns agents for real tasks. Delete that ref from the scratch origin (git -C origin.git update-ref -d refs/heads/meta/kanban) before the clone. AGENTS.live-tester.md is updated with this rule.

# Open questions

