---
name: "fix: stale version comment in src/mcp.ts"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#219"
complexity: "trivial"
shortName: "stale-mcp-version-comment"
---

# Summary
src/mcp.ts line 16 carries a comment that no longer matches reality: it says "the repo's package.json carries no version field, 0.0.0 is the fallback". Task #219 added the first version field to package.json (version 0.1.0) and made plugin.json mirror it, and the MCP server now correctly reports serverInfo.version "0.1.0" over JSON-RPC (verified in the #219 live test). Only the comment on the serverInfo.version line is wrong; the code path (read package.json version, fall back to 0.0.0) is correct and unchanged. Fix the comment to match reality, e.g. "the package.json version, 0.0.0 is the fallback when absent".

# Specs
## Need

The comment on the `serverInfo.version` line in src/mcp.ts is stale: it claims package.json carries no version field, but #219 added `"version": "0.1.0"` to package.json, so the MCP server reports that version rather than the 0.0.0 fallback.

## Change

- src/mcp.ts, line 16: rewrite the comment so it describes the current behavior, for example "the package.json version, 0.0.0 is the fallback when absent".
- Comment-only change: the `serverInfo.version` expression itself must not change.

## Acceptance

- The comment in src/mcp.ts reads as light of a package.json that has a version field (no longer claims the field is absent).
- The MCP server still reports the package.json version: serverInfo.version is "0.1.0" for this repo, and falls back to "0.0.0" only when the field is absent.
- Developer gate passes: `node tests/mcp.test.ts`

# Notes
