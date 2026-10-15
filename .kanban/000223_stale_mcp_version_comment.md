---
name: "fix: stale version comment in src/mcp.ts"
priority: "low"
state: "done"
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
- Rewrote the src/mcp.ts line 16 comment to "the package.json version, 0.0.0 is the fallback when absent". The version expression is unchanged.
- Strengthened the existing assertion in tests/mcp.test.ts: serverInfo.version now compares with package.json's version field (version-bump proof) instead of asserting only a string. This is the one runnable check behind the acceptance.
- Gate: `node tests/mcp.test.ts` passes, and `npm run test:changed` reports 8 suites passed.
- Commit: 919a425.
- Live test (merged 919a425): drove the real src/mcp.ts over newline JSON-RPC from a scratch clone with no node_modules and cwd on a fixture board, isolated HOME/XDG. `initialize` replies `serverInfo.name` "se-llm-team" and version "0.1.0", equal to package.json. Fallback: the same clone with the `version` field deleted from package.json replies "0.0.0". Control: a clone with `"version": "9.9.9"` replies "9.9.9", so the value is read from package.json and not hardcoded. The stale phrase "carries no version field" is gone from src/mcp.ts, line 16 reads "the package.json version, 0.0.0 is the fallback when absent", and the src diff touches only that comment. The main checkout is at the same commit, so the merged comment is live. No issues found.
- Assumption: the acceptance gate `node tests/mcp.test.ts` is the developer/reviewer gate and did not run in the live test, by design (the live test never runs the unit suite).

# Open questions
- Assumption: the spec's "comment-only change" constrains src/mcp.ts only, so a one-line test assertion update in tests/mcp.test.ts is in scope. No src behavior changed.
