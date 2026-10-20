---
name: "fix: stale 12-tool counts in README and index.ts comment"
priority: "low"
state: "done"
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
- complexity: trivial, so red-first and new tests skipped.
- Used the countless phrasing (shorter than a hard count): README.md now says "the same kanban and orchestrator tools"; index.ts:140 now says "the tools are deferred".
- Acceptance grep `12 tools|12 kanban` over README.md, src/, index.ts: empty.
- Scoped check `node tests/plugin.test.ts`: exit 0.

## Live test (2026-10-20)

Lane: documentation prose. The diff has no process of its own, so the user path is the reader: the README MCP paragraph and the `index.ts:140` comment, plus the command that section documents. The changed sentence now claims "the same kanban and orchestrator tools", so the real tool list from `node src/mcp.ts` is the ground truth behind the retired count.

Fixture: root is the merged worktree. The parent commit `6c23261` was extracted with `git archive` to `/tmp/lt298/pre-fix` as the negative control. Driver `/tmp/lt298/driver.mjs`, log `/tmp/lt298/run.log`, one run: `TALLY PASS: 8/8 checks passed, 0 failed`.

| # | Claim | Printed proof | Control |
| --- | --- | --- | --- |
| C1 | The merged README MCP paragraph has no hard tool count | paragraph text, no `\d+ kanban and orchestrator tools` match | parent paragraph matches `12 kanban and orchestrator tools` |
| C2 | The merged `index.ts` deferral comment has no count | `// the tools are deferred, ...`, no `\d+ tools` match | parent comment matches `12 tools` |
| C2b | The comment claim "the tools are deferred" still holds | `index.ts:39 exposure: "deferred",` | n/a (code read) |
| C3 | The countless phrasing is true, both hosts share one set | `tools/list` exit 0 with 13 names, equal to the 13 `TOOLS` keys | parent tree also lists 13, so its README `12` was wrong |
| C4 | No file states 12 for the PM tool set | `grep -rnE '12 tools\|12 kanban'` over README.md, src, docs, index.ts, skills, agents: exit 1, empty | parent: exit 0, hits at `README.md:72` and `index.ts:140` |

Assumptions that shaped the result:

- The changed prose asserts no count, so there is nothing numeric to compare. The check is "no digit before the tool noun", which keeps `Node >= 24` in the same paragraph from tripping the scan.
- "The same kanban and orchestrator tools" was verified as set equality between the MCP `tools/list` reply and the `TOOLS` keys that `index.ts` registers with `Object.entries(TOOLS)`. Both were 13, including `efficiency_analysis`.
- `src/mcp.ts` exits 0 when stdin closes, so the documented command was driven to completion with `initialize` and `tools/list` on stdin.

No behavior contradicted the task's stated assumptions. The task states 13; the server lists 13.

Not exercised: `tests/plugin.test.ts` (the Specs Acceptance names it, and the live test runs no suite), and no browser render (the diff changes one clause in a plain paragraph, no markup, link, or diagram).
