---
name: "fix: renderLogChunk drops blank lines from legacy passthrough text"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
renderLogChunk skips empty lines (if (!line) continue) before the JSON.parse passthrough check, so a legacy print-mode final text loses its blank paragraph lines (2 of 7 lines in a real pre-change log fixture). The spec says lines that fail JSON.parse pass through unchanged; an empty line fails JSON.parse, so blank lines must pass through too.

# Specs
Found in live test of 000054 (worktree fix/agent-logs-carry-only-the-final-output-stream-the-full-jsonl-event-log).

Evidence:
- src/webui.ts renderLogChunk (on the 000054 branch, defined at line 114) skips empty lines at line 127 (`if (!line) continue;`) before the JSON.parse passthrough check (lines 128-133, where a non-JSON line is pushed unchanged).
- A legacy print-mode final text loses its blank paragraph lines: 2 of 7 lines dropped in a real pre-change log fixture.
- The 000054 spec says lines that fail JSON.parse pass through unchanged; an empty line fails JSON.parse.

Fix: move/remove the empty-line skip so blank lines fall through to the passthrough branch unchanged. Mind the trailing-partial-line pop at lines 123-124 (a trailing "" from split means the last record was complete, not content) so the fix does not introduce stray blank lines at chunk edges.

# Notes
