---
name: "fix: agent logs carry only the final output - stream the full JSONL event log"
priority: "high"
state: "done"
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
- [2026-10-11 07:35] Merge conflict for branch fix/agent-logs-carry-only-the-final-output-stream-the-full-jsonl-event-log, merger spawned (attempt 1).

- Implemented in 4 commits on fix/agent-logs-carry-only-the-final-output-stream-the-full-jsonl-event-log (1687aec spawn --mode json, d8741db webui JSONL parser, 0ef6476 tests, 539c08b README).
- src/orchestrator.ts spawnAgent: spawn args are now [agent, "--approve", "--mode", "json", "-p", prompt]; detached spawn, direct fd write and pid tracking unchanged, stderr still appends to the same log.
- src/webui.ts: added exported renderLogChunk(chunk), applied in the /api/agent-log handler. Renders thinking_start as a "── thinking ──" separator, buffers thinking_delta/text_delta into pending text, renders toolcall_end and tool_execution_start as one "[tool] name: arg-summary" line per call (deduped by toolCall id within the chunk), failed tool_execution_end as "[tool] name failed: <err>", and user message_end as "[prompt] <text>". Byte-based chunking kept; a partial trailing record (no newline) is dropped; lines that fail JSON.parse pass through unchanged.
- Arg summary keys: command, path, file_path, pattern, url, query, else the first string value; capped at 160 chars.
- Tests: orchestrator.test.ts asserts the spawned developer log carries message_update, tool_execution_start and message_end records; webui.test.ts covers renderLogChunk (thinking/tool/text/prompt rendering, dedupe, passthrough, partial-drop) and the /api/agent-log endpoint. All suite tests pass (node --test), including kanban.test.ts.
- Verified parser event names against pi docs (docs/json.md, docs/message-types.md): message_update/assistantMessageEvent, toolcall_end carrying the complete ToolCall (id, name, arguments), tool_execution_start (toolCallId, toolName, args).
- Schedule blockers 000051 and 000036 are done and merged; branch merges into main cleanly (git merge-tree reports 0 conflicts).
- Resumed a run that had already landed the four commits (1687aec spawn, d8741db parser, 0ef6476 tests, 539c08b docs) and verified each spec point against the code: spawnAgent carries "--mode json" with the detached direct-fd write and pid tracking unchanged; renderLogChunk dedupes tool lines by call id, drops the partial record at a byte boundary and passes non-JSON lines through; chunking stays byte-based. No new changes were needed.
- Re-ran the suites in the worktree: orchestrator.test.ts, webui.test.ts and kanban.test.ts all pass.
- Review pass 2: two gaps found and fixed (commit 4b8b333). (1) The partial-record drop only handled the trailing byte edge; every init/history fetch of a log bigger than LOG_CHUNK (16384) starts at size-16384, which lands mid-record, and the partial head line failed JSON.parse and rendered as raw JSON at the top of the pane. The /api/agent-log handler now checks the byte before head and drops the partial head line when it is not a newline, matching the trailing-edge drop in renderLogChunk. (2) The orchestrator test stub emitted JSONL unconditionally, so the developer-log assertion passed even without the orchestrator's --mode json flag; the stub now emits JSONL only when spawned with --mode json and print-mode final text otherwise, making the assertion a real regression guard.
- Review pass 2: added a webui endpoint test for the chunk-head split (exact equality on the rendered text), verified sensitive both ways (passes with the fix, fails with the leading drop disabled). Full suite re-run: all pass.
- Review pass 2, accepted as-is: per-chunk tool dedupe can duplicate a tool line when a poll boundary falls between toolcall_end and tool_execution_start - the spec scopes the dedupe to within the chunk and cross-request dedupe would need server state; cosmetic only.
- Review pass 3: verified the spawn args and renderer event names against pi docs (docs/cli.md: --mode json writes JSONL events to stdout and exits; docs/json.md: message_update/assistantMessageEvent with text_delta/thinking_start/toolcall_end carrying the complete ToolCall, tool_execution_start with toolCallId/toolName/args, tool_execution_end with isError). Confirmed all three test stubs parse the prompt via indexOf("-p") with no leftover argv[4], and confirmed the frontend poll uses the server-returned byte offsets (d.head/d.tail) so the shorter rendered text causes no offset drift. renderLogChunk correctly handles empty input, non-object JSON (null), and drops the partial trailing record only when the chunk does not end on a newline. Full suite re-run in the worktree: orchestrator.test.ts and webui.test.ts both pass. No fixes needed.
- Live test (sandbox board /tmp/lt-000054-root, daemon run from this worktree, real pi agents): three tasks ran the full pipeline to-do -> done with merge. Spawn flow confirmed: agent logs carry the full JSONL event stream (592 KB developer log with session/agent_start/turn_start/message_start/message_update/message_end/tool_execution_*/agent_settled records, not print mode's final text only). Detached agents survived a daemon stop/start mid-run.
- Live watch of /api/agent-log (1 s polls, frontend offset semantics): the pane streamed readable events - text, "── thinking ──", "[tool] bash/read/edit/kanban_get" with arg summaries, "[tool] edit failed: <err>" for a failed edit. Offsets chained correctly, no drift.
- Chunk-head partial drop verified live: every fetch of logs > 16384 bytes lands mid-record at head and no raw JSON rendered in any of ~50 fetches. Legacy print-mode log passthrough verified with a real pre-change log. 404s correct for path traversal, unknown task, wrong role, missing param. Suite (orchestrator, webui, kanban) passes in the worktree.
- Issue 1 (UX, medium): the tail chunk of a finished agent log renders empty (textLen 0). Terminal records (assistant message_end, turn_end, agent_end, agent_settled, usage-only message_update) are 68-83 KB each, dominate the last 16 KB and none render; the assistant message_end (the final output, array content) is skipped - only the user-role message_end renders as [prompt]. Observed on all four completed sandbox logs; ~38% of history chunks empty (12/32) paging back a 514 KB log. Live watching is unaffected (the pane keeps prior content); the empty pane shows when opening the log of a dead in-flight agent.
- Issue 2 (cosmetic): renderLogChunk skips empty lines before the JSON.parse passthrough, so a legacy final text loses its blank paragraph lines (2 of 7 lines in the fixture).
- Side finding, not this change (belongs to the merged reconcile feature): a daemon restart mid-pipeline reverted the in-flight task state and notes to the mirror tip - mirror commits only happen at create/done and reconcileBoard on start materializes the tip over the working tree; the reviewer's to-live-test state and notes were wiped and the task re-ran from to-do (self-healed). Sandbox daemon stopped after the test; board left at /tmp/lt-000054-root.

- [2026-10-11 09:37] Orchestrator merge failed, merger resolved in the main checkout (commit 2da84da). The only conflict was the webui.test.ts import block: main (HEAD) imports flipDiff, the branch imports renderLogChunk. Resolution keeps both: import { flipDiff, loadWebUiConfig, renderLogChunk, startWebUi } from "./webui.ts". No spec conflict - the two sides add separate tests in the same file (main's flipDiff tests, branch's renderLogChunk and /api/agent-log tests), so no test content needed choosing. Verified both symbols are used by the tests and exported by the merged webui.ts, then re-ran all suites on the merge result: orchestrator.test.ts, webui.test.ts and kanban.test.ts all pass.
