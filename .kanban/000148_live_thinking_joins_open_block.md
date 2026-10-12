---
name: "fix: live thinking deltas join the open block instead of creating new blocks"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: "#147"
issuer: "user"
complexity: "moderate"
shortName: "live-thinking-joins-open-block"
---

# Summary
When logs are incoming live and an incomplete thinking block is on screen, new thinking deltas must update that first block instead of creating a new Thinking block per poll, and the block must close with authoritative content when its thinking_end arrives.

# Specs
Root cause (verified by replaying the repo's real renderLogChunk + logFixups): the client promotion from #140 (src/webui.ts:974-982) creates a promoted details.lg-think WITHOUT data-open="think", but the delta walk-back (:968, `while (b && !(b.classList.contains("lg-think") && b.dataset.open === "think")) b = b.previousElementSibling;`) requires that marker - so once a mid-stream window promotes an unmarked block (the init window renders only the last 80 KB for logs > LOG_CHUNK, src/webui.ts:597, so thinking_start can lie outside it; or a scroll-up back-fill), every later delta poll's span.lg-cont fails the walk-back and promotes a fresh block (replay: 1 block, then 2, then 3 - the reported symptom). Compounding it: a thinking_end whose thinking_start was in an earlier chunk is silently dropped server-side (:457 `if (think !== null)` guard), so the open block never closes and never gets the authoritative full text.

Fix, src/webui.ts plus src/webui.test.ts only:
- Client promotion marks the block: when the #140 promotion fires for a cont span (no open block before it), the created details.lg-think carries data-open="think", so subsequent delta polls walk back to it and join it - one block, updated in place, instead of one block per poll.
- Server closes cross-window blocks: a thinking_end with no in-chunk thinking_start (currently dropped at :457) emits a closing marker instead - e.g. a `<span class="lg-cont" data-final="1">` carrying the authoritative thinking text - and the client, on seeing a final cont span, replaces the open (marked) block's body with the authoritative text, removes data-open and closes the block, keeping exactly one Thinking block with the final content.
- Keep byte-identical: the same-chunk flow (thinking_start opens, deltas append, thinking_end closes authoritatively, sans data-open), the join-into-a-real-open-block path, the genuinely-orphaned scroll-up back-fill behavior (a cont span with no open block before it still becomes its own block - now marked open so it captures later deltas), tool dedupe and the lg-tres join.
- The md() markdown wrapping of thinking bodies (#141) is untouched.

Tests (extend the flat assertion script, adding the missing multi-chunk live coverage): render chunk N whose window contains an unterminated thinking block, fixup the pane, then render chunk N+1 carrying two deltas and assert exactly ONE lg-think block whose body grew; render chunk N+2 carrying a cross-window thinking_end and assert the block is closed, sans data-open, with the authoritative text; a >LOG_CHUNK init window mid-stream promotes a marked open block and later deltas still join it; the existing #122/#140/#141 suites stay green.
