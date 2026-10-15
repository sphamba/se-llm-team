---
name: "feat: dual-format log renderers for claude stream-json"
priority: "high"
state: "doing"
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
