---
name: "fix: log loads collapsed lines, one block per line"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: ""
issuer: "user"
complexity: "moderate"
shortName: "collapsed-lines-log-load"
---

# Summary
#148 fixed the streamed blocks, but not the blocks that appear when scrolling up: thinking blocks get broken when a back-filled chunk starts mid-block. Instead of loading a fixed byte chunk, the log loads a fixed number of collapsed lines - one thinking block or tool call block counts as a single line - both on first show and when scrolling up. This solves the scrolling-up problem.

# Specs
Current mechanics: the log pane loads the last LOG_CHUNK = 81920 bytes at init for logs over ~80KB, and a scroll-up back-fill prepends the previous byte chunk; chunk boundaries can fall inside a thinking block or tool block, so the walk-back (which only goes backward) promotes broken artifacts and thinking blocks render split.

Changes (src/webui.ts + src/webui.test.ts only):
- Block-aware line grouping in the payload: the server groups the JSONL records into logical lines where a thinking block (thinking_start..thinking_end) counts as ONE line and a tool call block (tool_execution_start..tool_execution_end) counts as ONE line; every other record is one line.
- First show and scroll-up back-fill load a fixed number of collapsed lines (LOG_LINES = 100) instead of the 81920-byte chunk: init serves the last 100 lines, a scroll-up back-fills the previous 100 lines. A chunk boundary then always falls BETWEEN blocks, never inside one, so no block is ever broken on load or back-fill.
- The live delta streaming path stays as #148 shipped (deltas join the open block, cross-window close); only the init and back-fill slicing changes.
- Keep the walk-back of a partial leading record where it still applies, the atStart handling, offsets/dedupe, the #122/#140/#141/#146/#147/#152 rendering rules and the atStart stop unchanged.
- A thinking block or tool block longer than the whole window still renders as its single collapsed line (never dropped).

Tests: the webui suite covers the line grouping (a log with a thinking block spanning many records loads it as one unbroken block; scroll-up back-fill never splits a block; the 100-line cap with block counting; the live path unchanged); the suite stays green.
