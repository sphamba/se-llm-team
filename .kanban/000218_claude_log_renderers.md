---
name: "feat: dual-format log renderers for claude stream-json"
priority: "high"
state: "reviewing"
worktree: "feat/218-claude-log-renderers"
issuer: "user"
complexity: "complex"
shortName: "claude-log-renderers"
blockedBy: ""
---

# Summary
The log compactor, the webui log pane, the token/duration stats and the efficiency-analysis parser learn the claude stream-json record shapes alongside the existing pi JSONL shapes. Logs stay in the native format of the agent that wrote them.

# Specs
# Goal
Agent logs written by claude backend agents (stream-json) render in the webui log pane, produce token and duration stats, are compacted at write time, and are parseable by efficiency-analysis. Pi JSONL logs keep working unchanged.

# Decisions (user interview)
- Dual-format renderers: every renderer learns the claude stream-json record shapes alongside the pi shapes. Logs stay in the native format of the agent that wrote them. No write-time normalization.

# Changes
1. Verify the exact claude stream-json record shapes against the current claude CLI documentation (web search). Expected shapes: system (init), stream_event (message deltas: text_delta, thinking_delta, tool-input deltas), assistant and user messages, and the final result message (usage, duration, cost). Record the verified shapes in # Notes.
2. Write-time compactor (src/orchestrator/log.ts): recognize claude records and drop the dead weight by the same policy as pi records: keep rendered content, drop duplicated envelopes. List the kept and dropped record types in # Notes.
3. Webui (src/webui/payload.ts, src/webui/logpane.ts): render claude text, thinking, and tool blocks with the existing collapsed-block UI. Extract tokens and duration from the usage-bearing claude records for the agent cards and the summary cards. Live streaming, scroll-up back-fill, and the model meta line work for claude logs as they do for pi logs.
4. src/efficiency-analysis.ts: parse claude stream-json output for the analyser (final text and tool calls). This closes the limitation noted in task #216.
5. Format detection is per file or per line, never per config: a board can switch backends between runs, so the renderers must not assume the configured backend.

# Constraints
- Pi JSONL rendering, compaction, and stats stay equivalent. The existing tests guard them.
- No new dependency.

# Acceptance criteria
- node tests/webui.test.ts passes. New fixture cases: a claude stream-json log renders text, thinking, and tool blocks; token and duration stats come from the usage-bearing records; the live path handles stream_event deltas.
- node tests/orchestrator.test.ts passes, with compactor cases extended to claude record fixtures.
- node tests/efficiency-analysis.test.ts passes, with claude output parsing cases.
- node tests/kanban.test.ts passes unchanged.

# Notes
## Verified claude stream-json record shapes (claude CLI docs, headless + agent-sdk streaming-output + sdk.d.ts)
- system init: `{type:"system",subtype:"init",session_id,cwd,model,tools:[...],permissionMode,...}` (camelCase permissionMode).
- assistant: `{type:"assistant",message:{id,role:"assistant",model,content:[{type:"text",text}|{type:"thinking",thinking}|{type:"tool_use",id,name,input}],usage:{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}},parent_tool_use_id,timestamp?}`. One API turn emits one assistant record per completed content block, so several records share message.id and the intermediate usage is not final. Newer emitters carry an optional top-level ISO timestamp.
- user: `{type:"user",message:{role:"user",content: string | [{type:"tool_result",tool_use_id,content,is_error}]},parent_tool_use_id}`. Prompt echoes are plain strings; is_error is snake_case and optional.
- stream_event (only with --include-partial-messages, which our spawn does not pass): `{type:"stream_event",event:{type:content_block_start|content_block_delta|content_block_stop,index,delta}}`, deltas text_delta{text}, thinking_delta{thinking}, input_json_delta{partial_json}.
- result: `{type:"result",subtype:"success"|error_max_turns|error_during_execution|...,duration_ms,duration_api_ms,is_error,num_turns,result,total_cost_usd,usage,modelUsage}`. The result usage covers the main agent loop only (no Task subagents); modelUsage covers everything.
- parent_tool_use_id non-null marks subagent (Task tool) activity. Without --include-partial-messages the CLI emits no stream_event records.

## Compactor policy (compactLogLine)
- Kept verbatim: system, assistant, user, result, and any unknown type (byte-for-byte, same as unknown pi records).
- Dropped: stream_event (the authoritative assistant/user records carry the content).
- Non-JSON lines (stderr diagnostics) pass through unchanged. Orchestrator.log, counters and armed markers never match the role-log pattern, so the pass never touches them.

## Implementation
- Webui: claude assistant content blocks render through the existing UI (text pending, thinking and tool_use collapsed); user records render prompt lines and tool_result joins the block by id; stream_event renders nothing. Tokens sum the assistant records' usage (input_tokens + output_tokens, cache excluded, deduped by message.id, last record per id wins); a finished run's duration prefers the result record's wall-clock duration_ms; the meta line's model comes off the latest usage-bearing record. linesBack counts a stream_event block (start..stop, deltas between) as one collapsed line by index pairing, open blocks included.
- efficiency-analysis: claude assistant records are authoritative blocks (thinking/text/tool_use) like pi message_end; user tool_result records fill the result map; parented records skip as subagent activity; the analyser answer reads the result record's result field (error runs give none) with the last assistant text as fallback.
- Commits in the worktree: 4ebcf3d (feat: src), 884ac1a (test: fixtures). Full npm test passes.

# Open questions
- Assumption: the claude spawn stays without --include-partial-messages, so live claude logs carry no stream_event records and the stream_event handling is defensive for logs that have them.
- Assumption: token stats sum the per-API-call usage on assistant records, so subagent usage present in the log counts, and the result record's main-loop-only usage is not double-counted.
- Assumption: a finished claude run's duration is the result record's wall-clock duration_ms; a live claude run reads null duration until it finishes or its records carry timestamps.
- Assumption: claude Task-tool subagents produce no sub-list entries in the log pane; the sub-list parser keys on pi's own /tmp .output transcripts and stays pi-only.
