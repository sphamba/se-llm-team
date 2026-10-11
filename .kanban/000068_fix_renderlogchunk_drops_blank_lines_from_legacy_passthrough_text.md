---
name: "fix: renderLogChunk drops blank lines from legacy passthrough text"
priority: "low"
state: "reviewing"
worktree: "fix/68-renderlogchunk-drops-blank"
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
- [2026-10-11 11:19] Implemented on fix/68-renderlogchunk-drops-blank (commit 4d716a2).
- src/webui.ts renderLogChunk: removed the `if (!line) continue;` skip and made the trailing split-element pop unconditional (`lines.pop()`), because that element is either the empty sentinel of a newline-terminated chunk or a byte-split partial record, never content. Blank lines now fall through to the JSON.parse passthrough branch and render unchanged; empty input, chunk-head partial drops and the no-stray-blank-at-chunk-edge behavior are unchanged.
- src/webui.test.ts: added a legacy print-mode text round-trip assert (3 paragraphs, 2 blank lines, exact equality) and a mixed JSONL + blank line assert (a blank line must flush buffered text_delta output). Both fail against the unfixed renderer with exactly the 2 blank lines lost, and pass with the fix. Existing exact-equality chunk-head test still passes, so no stray edge blank lines.
- Checks: node src/kanban.test.ts, node src/webui.test.ts (3 runs), node src/orchestrator.test.ts all pass in the worktree.
