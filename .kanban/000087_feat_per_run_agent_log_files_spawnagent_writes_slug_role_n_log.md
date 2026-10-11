---
name: "feat: per-run agent log files; spawnAgent writes slug.role.N.log"
priority: "medium"
state: "reviewing"
worktree: "feat/87-per-run-agent"
---

# Summary
Same-role reruns on a task (sequential reviewers) currently append into one log file. Give each agent run its own log file, keeping legacy files readable, and cap reviewer successful runs per task at 3.

# Specs
Facts (main, verified): spawnAgent at src/orchestrator.ts:178-200 opens logPath(root, `${slug}.${role}`) in append mode (:181), so reruns append into the same file; helpers logPath/pidPath/counterPath at :112-114, readCounter/bumpCounter :124-135; poll() :685-714 handles dead agents via DEAD_TRANSITIONS and the dead counter with RESPAWN_CAP = 5; reviewers spawn from tasks in to-review (:626); callers pass pidName slug (developer :542, reviewer :626, live-tester :633) or `${slug}.merger` (:580).

Changes:
1. spawnAgent writes the run log to `<slug>.<role>.<n>.log` where n = 1 + the max existing index over `.kanban/.logs/` files matching `^<slug>\.<role>\.(\d+)\.log$` (scan the dir at spawn; first indexed run for a role is 0 even when a legacy unsuffixed file exists).
2. Legacy `<slug>.<role>.log` files are never renamed or rewritten; they keep accumulating nothing new (new runs only go to indexed files).
3. Everything else in spawnAgent is unchanged: argv, llmFlags, detached, stdout+stderr both to the log, child.unref(), writePid(pidName).
4. Reviewer successful-run cap (user feedback, adjusted): a reviewer run is successful when the agent set the task state itself before exiting (back to to-review after making changes, or forward to to-live-test on approval), as opposed to a died run, which the existing dead counter handles. Count successful reviewer runs per task in a counter file next to the dead/merge counters (counterPath helper, e.g. `<slug>.reviewer-runs.count`, exact name the developer's choice). When the orchestrator would spawn a reviewer for a task whose successful-reviewer count is >= 3, do not spawn; re-read the task with kanban_get, and when the state still matches, move it to to-live-test (kanban_set_state) and log "reviewer succeeded 3+ times, moving to to-live-test". The counter clears when the task reaches to-live-test, so a future rework cycle starts fresh.
5. This naming contract is consumed by the webui task "feat: webui agent history per run; subagent logs in the detail card" - keep the patterns exactly as specified here.

Tests (src/orchestrator.test.ts): a spawn writes `<slug>.<role>.0.log`; a same-role rerun writes `<slug>.<role>.1.log`; the developer-log JSONL assertion (:243-247) reads the indexed name; the merger spawn writes `<slug>.merger.<n>.log`; the roleStub reviewer sets to-review 3 times and the 4th spawn is refused with the task moved to to-live-test and the log line present; the counter clears on the to-live-test advance; an approval (to-live-test) counts toward the cap; died runs do not; existing pid assertions (:159-167) unchanged.

Acceptance: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

HOLD: behind #69 (doing on fix/69, dirtying src/orchestrator.ts + src/orchestrator.test.ts).

# Notes
