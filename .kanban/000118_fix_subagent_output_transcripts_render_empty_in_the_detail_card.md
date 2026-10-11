---
name: "fix: subagent output transcripts render empty in the detail card"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: "#52"
---

# Summary
#88's known follow-up: real pi subagent .output transcripts are sidechain records (isSidechain true, types user/assistant/toolResult) that renderLogChunk drops, so the subagent log pane renders empty. Extend the log renderer to render sidechain records while keeping the chunk walk-back, tool dedupe and non-sidechain rendering intact.

# Specs
Per #88's known follow-up: the detail card serves a real subagent transcript through the unchanged renderLogChunk, which renders only message_update deltas, tool_execution_start, error-only tool_execution_end and user-prompt message_end — so the subagent pane renders empty. Real subagent .output files are full JSONL transcripts of sidechain records, verified shapes: {"isSidechain":true,"agentId":"<id>","type":"user","message":{"role":"user","content":"<text>"}}; type "assistant" with message {role:"assistant", content:[blocks], usage, model, provider, ...} where blocks carry type text/thinking/toolcall; type "toolResult" with message {role:"toolResult", toolCallId, toolName, content:[{type:"text","text":...}], isError, durationMs}. Fix in src/webui.ts: extend the log renderer (renderLogChunk and its record dispatch) to render sidechain records: a sidechain user record renders the prompt text (capped like the user-prompt message_end); a sidechain assistant record renders its text blocks as message text (thinking blocks may be skipped or shown in the existing thinking style; toolcall blocks render as tool starts keyed by toolCallId); a sidechain toolResult record renders toolName plus its text content (capped like the error tool_execution_end). Keep every existing rule intact: chunk boundary walk-back must still work (an early chunk of a subagent log must render something so the head walk-back serves from the start), chunk-local tool dedupe by toolCallId must cover sidechain toolResults so a record split across poll windows is not duplicated, and non-sidechain rendering is byte-identical. Extend src/webui.test.ts: a fixture sidechain transcript (user + assistant text + toolResult) renders non-empty through the renderer, and existing assertions stay green. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes.

# Notes
