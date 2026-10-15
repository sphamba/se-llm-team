---
name: "feat: dual-format log renderers for claude stream-json"
priority: "high"
state: "done"
worktree: ""
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

## Review (reviewer pass)
- All six suites of this branch's lineage pass (webui, orchestrator, efficiency-analysis, kanban, index, extension; exit 0 each). No mcp suite exists here: the branch predates the MCP commits on main, so the merged tree has seven.
- Shapes re-verified against current claude docs (code.claude.com headless page + Agent SDK TypeScript reference): init permissionMode, assistant message.usage snake_case tokens, one assistant record per completed content block sharing message.id (each with its own optional ISO timestamp), user string-vs-tool_result content, stream_event only with --include-partial-messages (its parent_tool_use_id is always null: subagent deltas are never forwarded), result usage main-loop-only vs modelUsage everything. All confirmed. Newer fields and extra record types (system/compact_boundary, system/api_retry, permission_denied, tool_progress, ...) keep verbatim in the compactor and render nothing, so the unknown-type policies already cover them; new result subtypes (error_max_budget_usd, error_max_structured_output_retries) land in the same paths.
- Assumptions verified against the code: the claude spawn argv (src/orchestrator/backends.ts) carries --output-format stream-json --verbose and no --include-partial-messages, so live claude logs carry no stream_event records and that handling is defensive (upgrade path: prefer the deltas when the spawn adds the flag); the sub-list parser admits only pi SUB_ROOT .output transcripts, so claude Task subagents produce no sub-list entries; a live claude run reads null duration until it finishes or its records carry timestamps (the agent-history sort falls back to mtime on a null first).
- Recorded ceiling: an orphan claude tool_result's failed span summary shows "? failed: ..." because claude tool_result blocks carry no tool name (pi's tool_execution_end carries toolName); the client-side join shows the real name whenever the tool block is in the DOM. A cross-chunk name needs per-slug render state, the existing logpane ceiling.

## Live test (2026-10-15, hub-only page plus real hub HTTP API, real --compact-logs CLI, real analyser spawn)
- Scope: claude stream-json rendering, stats, compaction and efficiency-analysis only. The claude CLI is absent on this machine, so the efficiency analyser ran with a fake `claude` binary first on PATH. That fake emits the documented stream-json shapes on stdout, so the spawn path (argv, cwd, stdout read, answer parse) was real.
- Browser (Playwright, page served from the merged worktree): a finished claude log renders the prompt line, a collapsed Thinking block, text paragraphs, a collapsed Read tool block with its args, the joined tool_result and no stream_event delta text (`DELTAONLY-MARKER` is absent). Expanding both blocks shows their bodies. The meta line reads `claude-sonnet-4-5`. The card stats read `700 · 12s`. A live claude log renders its prompt and text, the 1 s poll shows an appended assistant record, and the page has no console or page errors.
- Stats (GET /api/tasks): claude tokens dedupe by message.id (700, not 850), cache fields stay excluded, the duration comes from the result record (12345, not a timestamp span), and the model comes from the latest usage-bearing record. A timestamp-less live claude run reads 133 tokens and a null duration. Appending its result record flips the duration to 54321.
- Per-file detection: one board carries a pi developer log and a claude reviewer log, and both runs serve correctly (100 tokens/20000 ms pi, 18/2000 claude). Two backends on one board work with no config.
- Back-fill: the init window of a claude log that holds a 150-delta stream_event block starts exactly at the block's content_block_start (head 13540), the deltas render nothing, and the client's own `before=1` request then serves the previous 100 collapsed lines from a record boundary. No block is split.
- Compaction (real `node src/orchestrator.ts --root <fixture> --compact-logs`): stream_event records drop, system/assistant/user/result and an unknown system subtype stay byte-for-byte, and a non-JSON stderr line survives. The pi control log keeps its current policy (the system echoes and the toolResult message_start drop, `message_update` loses its usage envelope, `agent_end` loses `messages`). `renderLogChunk` output is byte-identical before and after compaction for the claude log and for the pi control. After the sweep the hub serves the .gz claude log with the same text, model and stats.
- Efficiency analysis (real `analyseLog` with backend claude): the fake claude stdout covers a result record, an assistant fallback and an error result. The pipeline parses the claude assistant thinking, text and tool_use blocks, joins the tool_result into the tool block, skips the parented subagent record, sends the thinking, the args and the result in the pass 1 prompt, spawns the analyser with `--bare --no-session-persistence --output-format stream-json --verbose`, takes the final analysis from the result record (the assistant record does not win), writes the report, and returns null for an error result with the assistant text as fallback.
- Assumptions: the fixtures follow the verified shapes in # Notes. The live claude fixture carries no top-level timestamps to cover the timestamp-less emitter case, and the stream_event records cover the defensive path because the real claude spawn does not pass --include-partial-messages.
- Observation: a live claude run with usage and no timestamps shows `133 · 0s` on the summary card. The `0s` is the summed null duration. This matches the recorded ceiling (a null duration until the run finishes or its records carry timestamps), but the card does not hide the duration while live. No other behavior contradicted the task assumptions.
- Result: no defects found, so no new task for the Project manager.

# Open questions
- Token semantics across backends: pi agent-card tokens are main-loop only (subagent usage lives in separate .output transcripts), while the claude renderer sums every assistant record in the parent log, so Task-subagent usage counts (the result record's main-loop-only usage is excluded to avoid double-counting). Keep claude tokens as "everything the log shows", or align to pi's main-loop-only reading?
