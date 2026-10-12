---
name: "fix: live thinking deltas join the open block instead of creating new blocks"
priority: "medium"
state: "done"
worktree: ""
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

- Live test (b5e07c0): ran the real product from the worktree daemon (`node src/orchestrator.ts --root <temp root>`) with an isolated HOME, and drove the real hub UI in headless Chromium. The simulated live agent appended pi JSONL records to the real log file, so the daemon, the HTTP chunk and poll endpoints, and the browser were real. No code was edited, no unit suite was run.
- Synthetic records, 11 checks: 11/11 pass on b5e07c0 and 6/11 on the pre-fix parent a6a07ec. The pre-fix failures were A3 (a cross-window thinking_end never closed the block), B1 and B1b (a mid-stream init promoted a block without the marker), B2 (two later delta polls did not join the live tail block), and B3 (the cross-window end did not replace it). A1 and A2 (same-chunk join), C1 and C2 (same-chunk close, idle polls add no blocks), D1 (tool dedupe and lg-tres join), and E1 (no console errors) passed in both builds, so the fix changed only the broken paths.
- Mid-stream evidence on b5e07c0: the init promoted one marked open block of 8188 chars, two later delta polls grew that same tail block to 8204 (16 chars added) and added no block, and the cross-window end replaced its body with AUTHORITATIVE-B and cleared data-open. Pre-fix the same polls left the live tail block at 8188 and the end was dropped.
- Real records, 5 checks: 5/5 on b5e07c0 and 2/5 pre-fix. The fixture was this task's own developer log, truncated mid-thinking at a record boundary (thinking_start outside the 80 KB tail window, 354 real deltas inside), with the real 26053-char thinking_end record appended. On b5e07c0 the pane replaced the promoted block body with the exact authoritative text and kept one block. Pre-fix the real end never reached the pane.
- Assumptions for the usage tests: (1) the live agent writes are simulated JSONL appends while the server, hub and browser are real, (2) LOG_CHUNK is 81920 bytes and the mid-stream case needs thinking_start outside the tail window, (3) a mid-stream open triggers the client scroll-to-top history back-fill because the promoted pre has no line wrap, so the test waits for that spec-accepted phase to settle and asserts on the live tail block, (4) data-open is a marker and promoted blocks stay collapsed, which was observed.
- No observed behavior contradicts the Specs. Two pre-existing behaviours remain, both out of scope and unchanged by the fix: the mid-stream scroll-to-top back-fill still prepends a separate block for the same thinking stream (accepted in the Specs), and a promoted block is one long unwrapped line (the pre keeps white-space: pre), so the pane scrolls horizontally instead of wrapping.

- Merge: step 1 merged base branch main into fix/148-live-thinking-joins-open-block in the worktree - already up to date, clean, no conflicts (tests skipped per clean-merge rule). Step 2 merged fix/148-live-thinking-joins-open-block into main in the project root - fast-forward a6a07ec..b5e07c0, clean, no conflicts. src/webui.ts (+21) and src/webui.test.ts (+75) landed on main as b5e07c0. Base branch resolved with git branch --show-current before each step (main both times, no detached HEAD).

# Open questions

