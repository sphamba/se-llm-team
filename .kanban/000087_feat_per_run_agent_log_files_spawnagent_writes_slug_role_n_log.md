---
name: "feat: per-run agent log files; spawnAgent writes slug.role.N.log"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Same-role reruns on a task (sequential reviewers) currently append into one log file. Give each agent run its own log file, keeping legacy files readable.

# Specs
Facts (main, verified): spawnAgent at src/orchestrator.ts:178-200 opens logPath(root, `${slug}.${role}`) in append mode (:181), so reruns append into the same file; helpers logPath/pidPath/counterPath at :112-114; callers pass pidName slug (developer :542, reviewer :626, live-tester :633) or `${slug}.merger` (:580).

Changes:
1. spawnAgent writes the run log to `<slug>.<role>.<n>.log` where n = 1 + the max existing index over `.kanban/.logs/` files matching `^<slug>\.<role>\.(\d+)\.log$` (scan the dir at spawn; first indexed run for a role is 0 even when a legacy unsuffixed file exists).
2. Legacy `<slug>.<role>.log` files are never renamed or rewritten; they keep accumulating nothing new (new runs only go to indexed files).
3. Everything else in spawnAgent is unchanged: argv, llmFlags, detached, stdout+stderr both to the log, child.unref(), writePid(pidName).
4. This naming contract is consumed by the webui task "feat: webui agent history per run; subagent logs in the detail card" - keep the patterns exactly as specified here.

Tests (src/orchestrator.test.ts): a spawn writes `<slug>.<role>.0.log`; a same-role rerun writes `<slug>.<role>.1.log`; the developer-log JSONL assertion (:243-247) reads the indexed name; the merger spawn writes `<slug>.merger.<n>.log`; existing pid assertions (:159-167) unchanged.

Acceptance: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

HOLD: behind #69 (doing on fix/69, dirtying src/orchestrator.ts + src/orchestrator.test.ts).

# Notes
