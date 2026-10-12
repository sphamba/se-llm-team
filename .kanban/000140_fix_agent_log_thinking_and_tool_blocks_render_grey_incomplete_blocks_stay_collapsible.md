---
name: "fix: agent log thinking and tool blocks render grey; incomplete blocks stay collapsible"
complexity: "moderate"
blockedBy: ""
priority: "medium"
state: "live-testing"
worktree: "fix/140-agent-log-thinking"
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

- 2026-10-12 (Developer): done in worktree fix/140-agent-log-thinking, commit 31d160c. Full suite green (`node src/webui.test.ts`: all assertions passed).
- Grey styling: one rule, `#m-log-text details.lg-think, #m-log-text details.lg-tool { color: var(--muted); }`, replaces the now-dead `display: block` rule for the bare spans. The color inherits into the summary and the pre body. So both block types read grey in both themes, collapsed and open.
- The three cross-chunk fixup passes (dedupe of details.lg-tool[data-tc], join of .lg-tres, join or promote of .lg-cont) moved out of client ingest() into an exported logFixups(el, doc). The page gets it through interpolation, like the other client helpers. ingest calls logFixups(el, document). The doc parameter makes the fixups runnable in Node without a DOM.
- Promotion: an orphan .lg-tres with no matching details.lg-tool[data-tc] in the pane becomes a collapsible details.lg-tool. The summary text comes from data-sum, else the generic "result". The body is a pre.lg-out with the result text. The promoted block gets no data-tc, so the dedupe pass never drops it. It stays as its own block when the real call block loads later. An unjoined .lg-cont becomes a collapsible details.lg-think, summary "Thinking", body pre, no data-open marker. The join paths stay unchanged when a matching block or an open think block exists.
- renderLogChunk output stays the same, with one change: it skips an empty continuation. An empty .lg-cont would promote into a visible empty Thinking block. The server still emits span.lg-tres and span.lg-cont for unjoined artifacts. So the two span assertions at :89 and :109 stay as server-output pins. New fake-DOM tests cover the promotion: orphan with data-sum, orphan without, join into an existing block, cont promotion, cont append into an open block.
- Tests: a LogEl stub, a selector matcher, and a CSS.escape polyfill went in at the top of the test file. The dead display:block CSS assertion at :503 now asserts that the page ships the logFixups source. A new assertion pins the grey CSS rule.
- 2026-10-12 (Reviewer): reviewed commit 31d160c in worktree fix/140-agent-log-thinking. The work meets the Specs, no fixes made. The grey rule styles details.lg-think and details.lg-tool with var(--muted) in both themes; the summary and the pre body inherit the color because no other rule sets one, so both states read grey. logFixups is exported, interpolated into the page before ingest, and runs after every chunk insert, so no bare span stays in the pane. The promoted blocks carry no data-tc, so the dedupe pass never drops them, and no data-open marker, so later deltas do not join them. The server still emits span.lg-tres and span.lg-cont for unjoined artifacts, so the two span assertions stay as server-output pins instead of expecting details, and the new fake-DOM tests cover the promotion directly. That deviates from the spec letter ("update the two assertions") but covers its intent more truly. Full suite green (node src/webui.test.ts, all assertions passed).
