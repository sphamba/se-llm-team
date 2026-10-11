---
name: "feat: gzip finished agent logs; keep them readable through the webui"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The orchestrator's sweep gzips all agent logs of non-running agents (.kanban/.logs/*.log with no live pid), idempotently, never touching counter files or live logs; the webui transparently decompresses so agentHistory, /api/agent-log and subagent lists keep working on .log.gz files.

# Specs
Per user rule: when the orchestrator processes a task, all logs of NON-running agents are gzipped, and gzipped logs stay readable. Scope: .kanban/.logs/<slug>.<role>[.<n>].log files (indexed and legacy unsuffixed) whose agent pid is not alive. Hook: extend the sweep (or the #113 janitor pass) so every sweep gzips any matching .log whose slug has no live pid (the #105 retro-sweep skip pattern: skip any slug with a live pidfile), idempotent — already-gzipped files skipped, counter files (<slug>.count, <slug>.dead.count, <slug>.reviewer-runs) never touched, live/running agents' logs stay plain and appendable. Produces <name>.log.gz (replaces the plain file). Readability (src/webui.ts): agentHistory scans both .log and .log.gz (run index, mtime, tokens/duration, alive probing unchanged); the /api/agent-log allowlist accepts .gz handles and serves them through the existing chunked payload by decompressing transparently — head/tail walk-back on the decompressed text (finished logs only, so live polling is a no-op for them); subagentLogs' Agent ID / Output file matching parses decompressed records so subagent lists still work on gzipped finished logs. No log renames beyond the .gz suffix; handles keep working in the detail card. Tests: src/orchestrator.test.ts — the sweep gzips a finished agent's log, skips a slug with a live pid, skips counter files, is idempotent; src/webui.test.ts — agentHistory includes a .log.gz run and /api/agent-log serves it with renderable content. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts. Files: src/orchestrator.ts, src/webui.ts, src/kanban.test.ts unchanged, src/orchestrator.test.ts, src/webui.test.ts. Coordination: blocked by #118 (backlog, same src/webui.ts renderer region) which is blocked by #52.

# Notes
