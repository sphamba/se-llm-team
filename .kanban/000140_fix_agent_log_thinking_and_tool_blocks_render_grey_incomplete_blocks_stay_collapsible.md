---
name: "fix: agent log thinking and tool blocks render grey; incomplete blocks stay collapsible"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Thinking and shell (tool) blocks in the agent log pane render in grey both collapsed and expanded, and incomplete blocks at chunk boundaries (scrolling up or down) are still collapsible, grey, and collapsed by default instead of bare non-collapsible spans.

# Specs
Current state (verified): the #122 rendering gives thinking blocks details.lg-think (summary "Thinking", pre body, data-open="think" while unterminated) and tool blocks details.lg-tool (data-tc id, summary tool name + one-liner, pre.lg-args, optional pre.lg-out); toolHtml is substituted for all tool blocks at src/webui.ts:472 so even an unterminated tool_execution_start renders a full collapsible details. But (a) no CSS color rule exists for these blocks — they inherit body var(--fg) at webui.ts:907 (theme vars: light --muted #adaeb1 / dark --muted #5a6673 at :903-904 and :598-604, pane bg --code-bg), and (b) the chunk-boundary artifacts render as plain non-collapsible spans when they cannot join a prior block: a thinking delta continuation renders span.lg-cont (webui.ts:470) which the client appends into a prior data-open="think" block when one exists as a prior sibling, else it stays a bare span (webui.ts:1289-1295) — what scrolling-up history chunks show when they begin mid-thought; an orphan tool_execution_end renders span.lg-tres (joinTool, webui.ts:358-380) which the client joins into a matching details.lg-tool[data-tc] or leaves as a line (webui.ts:1276-1287).

Fix, src/webui.ts plus src/webui.test.ts only:
- Grey styling: details.lg-think and details.lg-tool (summary and pre body, collapsed and expanded alike) get color var(--muted) so both states render grey in both themes; the block boundaries/scrollbar stay as today.
- Incomplete blocks stay collapsible and collapsed by default:
  (a) an unterminated thinking block at a chunk end already renders details.lg-think[data-open="think"] — keep, it is now grey via the CSS rule;
  (b) a .lg-cont span that cannot join a prior open thinking block is promoted client-side to a collapsible details.lg-think collapsed by default (summary "Thinking", the delta text as body) instead of staying a bare span; when a prior data-open="think" block exists the append-into-it behavior is unchanged;
  (c) an orphan .lg-tres span that cannot join a matching details.lg-tool[data-tc] is promoted client-side to a collapsible details.lg-tool collapsed by default, summary from its data-sum one-liner when present (e.g. the failed text), otherwise a generic "result" summary, with the result text as body; when a matching details exists the join behavior is unchanged;
  (d) thinking_end re-rendering the same details.lg-think with authoritative content sans data-open keeps working, and the client dedupe of duplicate tool blocks is untouched.
- Tests: update the two assertions that expect bare spans (orphan end -> lg-tres span at ~:89, sidechain lg-tres at ~:109) to expect the promoted collapsible details; add assertions for the grey CSS rule on .lg-think and .lg-tool; keep the whole #122 suite green (open-at-chunk-end details, one tool block per call with id dedupe, failed summary, 80-char one-liner cap, partial trailing record dropped, thinking_end authoritative close, sidechain rendering).

# Notes
