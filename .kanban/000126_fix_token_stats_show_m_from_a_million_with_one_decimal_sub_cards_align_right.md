---
name: "fix: token stats show M from a million with one decimal; sub cards align right"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: "#118, #121"
---

# Summary
Agent-card token stats show every value ≥1000 as integer k (2.3M tokens renders as "2266k"); show M with one decimal from a million, integer k below. Also, a run's stacked subagent cards hang left under the caller; align the stack right instead.

# Specs
# 1. Token format (fmtTokens, src/webui.ts ~:499-504)

Current: <1000 raw string, else Math.round(total/1000) + "k". A 2.3M-token run renders "2266k".

New rules:
- < 1000: raw integer string, unchanged (e.g. "842").
- 1000 up to but not reaching 1M: integer k, unchanged formula (e.g. "999k").
- From 1M, and also when the integer-k rounding would reach 1000k (total >= 999500): one decimal M, e.g. (total/1e6).toFixed(1) + "M". So the sequence reads ...998k, 999k, 1.0M, 1.1M, 2.3M.

User examples: "999k, 1.0M". The invalid/non-finite/negative guard stays (returns "").

# 2. Sub cards align right (src/webui.ts CSS ~:781-782)

Current: .agent-subs { margin-left: 10px } under the caller card in .agent-col.

New: the stack of a run card and its subagent cards aligns right - the sub cards hang to the RIGHT of the caller, sharing the caller's right edge with a visible right cascade (e.g. .agent-col { align-items: flex-end } with the subs indented from the left by ~24px, or margin-left larger with flush right edges). The 4px gaps and the :empty display:none rule stay. Pick the offset so the cascade is clearly visible.

# Tests

src/webui.test.ts: fmtTokens assertions for 999499 -> "999k", 999500 -> "1.0M", 1500000 -> "1.5M", 842 -> "842". Files: src/webui.ts and src/webui.test.ts only.

# Notes
