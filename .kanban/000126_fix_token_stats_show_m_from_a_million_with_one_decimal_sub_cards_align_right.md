---
name: "fix: token stats show M from a million with one decimal; sub cards align left"
priority: "medium"
state: "done"
worktree: ""
blockedBy: ""
---

# Summary
Agent-card token stats show every value ≥1000 as integer k (2.3M tokens renders as "2266k"); show M with one decimal from a million, integer k below. Also, a run's stacked subagent cards hang 10px right of the caller; align the stack left instead.

# Specs
# 1. Token format (fmtTokens, src/webui.ts ~:499-504)

Current: <1000 raw string, else Math.round(total/1000) + "k". A 2.3M-token run renders "2266k".

New rules:
- < 1000: raw integer string, unchanged (e.g. "842").
- 1000 up to but not reaching 1M: integer k, unchanged formula (e.g. "999k").
- From 1M, and also when the integer-k rounding would reach 1000k (total >= 999500): one decimal M, e.g. (total/1e6).toFixed(1) + "M". So the sequence reads ...998k, 999k, 1.0M, 1.1M, 2.3M.

User examples: "999k, 1.0M". The invalid/non-finite/negative guard stays (returns "").

# 2. Sub cards align left (src/webui.ts CSS ~:781-782) - corrected 2026-10-12, was align right

Current: .agent-subs { margin-left: 10px } under the caller card in .agent-col, so the sub cards hang 10px right of the caller.

New: the stack of a run card and its subagent cards aligns LEFT - the sub cards sit flush left with the caller card, left edges aligned (drop the margin-left offset; e.g. .agent-subs { margin-left: 0 }), the whole stack a plain left-aligned column. The 4px gaps and the :empty display:none rule stay.

# Tests

src/webui.test.ts: fmtTokens assertions for 999499 -> "999k", 999500 -> "1.0M", 1500000 -> "1.5M", 842 -> "842". Files: src/webui.ts and src/webui.test.ts only.

# Notes
- Implemented the corrected align-left spec. The task body carried a stale duplicate spec #2 (align right) below the Tests section; the title, Summary, and the "corrected 2026-10-12, was align right" note make align left the contract.
- fmtTokens (src/webui.ts, actual lines ~658, spec line refs were stale): raw below 1000, integer k below 999500, one decimal M from 999500 via (total/1e6).toFixed(1) + "M". Invalid/non-finite/negative guard unchanged.
- .agent-subs (src/webui.ts ~941): dropped margin-left: 10px, so sub cards sit flush left with the caller card; the 4px gaps and :empty display:none rule unchanged.
- Tests added in src/webui.test.ts: 842 -> "842", 999499 -> "999k", 999500 -> "1.0M", 1500000 -> "1.5M". `node --experimental-strip-types --test src/webui.test.ts` passes (1 suite, all assertions).
- Committed as 40a5996 on fix/126-token-stats-show. Files touched: src/webui.ts, src/webui.test.ts only.
- Review: verified against the specs, no code fixes needed. fmtTokens matches spec 1 with the boundary at 999500 (runtime check: 999499 -> "999k", 999500/999999/1000000 -> "1.0M", 1100000 -> "1.1M", 2266000 -> "2.3M", 842 -> "842", null/negative/Infinity/NaN -> ""). The invalid/non-finite/negative guard is unchanged. .agent-subs dropped margin-left: 10px; .agent-col is a flex column with default align-items: stretch, so caller card and sub cards share flush left edges, and the 4px gaps plus the :empty display:none rule stay. All four required assertions (842, 999499, 999500, 1500000) are in src/webui.test.ts, the page-ships-source assertion still covers fmtTokens, and `node --experimental-strip-types --test src/webui.test.ts` passes. git diff main...HEAD touches src/webui.ts and src/webui.test.ts only.
- Removed the stale duplicate spec block (the second copy of #1/#2/# Tests below the first Tests section, carrying the outdated align-right spec) from the task body; align left is the contract per the title, Summary, and the corrected spec #2.
- Live test 2026-10-12: pass, no findings. Method: an isolated orchestrator daemon started from this worktree (own HOME, port 4347, so the production daemon and hub were untouched) served the real page. Playwright drove the real user flow (open the board, click a task card, open the agent cards) against two boards: a synthetic scratch board and the real project board registered with the isolated hub. The unit suites were not run.
- Token format, synthetic board: 2266000 rendered "2.3M", 1500000 "1.5M", 999499 "999k", 999500 "1.0M", 842 "842". All correct.
- Token format, real board: all 16 agent cards of tasks 000064, 000075, 000098 and 000088 matched an independent spec oracle (10 M values, 6 k values), for example 998836 rendered "999k", 1020483 "1.0M", 1056371 "1.1M", 8670284 "8.7M".
- Sub card alignment: caller card and its sub cards share the same left edge (dx = 0px) on the synthetic board and on real task 000088 (Sub-developer "2.8M", Sub-live-tester "12k"). The served .agent-subs rule has no margin-left, the row gap stays 4px, and empty sub boxes keep display:none. The sub cards survive the 5s board refresh.
- No browser console or page errors. Screenshots: /tmp/lt126-open-new.png, /tmp/lt126-real-subs.png.
