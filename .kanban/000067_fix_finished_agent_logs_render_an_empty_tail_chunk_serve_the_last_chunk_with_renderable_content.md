---
name: "fix: finished agent logs render an empty tail chunk - serve the last chunk with renderable content"
priority: "medium"
state: "doing"
worktree: "fix/finished-agent-logs-render-an-empty-tail-chunk-serve-the-last-chunk-with-renderable-content"
---

# Summary
The last 16 KB chunk of a completed agent log renders textLen=0 through GET /api/agent-log: terminal JSONL records (assistant message_end, turn_end, agent_end, agent_settled, usage-only message_update) dominate the tail, none of them render, and the assistant message_end (the final output, array content) is skipped. Render the assistant message_end text per the spec and/or serve the last chunk that has renderable content.

# Specs
Found in live test of 000054 (worktree fix/agent-logs-carry-only-the-final-output-stream-the-full-jsonl-event-log, sandbox board /tmp/lt-000054-root with real pi agents).

Evidence:
- The last 16 KB chunk of a completed agent log renders textLen=0 through GET /api/agent-log on all four completed sandbox logs; ~38% of history chunks empty (12/32) when paging back a 514 KB log.
- The terminal records (assistant message_end, turn_end, agent_end, agent_settled, usage-only message_update) are 68-83 KB each, dominate the tail chunk, and none of them render.
- The assistant message_end (the final output, array content) is skipped by renderLogChunk (src/webui.ts, 000054 branch, message_end branch ~line 168): only the user-role message_end renders, as [prompt].
- Live watching is unaffected (the pane keeps prior content), but opening the log of a dead in-flight agent shows an empty pane.

Code: /api/agent-log handler serves readRange(log, head, tail) = the last 16 KB chunk (tail = size, head = max(0, size - LOG_CHUNK)) and renders it via renderLogChunk (src/webui.ts on the 000054 branch; handler ~lines 237-254, renderLogChunk defined at line 114).

Possible fix (per the 000054 spec): render the assistant message_end text ("message_end as the final text") and/or serve the last chunk that has renderable content instead of a chunk that renders to nothing. Keep live watching behavior intact.

# Notes
