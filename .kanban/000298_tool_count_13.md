---
name: "fix: stale 12-tool counts in README and index.ts comment"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#297"
complexity: "trivial"
shortName: "tool-count-13"
---

# Summary
The PM tool set is 13 since #297 documented efficiency_analysis, but README.md:72 still says "the same 12 kanban and orchestrator tools" and the index.ts:140 comment says "the 12 tools are deferred". Found and measured by #297's live test.

# Specs
# Change

- README.md MCP section: "12" to "13" (or drop the hard count if a countless phrasing is shorter).
- index.ts:140 comment: same correction.

# Acceptance

- No file says 12 for the PM tool set; grep for "12 tools"/"12 kanban" over README.md and src/ is empty.
- Scoped check green (tests/plugin.test.ts).

# Notes
