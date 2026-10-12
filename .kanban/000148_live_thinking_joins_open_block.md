---
name: "fix: live thinking deltas join the open block instead of creating new blocks"
priority: "medium"
state: "live-testing"
worktree: "fix/148-live-thinking-joins-open-block"
blockedBy: ""
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

# Notes
- Implemented both fixes in src/webui.ts: the server-side thinking_end handler emits a `<span class="lg-cont" data-final="1">` with the authoritative content when no in-chunk thinking_start exists (same-chunk flow untouched), and the client logFixups marks promoted blocks data-open="think" so later delta polls join them; a data-final span replaces the marked block's body with the authoritative text and unmarks it, or promotes to a closed block of its own when no open block precedes it.
- Tests added to src/webui.test.ts: the promotion now asserts the data-open marker; a three-poll sequence (chunk N deltas promote marked, chunk N+1 two deltas join, chunk N+2 cross-window thinking_end closes with authoritative text); a close span with no open block promotes closed; a same-chunk combo (deltas plus close in one poll) renders one new closed block; endpoint coverage for a >LOG_CHUNK init window mid-stream (serves the joinable span, then the next poll's span, then the closing span). Full suite green, all five test files.
- Committed as b5e07c0 in the worktree.
- Review (pass 1): reviewed commit b5e07c0 against every spec bullet; no fixes needed. Diff confined to src/webui.ts + src/webui.test.ts as required.
- Client promotion marks data-open="think" (logFixups, src/webui.ts:1028-1050); the walk-back joins it, later delta polls append in place. Server emits the data-final closing span only when the start is genuinely outside the chunk (think === null) and content is a string; flush() before the span keeps text_delta ordering. Confirmed byte-identical: same-chunk open/append/close, real-open join, orphaned back-fill promotion, tool dedupe, lg-tres join, md() untouched.
- data-open is a marker only: the CSS (line 1151) does not target it and thinkHtml never emits the boolean open attribute, so promoted blocks stay visually collapsed - no styling regression.
- Edge cases checked and accepted: a duplicate thinking_end after an in-chunk close promotes a second closed block (same defensive shape as the same-chunk flow, pathological input only); a non-string end content emits nothing, keeping the client block open so reconstructed deltas survive (the server cannot know them); a single poll carrying deltas plus the close collapses to exactly one closed block (tested).
- Full suite green: all five test files (kanban, orchestrator, webui, extension, index).
- Cleared the previous Open questions: all four assumptions are settled by the Specs (the data-final marker on .lg-cont was spec-suggested; the non-string typeof check matches the same-chunk flow; the plain-text close is the pre-existing promotion-path behavior with md() untouched per spec; back-fill duplication is explicitly out of scope per spec).

# Open questions
