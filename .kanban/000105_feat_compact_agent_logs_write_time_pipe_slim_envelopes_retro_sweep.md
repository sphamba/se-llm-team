---
name: "feat: compact agent logs; write-time pipe, slim envelopes, retro sweep"
priority: "medium"
state: "reviewing"
worktree: "feat/105-compact-agent-logs"
---

# Summary
Agent JSONL logs are very heavy (661 MB across 157 logs): the system prompt is echoed twice per run (~135 KB each), agent_end re-duplicates all messages, and tool results are echoed twice. Pipe pi stdout through a write-time compactor in spawnAgent that drops the agreed dead weight, slims the message_update envelope, and rewrite finished logs once through the same compactor.

# Specs
User decisions (settled 2026-10-11 via structured dialog): write-time pipe; MODERATE drop list; also slim the message_update envelope; retro-compact finished logs once.

Facts (verified 2026-10-11 by two explorers):
- spawnAgent (src/orchestrator.ts:200-219) opens the log with openSync(..., "a") and spawns `pi --approve --mode json [flags] -p <prompt>` with stdio ["ignore", out, out] - stderr interleaves non-JSON lines into the JSONL log. No pipe exists today. Log naming `<slug>.<role>.<n>.log` via nextRunIndex (:185-198) must survive.
- Byte share of a 6k-line sample of the largest log (57 MB): message_update 66.7% (the deltas themselves are small; envelope/usage dominates), message_end 9.3% (assistant echo + the run-opening system prompt echoed twice, ~135 KB per run), tool_execution_end 6.3% (full result.content, 15.5% of sample bytes alone), turn_end 6.1% (full turn replay), message_start:toolResult 3.9% (tool result echoed a second time), tool_execution_update 3.3%.
- The webui (renderLogChunk, src/webui.ts:129-191) renders ONLY: message_update deltas (thinking/text/toolcall), tool_execution_start, tool_execution_end when isError:true (capped 200), message_end for the user prompt (capped 160). pi's full session store (~/.pi/agent/sessions/) keeps full fidelity regardless.

Changes:
1. Write-time compactor: swap the fd redirect for a pipe - spawn stdio stdout/stderr flows through a Transform (new small module or same file) into the append-only log file, drained by the daemon; keep detached/unref semantics. One JSONL record per line, no re-ordering, no merging; non-JSON stderr lines pass through unchanged.
2. MODERATE drop list (exactly this):
   a. Drop the run-opening system prompt echoes: message_start + message_end records whose message role is "system" (carries the ~135 KB sections payload).
   b. Drop agent_end's messages array (keep the rest of the record, e.g. willRetry/stop info).
   c. Drop message_start records whose message role is "toolResult" (the full tool result echoed a second time).
   - KEEP verbatim: turn_end, message_end for non-system roles, tool_execution_start/update/end with full result content, session, agent_start, turn_start/end turn_start, thinking_level_changed, compaction/retry/queue events.
3. Slim message_update: strip the usage field (and any other per-record metadata envelope) from each message_update record; keep the inner assistantMessageEvent (thinking_delta/text_delta/toolcall deltas with args) verbatim. All streamed thinking and tool calls survive.
4. Subagent-log compatibility: tool_execution_end results are kept in full under the moderate list, so #88's subagentLogs "Agent ID:"/"Output file:" matching keeps working; never truncate results in this task.
5. Retro sweep (one-time, part of this task): after the compactor lands, rewrite finished logs through the same compactor - iterate .kanban/.logs/*.log matching the role-log name pattern, skip files whose slug's pidfile exists (.kanban/.pids/<slug>.pid, including <slug>.merger.pid) and skip orchestrator.log/counters/armed files; compact in place via temp file + rename. Report the before/after total bytes in # Notes. Not wired into normal daemon operation.
6. Tests (src/orchestrator.test.ts): feed a fixture JSONL through the compactor asserting each drop/keep/slim rule, line-per-record preservation, and stderr passthrough; the full-pipeline smoke still finds message_update/tool_execution_start/message_end (the user prompt's message_end qualifies). Retro sweep: a finished log (no pidfile) is rewritten slim; a running one (pidfile present) is untouched.

Acceptance:
- A representative before/after byte measurement on a real log (e.g. the 57 MB one) recorded in # Notes; expect a large reduction.
- The webui streaming is unchanged: renderLogChunk's inputs (message_update deltas, tool_execution_start, error results, user-prompt message_end) all survive; all three suites green.

Constraints:
- Files: src/orchestrator.ts, src/orchestrator.test.ts only; no src/webui.ts changes (the read-path contract - one JSONL record per line, chunked/walk-back/poll-window machinery, LOG_CHUNK - is preserved untouched).
- HOLD: behind #101 (double-spawn guard, same file src/orchestrator.ts + its test).

# Notes

2026-10-11 (developer):
- Implemented in src/orchestrator.ts only (no new module): compactLogLine (one JSONL line -> compacted line or null), logCompactor (line-buffered Transform reassembling lines at byte level so chunk splits cannot corrupt multibyte characters), and compactFinishedLogs (retro rewrite in place via .compact-tmp sibling + rename). spawnAgent now pipes pi stdout AND stderr through the compactor into the append-only log (stdio ["ignore","pipe","pipe"], end:false on both sources, compactor ended on child close; error handlers swallow stream errors so a dead sink loses lines, never the daemon; compactor.end() also on spawn error because ENOENT never fires close).
- Retro sweep exposed via --compact-logs (usage string updated); run once against production: node src/orchestrator.ts --root <repo> --compact-logs. Not wired into daemon operation.
- Retro sweep result: 131 agent log(s) rewritten, 928,437,025 -> 509,467,437 bytes (45% smaller). The 57.5 MB target log: 57,556,233 -> 52,059,872 bytes (its bulk is kept content: thinking/text deltas and full tool results). .logs total 1,068,601,222 -> 653,756,315 bytes; logs with an existing pidfile (in-flight tasks, merger logs while merger.pid exists) were skipped per the conservative skip rule.
- Post-sweep verification on the compacted 57 MB log: "sections" gone, message_update carries bare assistantMessageEvent (usage stripped), tool_execution_end full results intact (subagent-log matching safe), one JSONL record per line preserved. Remaining "usage" strings live inside kept records (assistant message_start/message_end), which the spec keeps verbatim.
- Tests added to src/orchestrator.test.ts: part-A pipeline stub now emits a system message_start/end with sections, a message_update with usage, a toolResult pair, an agent_end with a messages array and a stderr line; new part AB feeds a fixture JSONL through the compactor (asserts every drop/keep/slim rule, chunk boundary mid-line and 1 byte into a multibyte e-acute, trailing newline, stderr passthrough); new part AC asserts the retro sweep rewrites only a finished log, leaves running/merger logs byte-identical, skips orchestrator.log/armed/counter files, and is idempotent on a second pass.
- All three suites green: kanban.test.ts, webui.test.ts, orchestrator.test.ts (20 parts). Two early suite runs hit a transient "orchestrator lock was missing, re-acquired" stall in spawn-loop-heavy parts; not reproducible after the test-fixture fix (5 subsequent runs green) and the lock file is only removed by releaseLock (own pid), so it reads as pre-existing suite flakiness under load, not a compactor regression.
