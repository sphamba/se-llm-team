---
name: "feat: webui agent history per run; subagent logs in the detail card"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The webui task detail shows max 3 role-granular agents and cannot open per-run or merger logs, and subagent logs are invisible. Show every agent run chronologically in one row (building on #76), resolve each run's subagent logs from the parent log, and stack subagents vertically.

# Specs
Facts (main, verified): agentHistory src/webui.ts:86-91 lists PIPELINE_ROLES roles whose `<slug>.<role>.log` exists - role-granular, max 3; agentLogPath :95-99 allowlist regex `^(.+)\.(developer|reviewer|live-tester)$` rejects `.merger` and run-suffixed names; taskPayload :212-224 serves agents/agent at :221-222; agentLogPayload :227-266 does LOG_CHUNK chunking with offset poll and unrenderable-tail walk-back; renderAgent :522-539 groups past-then-live buttons, openLog :547 builds `${file}.${role}`; renderLogChunk renders pi JSONL with passthrough fallback. Naming contract from task #87: new runs write `<slug>.<role>.<n>.log`, legacy `<slug>.<role>.log` stays.

Changes:
1. agentHistory returns per-run entries: for each role in PIPELINE_ROLES order then merger, one entry per `.logs/<slug>.<role>.<n>.log` ordered by index ascending; when a legacy `<slug>.<role>.log` exists it is an extra entry ordered before that role's indexed runs. Entry shape {role, run (number|null for legacy), alive, handle} where handle is `${slug}.${role}` or `${slug}.${role}.${n}`; alive on the entry whose role matches AGENT_ROLE(state) with a live pid (highest index of that role, or the legacy entry).
2. /api/agent-log (agentLogPath) allowlist accepts plain role handles, run-suffixed handles, and merger, still gated on taskFiles; content serving reuses the same chunked payload unchanged. Covers the allowlist-regex slice of #79 (supersedes it there; #79 keeps states/WORKING/accent/STATE_NAMES).
3. Subagent logs via optional `sub` param on /api/agent-log: `sub=list` returns [{id, index}] parsed from that handle's own parent log - tool_execution_end records whose result text matches "Agent ID: <uuid>" and "Output file: <path>"; `sub=<n>` serves the n-th output file through the same chunked payload. Path validation at this trust boundary: the resolved path must start with /tmp/pi-subagents-1000/ and end with .output; the client never passes paths. No matching records means an empty list, never an error. (Ceiling: /tmp/pi-subagents-1000 and the result-text wording are emergent undocumented pi behavior; revisit if pi documents a structured event.)
4. Rendering (renderAgent, building on #76's row): all runs render as buttons in one horizontal chronological row (role pipeline order, run index ascending, legacy first within role, live agent rightmost with its spinner); when the selected agent has subagents they render as buttons stacked vertically below the row, chronological; clicking a subagent button opens that log in the existing pane via the sub params. Button labels: role name, with the run index appended when that role has multiple runs.
5. Subagent .output files are JSONL sidechain transcripts ({isSidechain:true,...}); they render through the existing renderLogChunk passthrough - no special casing.

Tests (src/webui.test.ts): per-run entries (indexed files yield multiple entries), legacy entry ordered first, entry order, allowlist accepts run-suffixed and merger handles and rejects junk, sub=list and sub=n payloads (create a fixture parent log + /tmp/pi-subagents-1000 fixture), agents payload deepEqual update (:127-128); STATE_NAMES untouched.

Acceptance: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

HOLD: behind #87 (naming contract), behind #76 (doing on fix/76, dirtying src/webui.ts + test, provides the chronological row), behind #47 (reviewing, committed webui changes pending merge); coordinates with #84 (same agentLogPayload region).

# Notes
