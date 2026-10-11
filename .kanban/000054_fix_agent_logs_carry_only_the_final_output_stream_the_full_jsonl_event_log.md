---
name: "fix: agent logs carry only the final output - stream the full JSONL event log"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Agents run pi --approve -p (print mode), so .kanban/.logs/{slug}.{role}.log receives only the final assistant text. Spawn agents with --mode json so the log carries the full JSONL event stream (thinking, tool calls, text), and have the webui agent view render those events readably.

# Specs
Facts:
- spawnAgent (src/orchestrator.ts:124-142) spawns the agent as [agent, "--approve", "-p", prompt] with stdio ["ignore", out, out] (detached, direct fd write). Print mode stdout is only the final assistant text.
- pi --mode json emits strict JSONL: session header, message_start/update/end (message_update carries assistantMessageEvent: thinking_start/thinking_delta/thinking_end, text_start/text_delta/text_end, toolcall_start/toolcall_delta/toolcall_end), tool_execution_start/update/end, turn/agent events. Stdout is reserved for JSONL; diagnostics go to stderr.
- The webui agent view (000033, merged) serves the log via GET /api/agent-log?file=...&offset=... (byte-offset tail/history chunking) and renders the returned text.

Changes:
1. src/orchestrator.ts spawnAgent: add "--mode", "json" to the spawn args, so the log carries the JSONL event stream. Keep the detached spawn with the direct fd write and pid tracking unchanged; stdout and stderr both still append to the same log file (stderr diagnostics are non-JSON and interleaved).
2. src/webui.ts: in the /api/agent-log path, parse the chunk server-side and return readable lines: thinking_start/delta/end rendered as thinking lines, toolcall_* and tool_execution_start/end rendered as tool lines (tool name plus a short arg summary), text_* as text, message_end as the final text. Chunking stays byte-based; drop a partial record when the byte boundary splits a JSONL line. Lines that fail JSON.parse pass through unchanged (stderr diagnostics, legacy final-text content from old logs).

Do NOT have the daemon consume the child's stdout to write its own readable log: that would tie agent lifetime to the daemon (a dead reader stalls or kills the agent on pipe fill). The detached direct-fd write keeps agents alive across daemon restarts.

Tests:
- orchestrator.test.ts: a spawned agent's log contains JSONL message/tool events, not only the final text.
- webui.test.ts: the parser renders thinking/tool/text entries and passes non-JSON lines through unchanged.

Schedule note: queues behind 000051 (src/orchestrator.ts) and 000036 (src/webui.ts) - both own one of this task's files.

# Notes
