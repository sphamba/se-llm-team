---
name: "fix: complexity chip gets its own row in the detail card"
priority: "medium"
state: "live-testing"
worktree: "fix/116-complexity-chip-gets"
---

# Summary
In the task detail popup the complexity chip sits on the priority row (src/webui.ts:960, same div as the priority label and chip). Give the complexity chip its own labeled row in the detail card, leaving the board cards unchanged.

# Specs
In the task detail popup (openTask), the complexity chip currently renders inside the priority row: src/webui.ts:960 emits one div containing the priority label, the priority chip and the complexity chip. Move the complexity chip to its own row in #m-attrs: emit a separate div with a "complexity" label span followed by the complexity chip, e.g. "<div><span>complexity</span><span class='chip cx'>" + esc(t.complexity || "moderate") + "</span></div>", keeping the same chip classes and the absent-attribute fallback to "moderate". Keep the priority row with only the priority chip. Board cards (cardHtml, src/webui.ts:530) keep the complexity chip next to priority unchanged. Extend src/webui.test.ts: a source assert that the detail-card markup renders complexity in its own div with a "complexity" label. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes; no conflict with the in-flight #115 (src/orchestrator.ts lane).

# Notes
Split the priority row in openTask (src/webui.ts): the priority div keeps only the priority chip, the complexity chip moved to its own div with a "complexity" label span, same 'chip cx' class and esc(t.complexity || "moderate") fallback, placed between priority and state. cardHtml untouched. Replaced the stale webui.test.ts source assert with two: complexity renders in its own div with a complexity label, and the priority row holds only the priority chip. node src/webui.test.ts and node index.test.ts both pass. Committed as 0ac94ce.

Review: no fixes needed. Verified against the Specs: openTask (src/webui.ts:960-961) gives the complexity chip its own div with a "complexity" label span, same 'chip cx' class and esc(t.complexity || "moderate") fallback; the priority row holds only the priority chip. cardHtml (src/webui.ts:529-530) keeps the complexity chip next to priority, untouched. The diff touches only src/webui.ts and src/webui.test.ts. Both source asserts present in webui.test.ts and both test files pass on the worktree. No open questions.
